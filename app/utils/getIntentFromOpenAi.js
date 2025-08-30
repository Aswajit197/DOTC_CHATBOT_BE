const { OpenAI } = require("openai");
const apiListData = require("../../apiDetails");
const { searchAPIs } = require("./searchEmbeddings");
const getGraphJsonFromLastResponse = require("./getGraphJsonFromLastReponse");
const refineResponseFromLastResponse = require("./refineResponseFromLastResponse");
const { handleParamsForApi } = require("./handleParamsForApis");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getIntentFromOpenAI(userMessage, session, { onStream } = {}) {
	const topApis = await searchAPIs(userMessage);

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

Current user message:
"${userMessage}"

Instructions:
- Decide first if the current user message is **independent** (a fresh query) or **dependent** (requires context from session or prior assistant response).
  * Independent → It can be handled on its own without needing earlier responses.
  * Dependent → The meaning depends on what was said earlier (e.g., "show me the same for yesterday", "and for driver 12", "what about station 5", "remove some specific column/data from the table/list", "visualize as graph", etc.).

- If Independent:
   * Identify the most appropriate API from the Available APIs list.
   * Extract parameters only if they are explicitly in the message.
   * Do NOT assume or invent values (like ClientId, StationId, etc).
   * For missing required fields, leave them empty.
   
### Special Case: Visualization Follow-up
If the user message is a short confirmation (examples: "yes", "yeah", "sure", "ok", "give me a chart", "show me a graph", "plot it", "visualize it")
AND the prior assistant message ended with:
<p class="followup-message">Would you like me to turn this into a visualization, such as a graph or chart?</p>

→ Then classify this as a **dependent follow-up for visualization**.

→ Return JSON in this format:
{
  "apiName": null,
  "params": {},
  "dependent": true,
  "type": "visualization_request"
}

### Dependent (General Refinements)
If the user message modifies or refines the last assistant response or successful API result, such as:
- Filtering data (e.g., "only show approved", "exclude declined")
- Adding/removing columns or fields (e.g., "remove StartDate", "just show driver name and status")
- Sorting, grouping, or reformatting the displayed result
- Asking for the same data with small changes (e.g., "for yesterday", "for driver 12")
- when user mentions like lmdp then take it as driver , lmdp means driver like when userMessage is like give leave requests for all lmdps it should consider like give leave requests for all drivers

→ Then classify this as a **dependent refinement**.

→ Return JSON in this format:
{
  "apiName": "<exact API name from above>",   // always keep the API name here, not null
  "params": { /* extracted params if any */ },
  "dependent": true,
  "type": "refinement_request"
}

Respond in EXACTLY this JSON format:
{
  "apiName": "<exact API name from above or null>",
  "params": { /* extracted params */ },
  "dependent": <true or false>,
  "type": "<string or null>" // "visualization_request", "refinement_request", or null
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
		model: "gpt-4o-mini",
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userMessage },
		],
		temperature: 0,
	});

	let extracted;

	try {
		extracted = JSON.parse(completion.choices[0].message.content.trim());
		console.log(extracted, "extracted");
	} catch (err) {
		console.error("Failed to parse OpenAI response:", err);
		return { error: "OpenAI parsing failed" };
	}

	const matchedApi = apiListData.find((api) => api.name === extracted.apiName);
	// If dependent, route based on type
	if (extracted.dependent) {
		if (extracted.type === "visualization_request") {
			return await getGraphJsonFromLastResponse(userMessage, session, { onStream });
		} else if (extracted.type === "refinement_request") {
			if (session.lastSuccessApiResponse && session.lastSuccessIntent === matchedApi.name) {
				// refine only if last response exists
				return await refineResponseFromLastResponse(userMessage, session, { onStream });
			} else {
				// fallback → treat as independent request
				extracted.dependent = false;
				extracted.type = null;
			}
		} else {
			// fallback → treat as independent
			extracted.dependent = false;
			extracted.type = null;
		}
	}

	//reducing api call and token if user intent matches the last intent
	if (matchedApi?.name === session?.lastSuccessIntent) {
		return await refineResponseFromLastResponse(userMessage, session, { onStream });
	}

	// console.log(matchedApi);
	// Fallback case: No matching API   responding user with a proper fallback message
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

	const {
		params: finalParams,
		missingFields,
		formattedReply,
	} = await handleParamsForApi(matchedApi, params, userMessage, session, onStream);

	params = finalParams;

	if (formattedReply) {
		// handler already responded early
		return {
			api: matchedApi,
			params,
			formattedReply,
		};
	}

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

	// Step 3: All fields ready → call API
	try {
		// console.log(matchedApi);
		const apiResponse = await matchedApi.handler(params, userMessage, session, onStream);
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
// 								    --> intent not matched  -->  ques + last response  --> graph  --> frontend handle
// 																					  --> not graph  --> fallback
// User asks something →
// 	You call OpenAI (intent matcher) → it decides:
// 		Is it new (independent)?
// 		Or dependent on history?

// 	If new intent → extract intent → hit API → call OpenAI again to generate final response.

// 	If dependent on history → combine previous response + current question → ask OpenAI again →
// 		If graph → generate graph.
// 		Else → hit API or respond accordingly.

//enhancements
//if
// if (matchedApi?.name === session?.lastSuccessIntent) {
// then should call the refineResponseFromLastResponse  with the existing last response
// }

// json for graph not coming proper need to include   //done
