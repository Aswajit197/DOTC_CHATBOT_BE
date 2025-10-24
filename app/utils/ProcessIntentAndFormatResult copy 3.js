const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");
const { detectContextualReference, filterByContext } = require("./contextHandler");

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

// ===== ENTITY EXTRACTION FROM RESPONSE =====

/**
 * Extracts which entities were actually displayed in the AI's response
 * by parsing the HTML and matching back to the source data
 */
async function extractEntitiesFromResponse(htmlResponse, sourceData, apiName) {
	console.log("\n========================================");
	console.log("🔍 EXTRACTING DISPLAYED ENTITIES FROM RESPONSE");
	console.log("========================================");
	console.log("Source data length:", sourceData.length);
	console.log("API name:", apiName);

	if (!Array.isArray(sourceData) || sourceData.length === 0) {
		console.log("⚠️ Source data is empty or not an array");
		console.log("========================================\n");
		return [];
	}

	try {
		// Ask OpenAI to extract the entity identifiers from the HTML response
		const extractionPrompt = `You are analyzing an HTML response to identify which entities from a dataset were actually displayed.

**HTML Response:**
${htmlResponse}

**Source Data (first 5 items):**
${JSON.stringify(sourceData.slice(0, 5), null, 2)}

**Source Data Structure:**
- Total items in source: ${sourceData.length}
- Fields available: ${Object.keys(sourceData[0] || {}).join(", ")}

**Your Task:**
Extract the identifiers (IDs or names) of entities that were ACTUALLY displayed in the HTML response.

**Instructions:**
1. Look for driver names, IDs, or other identifiers in the HTML (in tables, lists, paragraphs)
2. Match them to the source data
3. Return the IDs or unique identifiers of ONLY the displayed items
4. If you see "Here are 10 drivers" or similar, extract exactly those 10
5. If you see "showing X out of Y", extract only the X that were shown

**Response Format (JSON only):**
{
  "displayedCount": number,
  "identifiers": ["id1", "id2", ...] or [123, 456, ...],
  "identifierType": "driverId" | "name" | "id" | "shiftId",
  "reasoning": "brief explanation of what you found"
}

If the response shows ALL items or you cannot determine specific items, return:
{
  "displayedCount": ${sourceData.length},
  "identifiers": [],
  "identifierType": "all",
  "reasoning": "All items were displayed"
}`;

		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: extractionPrompt }],
			temperature: 0.1,
			response_format: { type: "json_object" },
		});

		const extraction = JSON.parse(response.choices[0].message.content);

		console.log("\n📋 Extraction Results:");
		console.log("  - Displayed count:", extraction.displayedCount);
		console.log("  - Identifier type:", extraction.identifierType);
		console.log("  - Identifiers found:", extraction.identifiers?.length || 0);
		console.log("  - Reasoning:", extraction.reasoning);

		// If all items were displayed or extraction failed, return all source data
		if (extraction.identifierType === "all" || !extraction.identifiers || extraction.identifiers.length === 0) {
			console.log("✅ Using all source data (no filtering detected)");
			console.log("========================================\n");
			return sourceData;
		}

		// Match identifiers back to source data
		const identifierSet = new Set(
			extraction.identifiers.map((id) => {
				// Normalize identifiers (handle both strings and numbers)
				if (typeof id === "string") return id.toLowerCase().trim();
				return id;
			})
		);

		console.log("\n🔍 Matching identifiers to source data...");
		console.log("  - Identifiers to match:", Array.from(identifierSet).slice(0, 5));

		const matchedEntities = sourceData.filter((item) => {
			// Try matching by different fields based on identifierType
			let matched = false;

			if (extraction.identifierType === "driverId" || extraction.identifierType === "id") {
				const itemId = item.driverId || item.id || item.shiftId || item.stationId;
				matched = identifierSet.has(itemId) || identifierSet.has(String(itemId));
			}

			if (!matched && (extraction.identifierType === "name" || extraction.identifierType === "driverName")) {
				const itemName = (item.driverName || item.name || item.description || "").toLowerCase().trim();
				matched = identifierSet.has(itemName);
			}

			// Fallback: try all possible matches
			if (!matched) {
				const itemId = item.driverId || item.id || item.shiftId || item.stationId;
				const itemName = (item.driverName || item.name || item.description || "").toLowerCase().trim();

				matched = identifierSet.has(itemId) || identifierSet.has(String(itemId)) || identifierSet.has(itemName);
			}

			return matched;
		});

		console.log("\n✅ Matching complete:");
		console.log("  - Matched entities:", matchedEntities.length);
		console.log("  - Expected count:", extraction.displayedCount);

		if (matchedEntities.length > 0) {
			console.log("  - First 3 matched:");
			matchedEntities.slice(0, 3).forEach((e, i) => {
				console.log(`    ${i}. ${e.driverName || e.name} (ID: ${e.driverId || e.id})`);
			});
		}

		console.log("========================================\n");

		// If matching failed or count mismatch is too large, fallback to source data
		if (matchedEntities.length === 0 || Math.abs(matchedEntities.length - extraction.displayedCount) > 5) {
			console.warn("⚠️ Matching failed or count mismatch - using source data");
			return sourceData;
		}

		return matchedEntities;
	} catch (error) {
		console.error("❌ Entity extraction failed:", error.message);
		console.log("Falling back to source data");
		console.log("========================================\n");
		return sourceData;
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
}) => {
	let fullText = "";

	try {
		console.log("\n========================================");
		console.log("🚀 PROCESS INTENT AND FORMAT RESPONSE");
		console.log("========================================");
		console.log("API:", api.name);
		console.log("User message:", userMessage);
		console.log("Actual data length:", Array.isArray(actualData) ? actualData.length : "N/A");

		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted before execution");
			return { error: "Request aborted" };
		}

		// 🔹 Check for contextual reference
		const contextCheck = await detectContextualReference(userMessage, session);
		let dataToProcess = actualData;

		if (contextCheck.isContextual && contextCheck.contextualEntities) {
			console.log("\n🎯 CONTEXTUAL QUERY DETECTED - Applying filtering...");
			console.log("Context entities to filter by:", contextCheck.contextualEntities.length);

			// Filter data based on previous context
			dataToProcess = filterByContext(actualData, contextCheck.contextualEntities, session.contextData?.lastEntityType);

			if (dataToProcess.length < actualData.length) {
				console.log(`\n✅ CONTEXT FILTERING SUCCESSFUL:`);
				console.log(`   Before: ${actualData.length} items`);
				console.log(`   After: ${dataToProcess.length} items`);
				console.log(`   Reduction: ${((1 - dataToProcess.length / actualData.length) * 100).toFixed(1)}%`);
			} else {
				console.log(`\n⚠️ WARNING: Context filtering had no effect`);
			}
		} else {
			console.log("\n📋 NO CONTEXT - Processing full dataset");
		}

		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted after context check");
			return { error: "Request aborted" };
		}

		// 🚀 STEP 1: AI-powered intent detection
		console.log("\n🤖 Starting AI intent detection...");
		const calculationIntent = await detectCalculationIntent(userMessage, dataToProcess, api?.description);

		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted after intent detection");
			return { error: "Request aborted" };
		}

		// 🚀 STEP 2: Pre-calculate if needed
		let preCalculatedResults = null;
		if (calculationIntent.needsCalculation && calculationIntent.calculationType !== "none") {
			console.log("📊 Pre-calculation triggered...");
			preCalculatedResults = performCalculations(dataToProcess, calculationIntent);

			if (preCalculatedResults) {
				console.log("✅ Pre-calculation complete:", preCalculatedResults.type);
			}
		} else {
			console.log("ℹ️ No calculation needed");
		}

		// 🚀 STEP 3: Build the intelligent prompt
		const prompt = `
You are a smart assistant processing structured API data and answering user questions.

### Context
API Name: ${api.name}
API Description: ${api.description}
User Message: "${userMessage}"
Query Parameters: ${JSON.stringify(params, null, 2)}

${
	contextCheck.isContextual
		? `
