const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

// ===== CALCULATION UTILITIES =====

function getNestedValue(obj, path) {
	if (!path) return obj;
	return path.split(".").reduce((current, key) => (current === null || current === undefined ? undefined : current[key]), obj);
}

function isMetadataField(fieldName) {
	if (!fieldName) return false;
	const metadataPatterns = [
		/^id$/i,
		/.*_id$/i,
		/.*Id$/,
		/^uid$/i,
		/^uuid$/i,
		/^guid$/i,
		/timestamp/i,
		/created/i,
		/updated/i,
		/modified/i,
		/version/i,
		/index/i,
		/position/i,
		/order/i,
		/status/i,
		/state/i,
		/type/i,
		/^EDV$/i,
		/^80f3dfsd$/i,
	];
	return metadataPatterns.some((pattern) => pattern.test(fieldName));
}

function extractNumbers(data, fieldPath = null, excludeZeros = false) {
	const numbers = [];
	const shouldInclude = (value) => {
		if (typeof value !== "number" || isNaN(value)) return false;
		if (excludeZeros && value === 0) return false;
		return true;
	};

	if (fieldPath) {
		if (Array.isArray(data)) {
			data.forEach((item) => {
				const value = getNestedValue(item, fieldPath);
				if (typeof value === "object" && value !== null) {
					Object.values(value).forEach((val) => {
						if (shouldInclude(val)) numbers.push(val);
					});
				} else if (shouldInclude(value)) {
					numbers.push(value);
				}
			});
		} else {
			const value = getNestedValue(data, fieldPath);
			if (shouldInclude(value)) numbers.push(value);
		}
		return numbers;
	}

	function traverse(current, currentKey = null) {
		if (shouldInclude(current) && !isMetadataField(currentKey)) {
			numbers.push(current);
			return;
		}
		if (Array.isArray(current)) {
			current.forEach((item) => traverse(item));
		} else if (typeof current === "object" && current !== null) {
			Object.entries(current).forEach(([key, value]) => {
				if (!isMetadataField(key)) traverse(value, key);
			});
		}
	}

	traverse(data);
	return numbers;
}

// ===== CALCULATION FUNCTIONS =====

