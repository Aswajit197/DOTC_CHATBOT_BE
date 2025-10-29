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

	// 🔹 Build context information for the prompt
	const hasContext = session.contextHistory?.length > 0;
	const contextInfo = hasContext
		? `

### 🎯 ROLLING CONTEXT HISTORY (IMPORTANT!)
The user has a conversation history with previous queries:

${session.getContextSummary()}

**CRITICAL CONTEXTUAL REFERENCE RULES:**
A query is ONLY contextual_followup if it meets ALL these conditions:
1. Context history EXISTS (not empty)
2. Uses explicit reference words: "they", "them", "their", "these", "those", "the same", "above", "previous", "last", "that", "it"
3. The reference word MUST directly refer to entities from previous results
4. The query CANNOT work standalone without previous context

**Examples of TRUE contextual_followup:**
- Previous: "Give me 10 drivers"
  Current: "Give me their hours" ✅ (uses "their" referring to those 10 drivers)
- Previous: "Show drivers from station 5"
  Current: "What are their schedules?" ✅ (uses "their")
- Previous: "List all drivers"
  Current: "Show me hours for the above drivers" ✅ (uses "above")
- Previous: "Get driver details"
  Current: "Give me weekly hours for previous drivers" ✅ (uses "previous")

**Examples of FALSE contextual_followup (independent queries):**
- Previous: "Give me 10 drivers"
  Current: "Give me drivers time off requests" ❌ (no reference word, asks for ALL drivers)
- Previous: "Show me drivers"
  Current: "Get all driver schedules" ❌ (no reference word, independent query)
- Previous: "List drivers"
  Current: "Show driver overtime preferences" ❌ (no reference to previous results)
- Current: "Give me hours for drivers" ❌ (generic query, no specific reference)

**Key distinction:**
- "Give me their hours" → contextual (refers to specific previous entities)
- "Give me driver hours" → independent (general query for all drivers)
`
		: `
### ⚠️ NO CONTEXT AVAILABLE
There is NO conversation history. Therefore:
- This query CANNOT be contextual_followup
- Treat as independent query regardless of pronouns used
`;

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

### 🚨 CRITICAL PARAMETER EXTRACTION RULES:
**ONLY extract parameters that are EXPLICITLY mentioned in the user message.**

❌ DO NOT auto-fill or assume ANY parameters
❌ DO NOT default ClientId, StationId, or any other field
❌ DO NOT extract parameters from context unless explicitly referenced
❌ DO NOT invent values based on previous queries

✅ ONLY extract if the user literally says it: "driver 1234", "station 5", "client 2"
✅ Leave params empty "{}" if nothing is explicitly mentioned
✅ Missing field handling is done separately - your job is ONLY extraction

**Examples:**
- "Give me 15 drivers" → params: {}  (no specific IDs mentioned)
- "Show driver 1234" → params: { driverId: 1234 }
- "List drivers for station 5" → params: { StationId: 5 }
- "Give me their hours" → params: {}  (context-based, no explicit params)

### 1. Contextual Follow-up (HIGHEST PRIORITY - CHECK CAREFULLY!)
**⚠️ CRITICAL: Only classify as contextual_followup if ALL conditions are met:**

**REQUIRED CONDITIONS (ALL MUST BE TRUE):**
1. ✅ Context history EXISTS (session has previous queries)
2. ✅ Message contains explicit reference words:
   - Pronouns: "they", "them", "their", "theirs"
   - Demonstratives: "these", "those", "that"
   - References: "the same", "above", "previous", "last", "it"
3. ✅ The reference word DIRECTLY refers to entities from previous results
4. ✅ Query CANNOT stand alone without previous context

**If ANY condition fails → classify as independent, NOT contextual_followup**

**⚠️ COMMON FALSE POSITIVES TO AVOID:**
❌ "Give me drivers time off requests" → independent (no reference word)
❌ "Show all driver schedules" → independent (generic, not referring to previous)
❌ "Get driver overtime preferences" → independent (general query)
❌ "List driver hours" → independent (no specific reference)

