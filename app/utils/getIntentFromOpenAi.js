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

    const cleanHistory = (session.history || [])
        .filter(turn => turn.message)
        .map(turn => ({
            role: turn.sender === 'user' ? 'user' : 'assistant',
            content: turn.message
        }));

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
- Last missing field bot message: ${session?.missingField?.lastMissingFieldBotMessage || "None"}
- Last missing API intent: ${session?.missingField?.lastMissingApiIntent || "None"}
- Last known missing fields: ${session?.missingField?.missingFields?.join(", ") || "None"}
- Last known params: ${JSON.stringify(session?.missingField?.lastParams || {})}

Current user message:
"${userMessage}"

Instructions:
- Based on the user's message and the conversation history, determine the correct action.
- YOU MUST RESPOND WITH A VALID JSON OBJECT ONLY. Do not include any other text, explanations, or markdown.

### Independent (Single Intent)
If Independent (Single Intent):
   * Identify the most appropriate API from the Available APIs list.
   * Extract parameters only if they are explicitly in the message.
   * Do NOT assume or invent values (like ClientId, StationId, etc).
   * Do NOT fill in defaults except ClientId or StationId (which is allowed to default to ${session.ClientId}).
   * If week range or year is not mentioned explicitly, leave WeekStarting, WeekEnding, and Year as empty.

### Multi-Intent Case
If the user message clearly requires **combination of multiple distinct APIs**
(i.e., more than one API from the list is needed to fulfill the request):

Examples:
- "list all drivers with their overtime preference"
- "show drivers and their shift details"
- "give me driver contacts with their assigned station"

→ Then classify as a **multi_intent**.

→ Return JSON in this format:
{
  "apis": [
    { "apiName": "<exact API name from above>", "params": { /* extracted params */ } },
    { "apiName": "<another API name>", "params": { /* extracted params */ } }
  ],
  "dependent": false,
  "type": "multi_intent"
}

Important rule:
- If only **one API** is matched (apis array length = 1), 
  it must be treated as a **single independent intent**, not multi_intent,
  even if the user message contains "and" or asks for multiple calculations.

   Absolutely never output type = "multi_intent" when only one API is matched.
   In that case, you must return a single independent intent and must NOT use the key "apis".
 The correct format is:
 {
   "apiName": "<exact API name from above>",
   "params": { ... },
   "dependent": false,
   "type": "independent"
 }


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
- if in the message sessionId or clientId is not explicitly mentioned (and its a required field for the matching api) then take it as 2 as current default

→ Then classify this as a **dependent refinement**.

→ Return JSON in this format:
{
  "apiName": "<exact API name from above>",   // always keep the API name here, not null
  "params": { /* extracted params if any */ },
  "dependent": true,
  "type": "refinement_request"
}

### Missing Field Resolution
If the previous bot response asked for missing fields
AND the current user message provides values that fill those missing fields
(e.g., user responds with "1482" after being asked for DriverId):

→ Then classify this as a **missing field resolution**.

→ Return JSON in this format:
{
  "apiName": "<exact API name from session.lastMissingApiIntent>",
  "params": { /* merge session.missingField.lastParams with new values */ },
  "dependent": false,
  "type": "handle_missing_field"
}

### Casual / Not Related
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
    let completion;
    try {
        completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                ...cleanHistory,
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

    console.log(extracted, "extracted");

    console.log(`--> AI returned API name: "${extracted.apiName}"`);

    const matchedApi = apiListData.find((api) => api.name.toLowerCase() === extracted.apiName?.toLowerCase());
    let params = extracted.params || {};

    console.log("--> Matched API:", matchedApi ? matchedApi.name : "!!! ERROR: API NAME NOT FOUND !!!");

    if (abortSignal?.aborted) {
        console.log("🚫 getIntentFromOpenAI: Aborted before multi-intent processing");
        return { error: "Request aborted" };
    }

    if (extracted?.type === "multi_intent") {
        console.log("Entering In multi intent....");
        return await handleMultiIntentApis(extracted, userMessage, session, { onStream, abortSignal });
    }

    if (extracted.dependent) {
        if (abortSignal?.aborted) {
            console.log("🚫 getIntentFromOpenAI: Aborted before dependent processing");
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

    if (!matchedApi || extracted.apiName === null) {
        if (abortSignal?.aborted) {
            console.log("🚫 getIntentFromOpenAI: Aborted before fallback processing");
            return { error: "Request aborted" };
        }

        const fallbackPrompt = `
The user sent this message: "${userMessage}"

You're a helpful assistant for a LMDP and DELIVERY MANAGEMENT PLATFORM.

1. If this is a casual message (greeting/small talk like "hi", "how are you", "what's the date"), respond politely and naturally.
2. If it's not casual but related to drivers/platform, explain what you can help with — like:
${apiListData.map((api) => `- ${api.description}`).join("\n")}

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
                console.log("🚫 Fallback OpenAI call was aborted");
                return { error: "Request aborted" };
            }
            throw error;
        }

        if (abortSignal?.aborted) {
            console.log("🚫 getIntentFromOpenAI: Aborted after fallback call");
            return { error: "Request aborted" };
        }

        const fallbackMessage = fallbackResponse.choices[0].message.content.trim();
        return {
            error: "No API matched",
            fallbackMessage,
        };
    }

    if (abortSignal?.aborted) {
        console.log("🚫 getIntentFromOpenAI: Aborted before param handling");
        return { error: "Request aborted" };
    }

    const {
        params: finalParams,
        missingFields,
        formattedReply,
    } = await handleParamsForApi(matchedApi, params, userMessage, session, { onStream, abortSignal });

    params = finalParams;

    console.log("--> Fields considered missing:", missingFields);

    if (abortSignal?.aborted) {
        console.log("🚫 getIntentFromOpenAI: Aborted after param handling");
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
            console.log("🚫 getIntentFromOpenAI: Aborted before missing fields processing");
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
- Do not mention fields that are already provided.
- Respond in plain text, friendly tone.

Example format:
"To help you assign a shift, I need the DriverId and shiftType. Could you please provide them?"
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
                console.log("🚫 Missing fields OpenAI call was aborted");
                return { error: "Request aborted" };
            }
            throw error;
        }

        if (abortSignal?.aborted) {
            console.log("🚫 getIntentFromOpenAI: Aborted after missing fields call");
            return { error: "Request aborted" };
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
        console.log("🚫 getIntentFromOpenAI: Aborted before API execution");
        return { error: "Request aborted" };
    }

    try {
        console.log(matchedApi.name, "matched api");
        const apiResponse = await matchedApi.handler(params, userMessage, session, onStream, abortSignal);

        if (abortSignal?.aborted) {
            console.log("🚫 getIntentFromOpenAI: Aborted after API execution");
            return { error: "Request aborted" };
        }

        return {
            api: matchedApi,
            params,
            formattedReply: apiResponse?.userReply,
        };
    } catch (err) {
        if (err.name === "AbortError" || abortSignal?.aborted) {
            console.log("🚫 API handler was aborted");
            return { error: "Request aborted" };
        }
        console.error("API handler error:", err);
        return { error: "API execution failed" };
    }
}
module.exports = getIntentFromOpenAI;