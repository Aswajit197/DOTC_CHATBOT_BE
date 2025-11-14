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

/**
 * Check if data is empty (null, undefined, empty array, empty object, empty string)
 */
function isEmptyData(data) {
	if (data === null || data === undefined) return true;
	if (typeof data === "string" && data.trim() === "") return true;
	if (Array.isArray(data) && data.length === 0) return true;
	if (typeof data === "object" && Object.keys(data).length === 0) return true;
	return false;
}

/**
 * Generate a friendly "no data" message using AI
 */
async function generateEmptyDataMessage(userMessage, apiName, apiDescription) {
	try {
		const prompt = `The user asked: "${userMessage}"

They were trying to use the API: ${apiName}
API Description: ${apiDescription || "No description available"}

However, the API returned no data/empty results.

Generate a friendly, helpful message that:
1. Acknowledges what they were looking for
2. Explains that no data was found
3. Suggests possible reasons (e.g., no records match criteria, date range has no data, etc.)
4. Offers help or next steps

Keep it conversational, empathetic, and under 3 sentences.
Output ONLY the message text, no JSON or formatting.`;

		const response = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [{ role: "user", content: prompt }],
			temperature: 0.7,
		});

		return response.choices[0].message.content.trim();
	} catch (error) {
		console.error("❌ Failed to generate empty data message:", error.message);
		// Fallback message
		return `I couldn't find any data for your request. There might be no records matching your criteria, or the data might not be available at the moment. Please try adjusting your search parameters or check back later.`;
	}
}

/**
 * Filter actualData to only include items matching context
 * Returns { filteredData, matchCount, contextField, contextValues }
 */
function applyContextualFilter(actualData, contextInfo) {
	if (!contextInfo || !contextInfo.entityData || !contextInfo.entityFieldName) {
		return { filteredData: actualData, matchCount: 0, contextField: null, contextValues: [] };
	}

	const { entityData, entityFieldName } = contextInfo;

	console.log("\n🔍 APPLYING CONTEXTUAL FILTER");
	console.log("  - Context field:", entityFieldName);
	console.log("  - Context values count:", entityData.length);
	console.log("  - Data to filter:", Array.isArray(actualData) ? actualData.length : "N/A");

	if (!Array.isArray(actualData)) {
		console.log("  ⚠️ Data is not an array, cannot filter");
		return { filteredData: actualData, matchCount: 0, contextField: entityFieldName, contextValues: entityData };
	}

	// Normalize context values for comparison (convert to strings)
	const normalizedContextValues = entityData.map((v) => String(v).toLowerCase().trim());

	// Filter data to only include items matching context
	const filteredData = actualData.filter((item) => {
		if (!item || typeof item !== "object") return false;

		// Get the value from the item (handle nested paths)
		const itemValue = getNestedValue(item, entityFieldName);
		if (itemValue === null || itemValue === undefined) return false;

		// Normalize for comparison
		const normalizedItemValue = String(itemValue).toLowerCase().trim();

		return normalizedContextValues.includes(normalizedItemValue);
	});

	console.log("  ✅ Filtered results:", filteredData.length, "matches");

	if (filteredData.length > 0) {
		console.log(
			"  - Sample matched IDs:",
			filteredData.slice(0, 3).map((item) => getNestedValue(item, entityFieldName))
		);
	}

	return {
		filteredData,
		matchCount: filteredData.length,
		contextField: entityFieldName,
		contextValues: entityData,
		originalCount: actualData.length,
	};
}

/**
 * Generate a contextual "no matches" message
 */
async function generateNoMatchesMessage(userMessage, contextInfo, apiName) {
	try {
		const prompt = `The user asked a follow-up question: "${userMessage}"

They were referring to ${contextInfo.entityCount} ${contextInfo.entityType} from their previous query:
"${contextInfo.entityUserMessage}"

Context details:
- Entity type: ${contextInfo.entityType}
- Entity IDs: ${contextInfo.entityData.slice(0, 10).join(", ")}${contextInfo.entityData.length > 10 ? "..." : ""}
- Field: ${contextInfo.entityFieldName}

However, the API "${apiName}" returned NO data matching any of these ${contextInfo.entityType}.

Generate a friendly, contextual message that:
1. Acknowledges what they were asking about (their follow-up question)
2. References the specific ${contextInfo.entityType} from their previous query
3. Explains that none of those ${contextInfo.entityType} have any results for the current query
4. Suggests they might want to check different ${contextInfo.entityType} or a different time period

Keep it conversational, empathetic, and under 3 sentences.
Use "them", "those", "these" naturally when referring to the previous context.
Output ONLY the message text, no JSON or formatting.`;

		const response = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [{ role: "user", content: prompt }],
			temperature: 0.7,
		});

		return response.choices[0].message.content.trim();
	} catch (error) {
		console.error("❌ Failed to generate no matches message:", error.message);

		// Fallback contextual message
		return `None of the ${contextInfo.entityCount} ${contextInfo.entityType} from your previous query have any data for this request. You might want to check different ${contextInfo.entityType} or adjust your search criteria.`;
	}
}