**✅ TRUE CONTEXTUAL EXAMPLES:**
✅ "Give me their hours" (refers to specific previous drivers)
✅ "Show me details for those drivers" (uses "those")
✅ "What about the previous drivers?" (uses "previous")
✅ "Get hours for above drivers" (uses "above")

**If contextual_followup:**
→ Return JSON in this format:
{
  "apiName": "<exact API name that provides the requested data>",
  "params": {},
  "dependent": false,
  "type": "contextual_followup",
  "contextualReference": true
}

### 2. Independent (Single Intent)
If Independent (Fresh query with no reference to previous results OR no context exists):
   * Identify the most appropriate API from the Available APIs list.
   * Extract parameters ONLY if EXPLICITLY mentioned in the message.
   * DO NOT assume or auto-fill ANY values.

**Common patterns for independent queries:**
- "Give me X drivers"
- "Show driver Y"
- "List all drivers with Z"
- "Get driver schedules"
- Any query without reference words (their/those/previous/etc.)

→ Return JSON:
{
  "apiName": "<exact API name from above>",
  "params": { /* ONLY explicitly mentioned params */ },
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
	{ "apiName": "<exact API name from above>", "params": {} },
	{ "apiName": "<another API name>", "params": {} }
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
  "params": {},
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
1. ⚠️ Check if context history exists → if NO, skip to step 3
2. ⚠️ Check for EXPLICIT contextual reference words (their/those/previous/last/above) AND refers to previous entities → contextual_followup
3. Check for visualization request → visualization_request
4. Check for missing field resolution → handle_missing_field
5. Check for refinement of last response → refinement_request
6. Check for multi-intent → multi_intent
7. Otherwise → independent

**REMEMBER:**
- Without context history → ALWAYS independent
- Without explicit reference words → ALWAYS independent
- Generic queries like "give me driver X" → ALWAYS independent
- Only use contextual_followup when user explicitly refers to previous results

Important:
- DO NOT explain your reasoning.
- DO NOT add comments or extra text.
- Output valid JSON only.
- Be STRICT about contextual_followup classification!
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

	// 🔹 POST-PROCESSING VALIDATION: Enforce contextual rules
	if (extracted.type === "contextual_followup") {
		if (!hasContext) {
			console.log("⚠️ OVERRIDE: No context history exists, changing to independent");
			extracted.type = "independent";
			extracted.contextualReference = false;
		} else {
			// Check for explicit reference words
			const referenceWords = /\b(they|them|their|theirs|these|those|that|above|previous|last|the same|it)\b/i;
			if (!referenceWords.test(userMessage)) {
				console.log("⚠️ OVERRIDE: No reference words found, changing to independent");
				extracted.type = "independent";
				extracted.contextualReference = false;
			}
		}
	}

	console.log("\n========================================");
	console.log("🎯 INTENT EXTRACTION RESULT");
	console.log("========================================");
	console.log("Type:", extracted.type);
	console.log("API:", extracted.apiName);
	console.log("Params:", JSON.stringify(extracted.params));
	console.log("Contextual:", extracted.contextualReference || false);
	console.log("Has Context:", hasContext);
	console.log("========================================\n");

	const matchedApi = apiListData.find((api) => api.name === extracted.apiName);
	let params = extracted.params || {};

	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Aborted before processing");
		return { error: "Request aborted" };
	}

	// 🔹 Handle contextual followup
	if (extracted.type === "contextual_followup" && extracted.contextualReference) {
		console.log("\n🎯 CONTEXTUAL FOLLOW-UP DETECTED");
		console.log("Will use rolling context history for filtering");

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

		// Call API with isContextual flag
		try {
			console.log(matchedApi.name, "matched api (contextual)");

			const apiResponse = await matchedApi.handler(
				params,
				userMessage,
				session,
				onStream,
				abortSignal,
				true // 🔹 isContextual = true
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
			if (session.lastSuccessApiResponse && session.lastSuccessIntent === matchedApi?.name) {
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

	// All fields ready → call API
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