### 🎯 CONTEXTUAL QUERY DETECTED
This query references entities from a previous query:
- Previous Entity Type: ${session.contextData?.lastEntityType || "unknown"}
- Previous Intent: ${session.lastSuccessIntent || "none"}
- Context Applied: Data has been filtered to show only the ${dataToProcess.length} items from the previous result
- Original Count: ${actualData.length} items → Filtered to: ${dataToProcess.length} items

**Important:** The user is asking about "their/them/these/those" referring to the previous ${
				session.contextData?.lastEntityCount
		  } ${session.contextData?.lastEntityType}.
Make sure your response acknowledges this context naturally (e.g., "For the ${dataToProcess.length} drivers you asked about...").
`
		: ""
}

### Available Data
${JSON.stringify(dataToProcess, null, 2)}

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
${contextCheck.isContextual ? "2. **Acknowledge the contextual reference** naturally in your response" : ""}
3. ${
			preCalculatedResults
				? "**Use the pre-calculated results above** - they are accurate and complete"
				: "**Process the filtered data** to answer the question"
		}
4. **Apply any additional filters** mentioned in the user message
5. **Choose the best format** (table/list/paragraph)
6. **Structure your response** with intro, main content, and summary

${
	api?.isSuitableForGraph
		? `
7. **After the summary**, add:
<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>
`
		: ""
}

### Output Format
- Output ONLY valid HTML
- No markdown, JSON, or code blocks
- End with: ###END###

Generate the response now:
`;

		// 🚀 STEP 4: Stream the response
		console.log("\n📤 Streaming response to user...");
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
			stream: true,
		});

		for await (const chunk of completion) {
			if (abortSignal?.aborted) {
				console.log("🚫 processIntentAndFormatResponse: Aborted during streaming");
				return { error: "Request aborted" };
			}

			const delta = chunk.choices?.[0]?.delta?.content || "";
			if (!delta) continue;

			fullText += delta;

			if (fullText.includes("###END###")) break;

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			if (cleaned && onStream) {
				const formatted = cleaned
					.replace(/([a-z])([A-Z])/g, "$1 $2")
					.replace(/(\d)([A-Za-z])/g, "$1 $2")
					.replace(/([a-zA-Z])(\d)/g, "$1 $2");
				onStream(formatted);
			}
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();
		console.log("✅ Response streaming complete");

		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted before session save");
			return { error: "Request aborted" };
		}

		// 🔹 CRITICAL: Extract which entities were actually displayed in the response
		console.log("\n🔍 Extracting entities from AI response...");
		const displayedEntities = await extractEntitiesFromResponse(finalReply, dataToProcess, api?.name);

		console.log("📊 Displayed entities count:", displayedEntities.length);
		console.log("📊 Original data count:", dataToProcess.length);

		// Use displayed entities if extraction was successful, otherwise use processed data
		const dataForContext = displayedEntities.length > 0 ? displayedEntities : dataToProcess;

		console.log("💾 Will store in context:", dataForContext.length, "items");

		// ✅ Save the session
		console.log("\n💾 Saving session and updating context...");
		await Session.updateOne(
			{ _id: session._id },
			{
				$set: {
					lastResponseMessage: finalReply,
					lastSuccessUserMessage: userMessage,
					lastSuccessIntent: api?.name || null,
					lastSuccessApiResponse: actualData, // Store ORIGINAL full data for reference
					lastSuccessParams: params,
					missingField: null,
				},
			}
		);

		// 🔹 Update context data with ONLY the entities that were displayed
		console.log("Calling updateContext with filtered data...");
		await session.updateContext(api?.name, dataForContext);
		await session.save();

		console.log("✅ Response generation complete with context tracking");
		console.log("========================================\n");

		return {
			userReply: finalReply,
			params,
			api,
		};
	} catch (err) {
		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted during error handling");
			return { error: "Request aborted" };
		}

		console.error("❌ processIntentAndFormatResponse error:", err.message);
		return {
			userReply: "Here's the available data. (Intent-based processing failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