// Update the main processIntentAndFormatResponse function
const processIntentAndFormatResponse = async ({
	userMessage,
	api,
	exampleResponse,
	actualData,
	params = {},
	session,
	onStream,
	abortSignal,
	isContextual = false,
	followupItem = null,
}) => {
	let fullText = "";
	console.log(actualData, "actualData");

	try {
		console.log("\n========================================");
		console.log("🚀 PROCESS INTENT (ROLLING CONTEXT)");
		console.log("========================================");
		console.log("API:", api.name);
		console.log("User message:", userMessage);
		console.log("Actual data length:", Array.isArray(actualData) ? actualData.length : "N/A");
		console.log("Is contextual:", isContextual);
		console.log("Follow-up item:", followupItem);
		console.log("Context history length:", session.contextHistory?.length || 0);

		if (abortSignal?.aborted) return { error: "Request aborted" };

		// 🔹 CHECK FOR EMPTY DATA FIRST (non-contextual)
		if (!isContextual && isEmptyData(actualData)) {
			console.log("\n⚠️ EMPTY DATA DETECTED (non-contextual)");
			const emptyMessage = await generateEmptyDataMessage(userMessage, api.name, api.description);

			const htmlMessage = `
<div class="empty-response">
	<p>${emptyMessage}</p>
	<div class="summary">
		<p><strong>Search details:</strong></p>
		<ul>
			<li>API used: ${api.name}</li>
			<li>Parameters: ${Object.keys(params).length > 0 ? JSON.stringify(params) : "None specified"}</li>
			<li>Results found: 0</li>
		</ul>
	</div>
</div>
			`.trim();

			await Session.updateOne(
				{ _id: session._id },
				{
					$set: {
						lastResponseMessage: htmlMessage,
						lastSuccessUserMessage: userMessage,
						lastSuccessIntent: api?.name || null,
						lastSuccessApiResponse: actualData,
						lastSuccessParams: params,
						missingField: null,
					},
				}
			);

			return { userReply: htmlMessage, params, api };
		}

		// 🔹 Get context information if contextual query
		let contextInfo = null;
		let contextSummary = null;
		let filteredResult = null;

		if (isContextual) {
			const recentContext = session.getMostRecentContext();
			contextSummary = session.getContextSummary();

			console.log("\n🎯 CONTEXTUAL QUERY DETECTED");
			console.log("📚 Context History Available:");
			console.log(contextSummary);

			if (recentContext) {
				contextInfo = {
					entityData: recentContext.entityData,
					entityFieldName: recentContext.entityFieldName,
					entityType: recentContext.entityType,
					entityIntent: recentContext.entityIntent,
					entityUserMessage: recentContext.entityUserMessage,
					entityCount: recentContext.entityCount,
				};

				console.log("\n🎯 Using Most Recent Context:");
				console.log("  - Type:", contextInfo.entityType);
				console.log("  - Field:", contextInfo.entityFieldName);
				console.log("  - Count:", contextInfo.entityCount);
				console.log("  - Sample:", contextInfo.entityData);

				// 🔹 APPLY CONTEXTUAL FILTER
				filteredResult = applyContextualFilter(actualData, contextInfo);

				console.log("\n📊 FILTER RESULTS:");
				console.log("  - Original data count:", filteredResult.originalCount);
				console.log("  - Matched items:", filteredResult.matchCount);
				console.log("  - Context expected:", contextInfo.entityCount);

				// 🔹 Handle NO MATCHES case
				if (filteredResult.matchCount === 0) {
					console.log("\n❌ NO MATCHES FOUND");
					console.log("  - None of the context items found in current data");

					const noMatchMessage = await generateNoMatchesMessage(userMessage, contextInfo, api.name);

					const htmlMessage = `
<div class="contextual-no-match">
	<p>${noMatchMessage}</p>
	<div class="summary">
		<p><strong>Context details:</strong></p>
		<ul>
			<li>Referenced ${contextInfo.entityType}: ${contextInfo.entityCount} items</li>
			<li>Field checked: ${contextInfo.entityFieldName}</li>
			<li>Matches found: 0</li>
			<li>Total items in ${api.name}: ${filteredResult.originalCount}</li>
		</ul>
		<p><em>Tip: Try asking about different ${contextInfo.entityType} or adjusting your time period.</em></p>
	</div>
</div>
					`.trim();

					await Session.updateOne(
						{ _id: session._id },
						{
							$set: {
								lastResponseMessage: htmlMessage,
								lastSuccessUserMessage: userMessage,
								lastSuccessIntent: api?.name || null,
								lastSuccessApiResponse: actualData,
								lastSuccessParams: params,
								missingField: null,
							},
						}
					);

					console.log("✅ No matches response sent");
					console.log("========================================\n");

					return { userReply: htmlMessage, params, api };
				}

				// 🔹 Update actualData with filtered data
				actualData = filteredResult.filteredData;

				console.log("\n✅ USING FILTERED DATA");
				console.log("  - Filtered to:", actualData.length, "items");
			}
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

		// 🔹 Build enhanced prompt with rolling context
		const prompt = `
You are a smart assistant processing structured API data and answering user questions.

### Context
API Name: ${api.name}
API Description: ${api.description}
User Message: "${userMessage}"
Query Parameters: ${JSON.stringify(params, null, 2)}

${
	isContextual && contextSummary
		? `
### 🎯 CONTEXTUAL QUERY WITH FILTERING APPLIED

**IMPORTANT:** The user asked a follow-up question about items from their previous query.

**Context History (Most Recent First):**
${contextSummary}

**FILTERING APPLIED:**
${
	contextInfo && filteredResult
		? `
- Previous query: "${contextInfo.entityUserMessage}"
- Referenced ${contextInfo.entityType}: ${contextInfo.entityCount} items
- Field used for filtering: ${contextInfo.entityFieldName}
- **MATCHES FOUND: ${filteredResult.matchCount} out of ${contextInfo.entityCount}**
- Original data before filtering: ${filteredResult.originalCount} items

**CRITICAL INSTRUCTIONS:**
1. The data below is ALREADY FILTERED to only include the ${filteredResult.matchCount} matching ${contextInfo.entityType}
2. DO NOT try to show more than ${filteredResult.matchCount} items
3. Acknowledge the context: "For the ${filteredResult.matchCount} ${contextInfo.entityType} from your previous query..."
4. If ${filteredResult.matchCount} < ${contextInfo.entityCount}, mention: "${
				contextInfo.entityCount - filteredResult.matchCount
		  } of them had no data for this request"
5. NEVER add items not in the filtered data below
`
		: ""
}
`
		: ""
}

### Available Data (Filtered to: ${actualData?.length || 0} items)
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
			contextInfo && filteredResult
				? `**Acknowledge the context**: Mention the ${filteredResult.matchCount} ${contextInfo.entityType} found (out of ${contextInfo.entityCount} requested)`
				: "**Process the data** to answer the question"
		}
3. ${
			preCalculatedResults
				? "**Use the pre-calculated results above** - they are accurate and complete"
				: "**Process the data** as needed"
		}
4. **Work ONLY with the ${actualData?.length || 0} items provided** - do not add extras
5. **Choose the best format**:
   - **Tables**: For comparisons, multiple attributes, calculated results
	 - Use <thead> with <th> and <tbody> with <tr><td>
	 - Make headers descriptive and user-friendly
	 - DO NOT include ID field driverId, ClientId in the table
	 - Only show meaningful fields 
   - **Lists**: For simple enumerations
   - **Paragraphs**: For descriptive content
6. **Structure your response**:
   - Introductory <p> sentence ${contextInfo && filteredResult ? `mentioning the ${filteredResult.matchCount} matches` : ""}
   - Main content (table/list/paragraph)
   - <div class="summary"> with:
	 * Exact counts (no vague terms)
	 * ${
			contextInfo && filteredResult && filteredResult.matchCount < contextInfo.entityCount
				? `Mention: "${contextInfo.entityCount - filteredResult.matchCount} had no data"`
				: ""
		}
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
- Include ALL items you showed
- Use exact values from the data

### Output Format
- Output ONLY valid HTML
- No markdown, JSON, or code blocks
- No ID fields (driverId ,ClientId , StationId) in visible content in table
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

		// 🔹 Add to rolling context history (only for non-contextual queries)
		if (!isContextual && displayedInfo && displayedInfo.field && displayedInfo.values && displayedInfo.values.length > 0) {
			console.log("\n🔄 Adding to context history...");

			let entityType = "items";
			if (api.name.toLowerCase().includes("driver")) entityType = "drivers";
			else if (api.name.toLowerCase().includes("shift")) entityType = "shifts";
			else if (api.name.toLowerCase().includes("day")) entityType = "days";
			else if (api.name.toLowerCase().includes("station")) entityType = "stations";

			await session.addToContextHistory(api?.name, displayedInfo.values, displayedInfo.field, entityType, userMessage);
			await session.save();
		} else if (!isContextual && followupItem) {
			// First query - try to extract from response
			console.log("\n🔄 First query - attempting to extract context...");

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

					let entityType = "items";
					if (api.name.toLowerCase().includes("driver")) entityType = "drivers";
					else if (api.name.toLowerCase().includes("shift")) entityType = "shifts";
					else if (api.name.toLowerCase().includes("day")) entityType = "days";

					await session.addToContextHistory(api?.name, extractedValues, followupItem, entityType, userMessage);
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

		const errorMessage = `
<div class="error-response">
	<p>I encountered an issue while processing your request: "${userMessage}"</p>
	<p>Please try again or rephrase your question. If the problem persists, contact support.</p>
	<div class="summary">
		<p><strong>Error details:</strong> ${err.message || "Unknown error"}</p>
	</div>
</div>
		`.trim();

		return {
			userReply: errorMessage,
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
