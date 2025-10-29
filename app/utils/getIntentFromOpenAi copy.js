//last updated 1 

const { OpenAI } = require("openai");
const apiListData = require("../../apiDetails");
const { searchAPIs } = require("./searchEmbeddings");
const getGraphJsonFromLastResponse = require("./getGraphJsonFromLastReponse");
const refineResponseFromLastResponse = require("./refineResponseFromLastResponse");
const { handleParamsForApi } = require("./handleParamsForApis");
const { handleMultiIntentApis } = require("./handleMultiIntentApis");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getIntentFromOpenAI(userMessage, session, { onStream, abortSignal } = {}) {
	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Already aborted, exiting early");
		return { error: "Request aborted" };
	}

	const topApis = await searchAPIs(userMessage);

	// 🔹 NEW: Build context information for the prompt
	const hasContext = session.contextData?.lastEntities?.length > 0;
	const contextInfo = hasContext
		? `

### 🎯 PREVIOUS QUERY CONTEXT (IMPORTANT!)
The user just completed a previous query:
- Previous API: ${session.lastSuccessIntent || "None"}
- Previous Entity Type: ${session.contextData.lastEntityType || "unknown"}
- Previous Entity Count: ${session.contextData.lastEntityCount || 0}
- Sample Entities: ${
				session.contextData.lastEntities
					?.slice(0, 5)
					.map((e) => e.name)
					.join(", ") || "None"
		  }

**CRITICAL DECISION:**
If the current user message references these previous entities using:
- Pronouns: "they", "them", "their", "theirs"
- Demonstratives: "these", "those"
- References: "the same", "above", "previous", "last"
- Implicit context: "give me hours" (meaning "for those previous drivers")

Then classify as type: "contextual_followup"`
		: "";

	const systemPrompt = `
You are an assistant that maps user queries to API operations.

Available APIs:
${topApis
	.map(
		(api, i) =>
			`${i + 1}. ${api.name}: ${api.description}
     Required fields: ${api.requiredFields && api.requiredFields.length ? api.requiredFields.join(", ") : "None"}`
	)
	.join("\n")}

Session context:
- Last successful user message: ${session.lastSuccessUserMessage || "None"}
- Last successful API intent: ${session.lastSuccessIntent || "None"}
- Last missing field bot message: ${session?.missingField?.lastMissingFieldBotMessage || "None"}
- Last missing API intent: ${session?.missingField?.lastMissingApiIntent || "None"}
- Last known missing fields: ${session?.missingField?.missingFields?.join(", ") || "None"}
- Last known params: ${JSON.stringify(session?.missingField?.lastParams || {})}
${contextInfo}

Current user message:
"${userMessage}"

Instructions:
- Decide the intent type: **independent**, **contextual_followup**, **dependent**, **multi_intent**, **missing field resolution**, or **visualization follow-up**.

### 1. Contextual Follow-up (NEW - HIGHEST PRIORITY!)
**Check this FIRST before anything else!**

If the user message references entities from the previous query:
- Examples: "give me their hours", "show them", "what about those drivers", "give me details for these"
- Keywords: they, them, their, these, those, the same, for them, about them

→ Classify as **contextual_followup**

→ Return JSON in this format:
{
  "apiName": "<exact API name that provides the requested data>",
  "params": { /* extracted params */ },
  "dependent": false,
  "type": "contextual_followup",
  "contextualReference": true,
  "previousEntityType": "${session.contextData?.lastEntityType || "unknown"}",
  "previousEntityCount": ${session.contextData?.lastEntityCount || 0}
}

**Example:**
Previous query: "Give me 15 drivers"
Current message: "Give me their weekly working hours"
Response:
{
  "apiName": "GetDriverWeeklyWorkingHrList",
  "params": { "ClientId": 2 },
  "dependent": false,
  "type": "contextual_followup",
  "contextualReference": true,
  "previousEntityType": "drivers",
  "previousEntityCount": 15
}

### 2. Independent (Single Intent)
If Independent (Fresh query with no reference to previous results):
   * Identify the most appropriate API from the Available APIs list.
   * Extract parameters only if they are explicitly in the message.
   * Do NOT assume or invent values (like ClientId, StationId, etc).
   * Do NOT fill in defaults except ClientId or StationId (which is allowed to default to ${session.ClientId}).

→ Return JSON:
{
  "apiName": "<exact API name from above>",
  "params": { /* extracted params */ },
  "dependent": false,
  "type": "independent"
}

### 3. Multi-Intent Case
If the user message clearly requires **combination of multiple distinct APIs**:

Examples:
- "list all drivers with their overtime preference"
- "show drivers and their shift details"

→ Return JSON:
{
  "apis": [
    { "apiName": "<exact API name from above>", "params": { /* extracted params */ } },
    { "apiName": "<another API name>", "params": { /* extracted params */ } }
  ],
  "dependent": false,
  "type": "multi_intent"
}

Important rule:
- If only **one API** is matched, treat as **single independent intent**, NOT multi_intent.

### 4. Visualization Follow-up
If the user message is a short confirmation (examples: "yes", "yeah", "sure", "ok", "give me a chart", "show me a graph")
AND the prior assistant message ended with a graph/chart offer:

→ Return JSON:
{
  "apiName": null,
  "params": {},
  "dependent": true,
  "type": "visualization_request"
}

### 5. Dependent (General Refinements)
If the user message modifies the LAST response (not referencing previous entities, but refining output):
- Filtering: "only show approved", "exclude declined"
- Reformatting: "show as table", "sort by name"
- Adjusting display: "remove StartDate column"

→ Return JSON:
{
  "apiName": "<exact API name from above>",
  "params": { /* extracted params if any */ },
  "dependent": true,
  "type": "refinement_request"
}

### 6. Missing Field Resolution
If the previous bot response asked for missing fields AND the current message provides those values:

→ Return JSON:
{
  "apiName": "<exact API name from session.lastMissingApiIntent>",
  "params": { /* merge session.missingField.lastParams with new values */ },
  "dependent": false,
  "type": "handle_missing_field"
}

### 7. Casual / Not Related
If casual, small talk, or not related to any API:
{
  "apiName": null,
  "params": {},
  "dependent": false
}

**CRITICAL DECISION TREE:**
1. Check for contextual reference FIRST (they/them/their/these/those) → contextual_followup
2. Check for visualization request → visualization_request
3. Check for missing field resolution → handle_missing_field
4. Check for refinement of last response → refinement_request
5. Check for multi-intent → multi_intent
6. Otherwise → independent

Important:
- DO NOT explain your reasoning.
- DO NOT add comments or extra text.
- Output valid JSON only.
`;

	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Aborted before OpenAI completion call");
		return { error: "Request aborted" };
	}

	let completion;
	try {
		completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
			temperature: 0,
		});
	} catch (error) {
		if (error.name === "AbortError" || abortSignal?.aborted) {
			console.log("🚫 OpenAI completion call was aborted");
			return { error: "Request aborted" };
		}
		throw error;
	}

	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Aborted after OpenAI completion");
		return { error: "Request aborted" };
	}

	let extracted;
	try {
		extracted = JSON.parse(completion.choices[0].message.content.trim());
	} catch (err) {
		console.error("Failed to parse OpenAI response:", err);
		return { error: "OpenAI parsing failed" };
	}

	console.log(extracted,"extracted")

	console.log("\n========================================");
	console.log("🎯 INTENT EXTRACTION RESULT");
	console.log("========================================");
	if (extracted.contextualReference) {
		console.log("Previous Entity Type:", extracted.previousEntityType);
		console.log("Previous Entity Count:", extracted.previousEntityCount);
	}
	console.log("Params:", JSON.stringify(extracted.params));
	console.log("========================================\n");

	const matchedApi = apiListData.find((api) => api.name === extracted.apiName);
	let params = extracted.params || {};

	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Aborted before processing");
		return { error: "Request aborted" };
	}

	// 🔹 NEW: Handle contextual followup
	if (extracted.type === "contextual_followup" && extracted.contextualReference) {
		console.log("\n🎯 CONTEXTUAL FOLLOW-UP DETECTED");
		console.log("Will pass context entities to handler for filtering");

		// Pass context entities to the handler
		const contextEntities = session.contextData?.lastEntities || [];

		if (!matchedApi) {
			return { error: "No API matched for contextual followup" };
		}

		// Proceed with matched API and param handling
		const {
			params: finalParams,
			missingFields,
			formattedReply,
		} = await handleParamsForApi(matchedApi, params, userMessage, session, { onStream, abortSignal });

		params = finalParams;

		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		if (formattedReply) {
			return {
				api: matchedApi,
				params,
				formattedReply,
			};
		}

		if (missingFields.length) {
			// Handle missing fields...
			const fallbackHelpPrompt = `
You are a helpful assistant for a Driver Management platform.
The user said: "${userMessage}"
You are about to call the API: "${matchedApi.name}".
This API requires the following fields: ${matchedApi.requiredFields.join(", ")}.

Already provided/handled fields should NOT be asked again.
The only missing fields are: ${missingFields.join(", ")}.

Your task:
- Politely ask ONLY for the missing fields.
- Respond in plain text, friendly tone.
`;

			let fallbackResponse;
			try {
				fallbackResponse = await openai.chat.completions.create({
					model: "gpt-3.5-turbo",
					messages: [{ role: "system", content: fallbackHelpPrompt }],
					temperature: 0.7,
				});
			} catch (error) {
				if (error.name === "AbortError" || abortSignal?.aborted) {
					return { error: "Request aborted" };
				}
				throw error;
			}

			const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

			return {
				error: "Missing required fields",
				requires: missingFields,
				params,
				api: matchedApi,
				fallbackMessage,
			};
		}

		// Call API with context entities
		try {
			console.log(matchedApi.name, "matched api (contextual)");

			// 🔹 Pass context entities to the handler
			const apiResponse = await matchedApi.handler(
				params,
				userMessage,
				session,
				onStream,
				abortSignal,
				contextEntities // 🔹 NEW: Pass context entities
			);

			if (abortSignal?.aborted) {
				return { error: "Request aborted" };
			}

			return {
				api: matchedApi,
				params,
				formattedReply: apiResponse?.userReply,
				contextEntities, // 🔹 Pass to response for tracking
			};
		} catch (err) {
			if (err.name === "AbortError" || abortSignal?.aborted) {
				return { error: "Request aborted" };
			}
			console.error("API handler error:", err);
			return { error: "API execution failed" };
		}
	}

	// Handle multi-intent
	if (extracted?.type === "multi_intent") {
		console.log("Entering In multi intent....");
		return await handleMultiIntentApis(extracted, userMessage, session, { onStream, abortSignal });
	}

	// Handle dependent cases
	if (extracted.dependent) {
		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		if (extracted.type === "visualization_request") {
			return await getGraphJsonFromLastResponse(userMessage, session, { onStream, abortSignal });
		} else if (extracted.type === "refinement_request") {
			if (session.lastSuccessApiResponse && session.lastSuccessIntent === matchedApi.name) {
				return await refineResponseFromLastResponse(userMessage, session, { onStream, abortSignal });
			} else {
				extracted.dependent = false;
				extracted.type = null;
			}
		} else {
			extracted.dependent = false;
			extracted.type = null;
		}
	}

	// Fallback case: No matching API
	if (!matchedApi || extracted.apiName === null) {
		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		const fallbackPrompt = `
The user sent this message: "${userMessage}"

You're a helpful assistant for a LMDP and DELIVERY MANAGEMENT PLATFORM.

1. If this is a casual message (greeting/small talk), respond politely and naturally.
2. If it's related to drivers/platform, explain what you can help with.

DO NOT make up any new APIs. Just respond in a helpful and conversational tone.
Respond ONLY with plain text.
`;

		let fallbackResponse;
		try {
			fallbackResponse = await openai.chat.completions.create({
				model: "gpt-3.5-turbo",
				messages: [{ role: "system", content: fallbackPrompt }],
				temperature: 0.7,
			});
		} catch (error) {
			if (error.name === "AbortError" || abortSignal?.aborted) {
				return { error: "Request aborted" };
			}
			throw error;
		}

		const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

		return {
			error: "No API matched",
			fallbackMessage,
		};
	}

	if (abortSignal?.aborted) {
		return { error: "Request aborted" };
	}

	// Proceed with matched API and param handling
	const {
		params: finalParams,
		missingFields,
		formattedReply,
	} = await handleParamsForApi(matchedApi, params, userMessage, session, { onStream, abortSignal });

	params = finalParams;

	if (abortSignal?.aborted) {
		return { error: "Request aborted" };
	}

	if (formattedReply) {
		return {
			api: matchedApi,
			params,
			formattedReply,
		};
	}

	if (missingFields.length) {
		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		const fallbackHelpPrompt = `
You are a helpful assistant for a Driver Management platform.
The user said: "${userMessage}"
You are about to call the API: "${matchedApi.name}".
This API requires the following fields: ${matchedApi.requiredFields.join(", ")}.

Already provided/handled fields should NOT be asked again.
The only missing fields are: ${missingFields.join(", ")}.

Your task:
- Politely ask ONLY for the missing fields.
- Respond in plain text, friendly tone.
`;

		let fallbackResponse;
		try {
			fallbackResponse = await openai.chat.completions.create({
				model: "gpt-3.5-turbo",
				messages: [{ role: "system", content: fallbackHelpPrompt }],
				temperature: 0.7,
			});
		} catch (error) {
			if (error.name === "AbortError" || abortSignal?.aborted) {
				return { error: "Request aborted" };
			}
			throw error;
		}

		const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

		return {
			error: "Missing required fields",
			requires: missingFields,
			params,
			api: matchedApi,
			fallbackMessage,
		};
	}

	if (abortSignal?.aborted) {
		return { error: "Request aborted" };
	}

	// Step 3: All fields ready → call API
	try {
		console.log(matchedApi.name, "matched api");
		const apiResponse = await matchedApi.handler(
			params,
			userMessage,
			session,
			onStream,
			abortSignal,
			false // 🔹 isContextual = false (independent query)
		);

		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		return {
			api: matchedApi,
			params,
			formattedReply: apiResponse?.userReply,
		};
	} catch (err) {
		if (err.name === "AbortError" || abortSignal?.aborted) {
			return { error: "Request aborted" };
		}
		console.error("API handler error:", err);
		return { error: "API execution failed" };
	}
}

module.exports = getIntentFromOpenAI;