function calculateAverage({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	const sum = numbers.reduce((acc, num) => acc + num, 0);
	const average = sum / numbers.length;

	return {
		average: parseFloat(average.toFixed(2)),
		count: numbers.length,
		total_sum: parseFloat(sum.toFixed(2)),
		exclude_zeros,
	};
}

function calculateSum({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	const sum = numbers.reduce((acc, num) => acc + num, 0);
	return {
		sum: parseFloat(sum.toFixed(2)),
		count: numbers.length,
		exclude_zeros,
	};
}

function calculateDeviation({ data, field_path, population = false, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };
	if (numbers.length === 1) return { standard_deviation: 0, variance: 0, mean: numbers[0], count: 1 };

	const mean = numbers.reduce((acc, num) => acc + num, 0) / numbers.length;
	const squaredDifferences = numbers.map((num) => Math.pow(num - mean, 2));
	const variance = squaredDifferences.reduce((acc, diff) => acc + diff, 0) / (population ? numbers.length : numbers.length - 1);
	const standardDeviation = Math.sqrt(variance);

	return {
		standard_deviation: parseFloat(standardDeviation.toFixed(2)),
		variance: parseFloat(variance.toFixed(2)),
		mean: parseFloat(mean.toFixed(2)),
		count: numbers.length,
		type: population ? "population" : "sample",
	};
}

function calculatePercentageDeviation({ data, field_path = null, exclude_zeros = true }) {
	let itemsWithValues = [];

	if (Array.isArray(data) && data.length > 0 && data[0]?.shifts) {
		itemsWithValues = data.map((driver) => {
			const shifts = driver.shifts || {};
			let totalValue = 0;

			Object.entries(shifts).forEach(([shiftType, hours]) => {
				if (isMetadataField(shiftType)) return;
				if (typeof hours === "number" && !isNaN(hours)) {
					if (!exclude_zeros || hours !== 0) {
						totalValue += hours;
					}
				}
			});

			return {
				name: driver.driverName || driver.name || `Driver ${driver.driverId}`,
				id: driver.driverId || driver.id,
				value: totalValue,
				rawData: driver,
			};
		});
	} else if (Array.isArray(data)) {
		itemsWithValues = data
			.map((item, index) => {
				const value = field_path ? getNestedValue(item, field_path) : typeof item === "number" ? item : null;

				if (typeof value === "number" && !isNaN(value)) {
					if (!exclude_zeros || value !== 0) {
						return {
							name: item.name || item.driverName || item.dayName || `Item ${index + 1}`,
							id: item.id || index,
							value: value,
							rawData: item,
						};
					}
				}
				return null;
			})
			.filter(Boolean);
	}

	if (itemsWithValues.length === 0) return { error: "No valid numbers found for deviation calculation" };

	const values = itemsWithValues.map((item) => item.value);
	const average = values.reduce((sum, val) => sum + val, 0) / values.length;

	const results = itemsWithValues.map((item) => {
		const deviation = item.value - average;
		const percentageDeviation = average !== 0 ? (deviation / average) * 100 : 0;

		return {
			name: item.name,
			id: item.id,
			value: item.value,
			deviation: parseFloat(deviation.toFixed(2)),
			percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
			rawData: item.rawData,
		};
	});

	results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

	return {
		average: parseFloat(average.toFixed(2)),
		totalItems: results.length,
		results,
		summary: {
			highestDeviation: results[0]?.percentageDeviation || 0,
			highestDeviationItem: results[0]?.name || "N/A",
			lowestDeviation: results[results.length - 1]?.percentageDeviation || 0,
			lowestDeviationItem: results[results.length - 1]?.name || "N/A",
			averageDeviation: parseFloat(
				(results.reduce((sum, r) => sum + Math.abs(r.percentageDeviation), 0) / results.length).toFixed(2)
			),
		},
	};
}

function calculateMinMax({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	return {
		min: Math.min(...numbers),
		max: Math.max(...numbers),
		range: Math.max(...numbers) - Math.min(...numbers),
		count: numbers.length,
	};
}

// ===== AI-POWERED INTENT DETECTION =====

async function detectCalculationIntent(userMessage, apiData, apiDescription) {
	try {
		const dataSample = Array.isArray(apiData) ? apiData.slice(0, 3) : apiData;

		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{
					role: "system",
					content: `You are an intelligent calculation intent analyzer. Your job is to understand what mathematical operations the user wants performed on their data.

**CRITICAL: Check API Capabilities First**
Before recommending ANY calculation, check if the API description already provides that data:
- If API says "Returns total hours" → Don't calculate sum, just display
- If API says "Returns average" → Don't calculate average, just display
- If API says "Returns breakdown by..." → Don't aggregate, just display the breakdown
- If API says "Returns list of items with values" → User is just asking to see the data

Only recommend calculation if the API does NOT already provide that specific metric.

**Response Format (JSON only):**
{
  "needsCalculation": boolean,
  "calculationType": "average" | "sum" | "deviation" | "percentageDeviation" | "minMax" | "none",
  "fieldPath": "field.name" or null,
  "excludeZeros": boolean,
  "reasoning": "brief explanation of your choice",
  "apiAlreadyProvides": "what the API already provides",
  "userJustWantsToSee": boolean
}`,
				},
				{
					role: "user",
					content: `Analyze this query and determine if calculation is actually needed.

**User Message:** "${userMessage}"

**API Description:**
${apiDescription || "No description provided"}

**API Context:**
- Data Type: ${Array.isArray(apiData) ? `Array with ${apiData.length} items` : "Object"}

**Data Sample (first 3 items):**
${JSON.stringify(dataSample, null, 2)}

**Data Structure Keys:**
${Array.isArray(apiData) && apiData.length > 0 ? Object.keys(apiData[0] || {}).join(", ") : "N/A"}

Provide your analysis in JSON format.`,
				},
			],
			temperature: 0.1,
			response_format: { type: "json_object" },
		});

		const result = JSON.parse(response.choices[0].message.content);
		console.log("🎯 AI Intent Analysis:", {
			calculationType: result.calculationType,
			reasoning: result.reasoning,
			needsCalculation: result.needsCalculation,
		});

		return result;
	} catch (error) {
		console.error("❌ AI intent detection failed:", error.message);
		return {
			needsCalculation: false,
			calculationType: "none",
			fieldPath: null,
			excludeZeros: false,
			reasoning: "Error in detection, falling back to display mode",
			apiAlreadyProvides: "Unknown",
			userJustWantsToSee: true,
		};
	}
}

