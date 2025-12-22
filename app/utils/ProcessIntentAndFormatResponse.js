const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");
const { getNestedValue, performCalculations } = require("../utils/calculations.util");

// ==================================================================================
// AI-POWERED INTENT DETECTION
// ==================================================================================
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

// ==================================================================================
// DATA VALIDATION HELPERS
// ==================================================================================
function isEmptyData(data) {
	if (data === null || data === undefined) return true;
	if (typeof data === "string" && data.trim() === "") return true;
	if (Array.isArray(data) && data.length === 0) return true;
	if (typeof data === "object" && Object.keys(data).length === 0) return true;
	return false;
}

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
		return `I couldn't find any data for your request. There might be no records matching your criteria, or the data might not be available at the moment. Please try adjusting your search parameters or check back later.`;
	}
}

// ==================================================================================
// CONTEXTUAL FILTERING
// ==================================================================================
function applyContextualFilter(actualData, contextInfo) {
	if (!contextInfo || !contextInfo.entityData || !contextInfo.entityFieldName) {
		return {
			filteredData: actualData,
			matchCount: 0,
			contextField: null,
			contextValues: [],
		};
	}

	const { entityData, entityFieldName } = contextInfo;

	console.log("\n🔍 APPLYING CONTEXTUAL FILTER");
	console.log("  - Context field:", entityFieldName);
	console.log("  - Context values count:", entityData.length);
	console.log("  - Data to filter:", Array.isArray(actualData) ? actualData.length : "N/A");

	if (!Array.isArray(actualData)) {
		console.log("  ⚠️ Data is not an array, cannot filter");
		return {
			filteredData: actualData,
			matchCount: 0,
			contextField: entityFieldName,
			contextValues: entityData,
		};
	}

	const normalizedContextValues = entityData.map((v) => String(v).toLowerCase().trim());

	const filteredData = actualData.filter((item) => {
		if (!item || typeof item !== "object") return false;

		const itemValue = getNestedValue(item, entityFieldName);
		if (itemValue === null || itemValue === undefined) return false;

		const normalizedItemValue = String(itemValue).toLowerCase().trim();
		return normalizedContextValues.includes(normalizedItemValue);
	});

	console.log("  ✅ Filtered results:", filteredData.length, "matches");

	if (filteredData.length > 0) {
		console.log(
			"  - Sample matched IDs:",
			filteredResult.slice(0, 3).map((item) => getNestedValue(item, entityFieldName))
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
		return `None of the ${contextInfo.entityCount} ${contextInfo.entityType} from your previous query have any data for this request. You might want to check different ${contextInfo.entityType} or adjust your search criteria.`;
	}
}

// ==================================================================================
// MAIN PROCESSING FUNCTION
// ==================================================================================
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

	try {
		// ============================================================
		// INITIALIZATION & LOGGING
		// ============================================================
		console.log("\n========================================");
		console.log("🚀 PROCESS INTENT (ROLLING CONTEXT)");
		console.log("========================================");
		console.log("API:", api.name);
		console.log("User message:", userMessage);
		console.log("Actual data length:", Array.isArray(actualData) ? actualData.length : "N/A");
		console.log("Is contextual:", isContextual);
		console.log("Follow-up item:", followupItem);
		console.log("Optional filtered fields:", api.optionalFilteredField || "none");

		// ============================================================
		// EMPTY DATA HANDLING (NON-CONTEXTUAL)
		// ============================================================
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

		// ============================================================
		// CONTEXTUAL FILTERING
		// ============================================================
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

				filteredResult = applyContextualFilter(actualData, contextInfo);

				if (filteredResult.matchCount === 0) {
					console.log("\n❌ NO MATCHES FOUND");
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

				actualData = filteredResult.filteredData;
				console.log("\n✅ USING FILTERED DATA - Filtered to:", actualData.length, "items");
			}
		}

		// ============================================================
		// AI INTENT DETECTION & PRE-CALCULATION
		// ============================================================
		console.log("\n🤖 Starting AI intent detection...");
		const calculationIntent = await detectCalculationIntent(userMessage, actualData, api?.description);

		if (abortSignal?.aborted) return { error: "Request aborted" };

		let preCalculatedResults = null;
		if (calculationIntent.needsCalculation && calculationIntent.calculationType !== "none") {
			console.log("📊 Pre-calculation triggered...");
			preCalculatedResults = performCalculations(actualData, calculationIntent);
		}

		// ============================================================
		// BUILD PROMPT FOR AI RESPONSE GENERATION
		// ============================================================
		const prompt = `
You are a smart assistant processing structured API data and answering user questions.

### Context
API Name: ${api.name}
API Description: ${api.description}
User Message: "${userMessage}"
Query Parameters: ${JSON.stringify(params, null, 2)}
${api.optionalFilteredField ? `Optional Filterable Fields: ${api.optionalFilteredField.join(", ")}` : ""}

${
	isContextual && contextSummary
		? `
### 🎯 CONTEXTUAL QUERY WITH FILTERING APPLIED

**Context History:**
${contextSummary}

${
	contextInfo && filteredResult
		? `
**FILTERING APPLIED:**
- Previous query: "${contextInfo.entityUserMessage}"
- Referenced ${contextInfo.entityType}: ${contextInfo.entityCount} items
- **MATCHES FOUND: ${filteredResult.matchCount} out of ${contextInfo.entityCount}**
- Original data before filtering: ${filteredResult.originalCount} items
`
		: ""
}
`
		: ""
}

### Available Data (${actualData?.length || 0} items)
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
2. **Process the data** to answer the question
3. ${preCalculatedResults ? "**Use the pre-calculated results above**" : "Process the data as needed"}
4. **Work ONLY with the ${actualData?.length || 0} items provided**
5. **Choose the best format**:
   - **Tables**: For comparisons, multiple attributes, calculated results
   - **Lists**: For simple enumerations
   - **Paragraphs**: For descriptive content
6. **Structure your response**:
   - Introductory <p> sentence
   - Main content (table/list/paragraph)
   - **IMPORTANT:** Only add a <div class="summary"> with key insights if displaying MULTIPLE items or aggregate data
   - **If displaying a SINGLE specific item** (e.g., one driver, one shift, one record), DO NOT include a summary section
7. **Format dates** in readable format (e.g., "January 15, 2025")

${
	api?.isSuitableForGraph
		? `
8. **Follow-up message decision:**
   - If displaying MULTIPLE items or comparative data, add after summary:
     <p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>
   - If displaying a SINGLE specific item, do NOT add this follow-up message
`
		: ""
}

### CRITICAL: Track What You Display
After your response, add this hidden meta tag with tracking information:

<meta name="displayed-items" content='{"field":"${followupItem}","values":[...], "filterParams": {...}}' />

**Instructions for meta tag:**
1. **field**: "${followupItem}"
2. **values**: Array of ALL ${followupItem} values you actually displayed
3. **filterParams**: ${
			api.optionalFilteredField && api.optionalFilteredField.length > 0
				? `
   - If user asked for SPECIFIC items (e.g., "for Gerald Olson", "driver 1482"):
     Extract the ID and set: {"${api.optionalFilteredField[0]}": 1482}
   - If user asked for ALL items or general query:
     Set to null
   
   **Examples:**
   - "Show OT preference for Gerald Olson" → filterParams: {"DriverId": 1482}
   - "Show all drivers' preferences" → filterParams: null
   - "Give me drivers" → filterParams: null
   `
				: "null"
		}
**Important:** Use exact field names: ${api.optionalFilteredField ? api.optionalFilteredField.join(", ") : "none"}

### Output Format
- Output ONLY valid HTML
- No markdown, JSON, or code blocks
- No ID fields (driverId, ClientId, StationId) in visible table content unless explicitly mentioned in user message
- End with: ###END###

Generate the response now:
`;

		// ============================================================
		// STREAM AI RESPONSE
		// ============================================================
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

		// ============================================================
		// PARSE DISPLAYED ITEMS & FILTER PARAMS FROM META TAG
		// ============================================================
		console.log("\n📊 Parsing displayed items and filter params...");
		const metaMatch = finalReply.match(/<meta\s+name="displayed-items"\s+content='([^']+)'\s*\/?>/);

		let displayedInfo = null;
		let extractedFilterParams = null;

		if (metaMatch) {
			try {
				displayedInfo = JSON.parse(metaMatch[1]);
				console.log("  - Field:", displayedInfo.field);
				console.log("  - Count:", displayedInfo.values?.length);
				console.log("  - Sample:", displayedInfo.values?.slice(0, 5));

				// Extract filter params from meta tag
				if (displayedInfo.filterParams) {
					extractedFilterParams = displayedInfo.filterParams;
					console.log("  ✅ Extracted filter params:", extractedFilterParams);
				} else {
					console.log("  ℹ️ No specific filters detected (showing all items)");
				}
			} catch (e) {
				console.log("  - Failed to parse meta tag:", e.message);
			}
		} else {
			console.log("  - No meta tag found");
		}

		// Remove meta tag from final response
		const cleanReply = finalReply.replace(/<meta[^>]*>/g, "");

		// ============================================================
		// SAVE SESSION
		// ============================================================
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

		// ============================================================
		// ADD TO CONTEXT HISTORY (NON-CONTEXTUAL QUERIES ONLY)
		// ============================================================
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

		// Return with filter params
		return {
			userReply: cleanReply,
			params,
			api,
			filterParams: extractedFilterParams,
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
