const { OpenAI } = require("openai");
const apiListData = require("../../apiDetails");
const { searchAPIs } = require("./searchEmbeddings");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Get last bot-generated context with matching intent
function getLastContext(session) {
	const reversed = [...(session.history || [])].reverse();
	for (const entry of reversed) {
		if (entry.sender === "bot" && entry.context?.lastIntent && entry.context?.lastParams) {
			return {
				lastIntent: entry.context.lastIntent,
				lastParams: entry.context.lastParams,
			};
		}
	}
	return null;
}

// Merge all context params from session history
function gatherMergedParams(session) {
	const merged = {};
	for (const entry of session.history || []) {
		if (entry.context?.lastParams) {
			Object.assign(merged, entry.context.lastParams);
		}
	}
	// console.log(merged, "merged params");
	return merged;
}

async function getIntentFromOpenAI(userMessage, session, lastFive, { onStream } = {}) {

	const topApis = await searchAPIs(userMessage);

	const systemPrompt = `
You are an assistant that maps user queries to API operations.

Available APIs:
${topApis.map(
    (api, i) =>
      `${i + 1}. ${api.name}: ${api.description}
     Required fields: ${api.requiredFields && api.requiredFields.length ? api.requiredFields.join(", ") : "None"}`
  )
  .join("\n")}

Conversation context (last 5 messages):
${lastFive.map(m => `${m.sender}: ${m.message}`).join("\n")}

Instructions:
- Decide first if the current user message is **independent** (a fresh query) or **dependent** (requires context from prior conversation).
  * Independent → It can be handled on its own without needing earlier responses.
  * Dependent → The meaning depends on what was said earlier (e.g., "show me the same for yesterday", "and for driver 12", "what about station 5", etc.).

- If Independent:
   * Identify the most appropriate API from the Available APIs list.
   * Extract parameters only if they are explicitly in the message.
   * Do NOT assume or invent values (like ClientId, StationId, etc).
   * For missing required fields, leave them empty.

- If Dependent:
   * Set "dependent": true in the response.
   * Do not resolve intent right now. Just mark it as dependent so the system can combine history + this message.

Respond in EXACTLY this JSON format:
{
  "apiName": "<exact API name from above or null>",
  "params": { /* extracted params */ },
  "dependent": <true or false>
}

If the user's message is casual, small talk, or not related to any API, respond:
{
  "apiName": null,
  "params": {},
  "dependent": false
}

Important:
- DO NOT explain your reasoning.
- DO NOT add comments or extra text.
- Output valid JSON only.
`;

	const completion = await openai.chat.completions.create({
		model: "gpt-3.5-turbo",
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userMessage },
		],
		temperature: 0,
	});

	// console.log("Tokens used for intent extraction:", completion.usage);

	let extracted;

	try {
		extracted = JSON.parse(completion.choices[0].message.content.trim());
	} catch (err) {
		console.error("Failed to parse OpenAI response:", err);
		return { error: "OpenAI parsing failed" };
	}

	const matchedApi = apiListData.find((api) => api.name === extracted.apiName);

	// console.log(matchedApi)

	// Fallback case: No matching API
	if (!matchedApi || extracted.apiName === null) {
		const fallbackPrompt = `
The user sent this message: "${userMessage}"

You're a helpful assistant for a LMDP and DELIVERY MANAGEMENT PLATFORM.

1. If this is a casual message (greeting/small talk like "hi", "how are you", "what's the date"), respond politely and naturally.
2. If it's not casual but related to drivers/platform, explain what you can help with — like:
${apiListData.map((api) => `- ${api.description}`).join("\n")}

DO NOT make up any new APIs. Just respond in a helpful and conversational tone.

Respond ONLY with plain text.
`;

		const fallbackResponse = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [{ role: "system", content: fallbackPrompt }],
			temperature: 0.7,
		});

		const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

		return {
			error: "No API matched",
			fallbackMessage,
		};
	}

	// Proceed with matched API and param handling
	let params = extracted.params || {};
	// console.log(params, "extracted params");
	// 🔹 Normalize parameter keys to match requiredFields casing
	if (matchedApi?.requiredFields?.length) {
		const normalized = {};
		for (const key in params) {
			const matchKey = matchedApi.requiredFields.find((rf) => rf.toLowerCase() === key.toLowerCase());
			if (matchKey) {
				normalized[matchKey] = params[key];
			} else {
				normalized[key] = params[key]; // keep extra non-required params
			}
		}
		params = normalized;
	}

	// Auto-fill ClientId and StationId if required
	if (matchedApi.requiredFields.includes("ClientId") && !params.ClientId) {
		params.ClientId = session.ClientId;
	}
	if (matchedApi.requiredFields.includes("StationId") && !params.StationId) {
		params.StationId = session.StationId;
	}
	let missingFields = matchedApi.requiredFields.filter((f) => !params[f]);

	//  before trying to fetch from last context:
	if (missingFields.length) {
		try {
			// Create a shallow copy so we don't mutate original params
			const tempParams = { ...params };

			// Try calling the handler to see if it fills defaults or can proceed
			const tempResult = await matchedApi.handler(tempParams, userMessage, onStream);

			if (!tempResult?.missingFields) {
				// ✅ Handler already handled everything and likely made the API call
				return {
					api: matchedApi,
					params: tempParams,
					formattedReply: tempResult?.userReply,
				};
			} else {
				// Handler might have reduced missing fields — sync them back
				for (const f of matchedApi.requiredFields) {
					if (!params[f] && tempParams[f]) {
						params[f] = tempParams[f];
					}
				}
			}

			// Recalculate missing fields after handler auto-fill
			missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
		} catch (err) {
			console.warn("Pre-run handler param auto-fill check failed:", err.message);
		}
	}

	//try to fetch missing param from last context from session
	if (missingFields.length && matchedApi?.name !== "GetLMDPMaxQualificationsList") {
		const lastContext = getLastContext(session);
		if (lastContext?.lastIntent === matchedApi.name) {
			for (const field of missingFields) {
				if (lastContext.lastParams[field]) {
					params[field] = lastContext.lastParams[field];
				}
			}
		}
		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	if (missingFields.length && matchedApi?.name !== "GetLMDPMaxQualificationsList") {
		const merged = gatherMergedParams(session);
		for (const field of missingFields) {
			if (merged[field]) {
				params[field] = merged[field];
			}
		}
		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	if (missingFields.length && matchedApi?.name !== "GetLMDPMaxQualificationsList") {
		// console.log("checking missing fields using bot");
		const contextText = session.history.map((h) => `${h.sender}: ${h.message}`).join("\n");

		const resolutionPrompt = `
You are a smart assistant helping resolve missing required fields for API "${matchedApi.name}".
Required fields: ${matchedApi.requiredFields.join(", ")}
User message: "${userMessage}"

Chat history:
${contextText}

Try to infer values for: ${missingFields.join(", ")}

Respond ONLY in JSON:
{
  "resolved": {
    "field1": "value1"
  }
}
If nothing found, return: { "resolved": {} }
`;

		const resolutionResp = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [{ role: "system", content: resolutionPrompt }],
			temperature: 0,
		});

		let resolvedData = {};
		try {
			const parsed = JSON.parse(resolutionResp.choices[0].message.content.trim());
			resolvedData = parsed.resolved || {};
		} catch (err) {
			console.warn("Could not parse field resolution JSON.");
		}
		params = { ...params, ...resolvedData };
		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);

		if (missingFields.length) {
			// Generate a helpful fallback message using OpenAI
			const fallbackHelpPrompt = `
You are a helpful assistant for a Driver Management platform.

The user said: "${userMessage}"
You're trying to call the API "${matchedApi.name}" which requires these fields: ${matchedApi.requiredFields.join(", ")}.

Currently, the following fields are missing: ${missingFields.join(", ")}

Based on the user message and missing fields, generate a friendly and helpful response asking the user to provide the missing info.

Example:
- "To help you assign a shift, I need the DriverId and shiftType. Could you please provide them?"

Respond ONLY with plain text.
`;

			const fallbackResponse = await openai.chat.completions.create({
				model: "gpt-3.5-turbo",
				messages: [{ role: "system", content: fallbackHelpPrompt }],
				temperature: 0.7,
			});

			const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

			return {
				error: "Missing required fields",
				requires: missingFields,
				params,
				api: matchedApi,
				fallbackMessage,
			};
		}
	}

	// Step 3: All fields ready → call API
	try {
		// console.log(matchedApi);
		const apiResponse = await matchedApi.handler(params, userMessage, onStream);
		return {
			api: matchedApi,
			params,
			formattedReply: apiResponse?.userReply,
		};
	} catch (err) {
		console.error("API handler error:", err);
		return { error: "API execution failed" };
	}
}

module.exports = getIntentFromOpenAI;


// ques  -->  ques -->  intent matching  --> intent matched  -->  call api  -->  api response
// 								    --> itent not matched  -->  ques + last response  --> graph  --> frontend handle  
// 																					  --> not graph  --> fallback

// User asks something →
// 	You call OpenAI (intent matcher) → it decides:
// 		Is it new (independent)?
// 		Or dependent on history?

// 	If new intent → extract intent → hit API → call OpenAI again to generate final response.

// 	If dependent on history → combine previous response + current question → ask OpenAI again →
// 		If graph → generate graph.
// 		Else → hit API or respond accordingly.