// ===== PRE-CALCULATION ENGINE =====

function performCalculations(data, intent) {
	const { calculationType, fieldPath, excludeZeros } = intent;

	console.log(`📊 Performing calculation: ${calculationType}`);

	try {
		switch (calculationType) {
			case "average":
			case "mean":
				return {
					type: "average",
					result: calculateAverage({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "sum":
			case "total":
				return {
					type: "sum",
					result: calculateSum({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "deviation":
				return {
					type: "standardDeviation",
					result: calculateDeviation({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "percentageDeviation":
				return {
					type: "percentageDeviation",
					result: calculatePercentageDeviation({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "minMax":
				return {
					type: "minMax",
					result: calculateMinMax({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			default:
				return null;
		}
	} catch (error) {
		console.error("❌ Calculation error:", error.message);
		return null;
	}
}

// ===== MAIN PROCESSING FUNCTION =====

const processIntentAndFormatResponse = async ({
	userMessage,
	api,
	exampleResponse,
	actualData,
	params = {},
	session,
	onStream,
	abortSignal,
	isContextual = false, // 🔹 Passed from getIntent
	followupItem = null, // 🔹 From API definition
}) => {
	let fullText = "";

	try {
		console.log("\n========================================");
		console.log("🚀 PROCESS INTENT (ULTRA SIMPLIFIED)");
		console.log("========================================");
		console.log("API:", api.name);
		console.log("User message:", userMessage);
		console.log("Actual data length:", Array.isArray(actualData) ? actualData.length : "N/A");
		console.log("Is contextual:", isContextual);
		console.log("Follow-up item:", followupItem);

		if (abortSignal?.aborted) return { error: "Request aborted" };

		// 🔹 Get context if this is a contextual query
		const contextInfo =
			isContextual && session.contextData
				? {
						entityData: session.contextData.entityData,
						entityFieldName: session.contextData.entityFieldName,
						entityIntent: session.contextData.entityIntent,
						entityUserMessage: session.contextData.entityUserMessage,
						entityCount: session.contextData.entityCount,
				  }
				: null;

		if (contextInfo) {
			console.log("\n🎯 CONTEXTUAL QUERY DETECTED");
			console.log("Previous context:");
			console.log("  - Field:", contextInfo.entityFieldName);
			console.log("  - Count:", contextInfo.entityCount);
			console.log("  - Sample:", contextInfo.entityData.slice(0, 5));
		}

		// AI intent detection
		console.log("\n🤖 Starting AI intent detection...");
		const calculationIntent = await detectCalculationIntent(userMessage, actualData, api?.description);

		if (abortSignal?.aborted) return { error: "Request aborted" };

		// Pre-calculate if needed
		let preCalculatedResults = null;
		if (calculationIntent.needsCalculation && calculationIntent.calculationType !== "none") {
			console.log("📊 Pre-calculation triggered...");
			preCalculatedResults = performCalculations(actualData, calculationIntent);
		}

		// 🔹 Build prompt - OpenAI does ALL the filtering
		const prompt = `
You are a smart assistant processing structured API data and answering user questions.

### Context
API Name: ${api.name}
API Description: ${api.description}
User Message: "${userMessage}"
Query Parameters: ${JSON.stringify(params, null, 2)}

${
	contextInfo
		? `
### 🎯 CONTEXTUAL QUERY - FILTER THE DATA!
The user previously asked: "${contextInfo.entityUserMessage}"
That query returned ${contextInfo.entityCount} items.

**Previous ${contextInfo.entityFieldName} values:**
${JSON.stringify(contextInfo.entityData)}

**CRITICAL INSTRUCTION:**
The current query "${userMessage}" refers to ONLY those ${contextInfo.entityCount} items above.
You MUST filter the data below to show ONLY items where ${contextInfo.entityFieldName} matches one of the values above.

Example:
- If ${contextInfo.entityFieldName} = "driverId" and values are [1482, 1488, 1497]
- Only show data where driverId is 1482, 1488, or 1497
- Ignore all other items

DO NOT show all ${actualData?.length || 0} items - show only the ${contextInfo.entityCount} matching items!
`
		: ""
}

### Available Data (Total: ${actualData?.length || 0} items)
${JSON.stringify(actualData, null, 2)}

${
	preCalculatedResults
		? `
### Pre-Calculated Results
Calculation Type: ${preCalculatedResults.type}
${JSON.stringify(preCalculatedResults.result, null, 2)}

**CRITICAL: Pre-calculated results are provided. You MUST use them.**
`
		: ""
}

### Your Task
1. **Understand the user's intent** from their message
2. ${
			contextInfo
				? `**FIRST: Filter the data to show only ${contextInfo.entityCount} matching items**`
				: "**Process the data** to answer the question"
		}
3. ${
			preCalculatedResults
				? "**Use the pre-calculated results above** - they are accurate and complete"
				: "**Process the data** as needed"
		}
4. **Apply any filters** mentioned in the user message:
   - For "top N": show exactly N items
   - For thresholds: only include items meeting criteria
   - For categories: group appropriately
5. **Choose the best format**:
   - **Tables**: For comparisons, multiple attributes, calculated results
     - Use <thead> with <th> and <tbody> with <tr><td>
     - Make headers descriptive and user-friendly
     - DO NOT include ID fields (like driverId, id, shiftId, etc.) in the table
     - Only show meaningful fields (names, hours, dates, status, etc.)
   - **Lists**: For simple enumerations
   - **Paragraphs**: For descriptive content
6. **Structure your response**:
   - Introductory <p> sentence
   - Main content (table/list/paragraph)
   - <div class="summary"> with:
     * Exact counts (no vague terms)
     * 2-3 key insights
     * Statistics from pre-calculated results if available
7. **Format dates** in readable format (e.g., "January 15, 2025" not "2025-01-15")

${
	api?.isSuitableForGraph
		? `
8. **After the summary**, add:
<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>
`
		: ""
}

### CRITICAL: Track What You Display
After your response, add this hidden meta tag with the ACTUAL ${followupItem} values you displayed:
<meta name="displayed-items" content='{"field":"${followupItem}","values":[...]}' />

**Instructions for meta tag:**
- Extract the ${followupItem} values from the items you actually displayed
- Include ALL items you showed (even if it's 100+)
- Use exact values from the data
- Examples:
  * If ${followupItem} = "driverId" and you showed drivers with ID 1482, 1488, 1497:
    <meta name="displayed-items" content='{"field":"driverId","values":[1482,1488,1497]}' />
  * If ${followupItem} = "driverName" and you showed "Alex", "John":
    <meta name="displayed-items" content='{"field":"driverName","values":["Alex","John"]}' />

### Output Format
- Output ONLY valid HTML
- No markdown, JSON, or code blocks
- No ID fields in visible content (tables, lists)
- End with: ###END###

Generate the response now:
`;

		// Stream response
		console.log("\n📤 Streaming response...");
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
			stream: true,
		});

		for await (const chunk of completion) {
			if (abortSignal?.aborted) return { error: "Request aborted" };

			const delta = chunk.choices?.[0]?.delta?.content || "";
			if (!delta) continue;

			fullText += delta;
			if (fullText.includes("###END###")) break;

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			if (cleaned && onStream) {
				const toStream = cleaned.replace(/<meta[^>]*>/g, "");
				if (toStream) {
					const formatted = toStream
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.replace(/(\d)([A-Za-z])/g, "$1 $2")
						.replace(/([a-zA-Z])(\d)/g, "$1 $2");
					onStream(formatted);
				}
			}
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();
		console.log("✅ Response streaming complete");

		if (abortSignal?.aborted) return { error: "Request aborted" };

		// 🔹 Parse displayed items from meta tag
		console.log("\n📊 Parsing displayed items...");
		const metaMatch = finalReply.match(/<meta\s+name="displayed-items"\s+content='([^']+)'\s*\/?>/);

		let displayedInfo = null;
		if (metaMatch) {
			try {
				displayedInfo = JSON.parse(metaMatch[1]);
				console.log("  - Field:", displayedInfo.field);
				console.log("  - Count:", displayedInfo.values?.length);
				console.log("  - Sample:", displayedInfo.values?.slice(0, 5));
			} catch (e) {
				console.log("  - Failed to parse meta tag");
			}
		} else {
			console.log("  - No meta tag found");
		}

		// Remove meta tag from response
		const cleanReply = finalReply.replace(/<meta[^>]*>/g, "");

		// Save session
		console.log("\n💾 Saving session...");
		await Session.updateOne(
			{ _id: session._id },
			{
				$set: {
					lastResponseMessage: cleanReply,
					lastSuccessUserMessage: userMessage,
					lastSuccessIntent: api?.name || null,
					lastSuccessApiResponse: actualData,
					lastSuccessParams: params,
					missingField: null,
				},
			}
		);

		// 🔹 Update context with displayed items
		if (displayedInfo && displayedInfo.field && displayedInfo.values && displayedInfo.values.length > 0) {
			console.log("\n🔄 Updating context with displayed items...");
			await session.updateContext(
				api?.name,
				displayedInfo.values, // Just the IDs/names
				displayedInfo.field, // Field name
				userMessage
			);
			await session.save();
		} else if (followupItem && !isContextual) {
			// First query - try to extract from response
			console.log("\n🔄 First query - attempting to extract context...");

			// Ask OpenAI to extract what it displayed
			try {
				const extractPrompt = `
Given this HTML response, extract the ${followupItem} values that were displayed.

HTML Response:
${cleanReply}

Return ONLY a JSON array of the ${followupItem} values.
Example: [1482, 1488, 1497] or ["Alex", "John", "Sarah"]

Do not include any explanation, just the JSON array.`;

				const extractResponse = await openai.chat.completions.create({
					model: "gpt-4o-mini",
					messages: [{ role: "user", content: extractPrompt }],
					temperature: 0,
				});

				const extractedContent = extractResponse.choices[0].message.content.trim();
				const extractedValues = JSON.parse(extractedContent);

				if (Array.isArray(extractedValues) && extractedValues.length > 0) {
					console.log("  - Extracted:", extractedValues.length, "items");
					console.log("  - Sample:", extractedValues.slice(0, 5));

					await session.updateContext(api?.name, extractedValues, followupItem, userMessage);
					await session.save();
				}
			} catch (e) {
				console.log("  - Extraction failed:", e.message);
			}
		}

		console.log("✅ Response generation complete");
		console.log("========================================\n");

		return {
			userReply: cleanReply,
			params,
			api,
		};
	} catch (err) {
		if (abortSignal?.aborted) return { error: "Request aborted" };

		console.error("❌ Error:", err.message);
		return {
			userReply: "Here's the available data.",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;

