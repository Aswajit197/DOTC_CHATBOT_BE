const { OpenAI } = require("openai");
const apiListData = require("../../apiDetails");
const { searchAPIs } = require("./searchEmbeddings");
const getGraphJsonFromLastResponse = require("./getGraphJsonFromLastReponse");
const refineResponseFromLastResponse = require("./refineResponseFromLastResponse");
const { handleParamsForApi } = require("./handleParamsForApis");
const { handleMultiIntentApis } = require("./handleMultiIntentApis");
const processIntentAndFormatResponse = require("./ProcessIntentAndFormatResult");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== HELPER FUNCTIONS =====

// Helper function to dynamically find the primary name/lookup key in a dataset
async function getLookupKeyFromData(dataSample) {
    if (!dataSample || typeof dataSample !== 'object') return null;

    const keys = Object.keys(dataSample);
    const prompt = `
From the following list of object keys, identify the key that most likely represents a primary display name (like a person's name, a location name, or an item name).

Keys: [${keys.join(", ")}]

Example Data: ${JSON.stringify(dataSample)}

Respond with a single JSON object containing the key name, like this:
{"key": "driverName"}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: prompt }],
            temperature: 0,
            response_format: { type: "json_object" },
        });
        const result = JSON.parse(response.choices[0].message.content);
        
        // ✅ Validate the key exists in the data
        if (result.key && dataSample.hasOwnProperty(result.key)) {
            return result.key;
        }
        
        // Fallback: try common name fields
        const fallbackKeys = ['name', 'driverName', 'userName', 'title', 'label', 'id'];
        for (const key of fallbackKeys) {
            if (dataSample.hasOwnProperty(key)) {
                console.log(`⚠️ AI key detection failed, using fallback: ${key}`);
                return key;
            }
        }
        
        return null;
    } catch (error) {
        console.error("Error dynamically finding lookup key:", error);
        
        // Last resort fallback
        const fallbackKeys = ['name', 'driverName', 'userName', 'title', 'label', 'id'];
        for (const key of fallbackKeys) {
            if (dataSample.hasOwnProperty(key)) {
                return key;
            }
        }
        return null;
    }
}

// ===== MAIN FUNCTION =====

async function getIntentFromOpenAI(userMessage, session, { onStream, abortSignal } = {}) {
    // ✅ Inspect session at the start
    console.log("=========================================");
    console.log(`NEW REQUEST: "${userMessage}"`);
    console.log("Inspecting session state at start:", {
        lastSuccessIntent: session.lastSuccessIntent,
        hasApiResponse: !!session.lastSuccessApiResponse,
        apiResponseLength: session.lastSuccessApiResponse?.length || 0,
        lastSuccessUserMessage: session.lastSuccessUserMessage,
    });
    console.log("=========================================");

    // 🔹 Check if already aborted before starting
    if (abortSignal?.aborted) {
        console.log("🚫 getIntentFromOpenAI: Already aborted, exiting early");
        return { error: "Request aborted" };
    }

    const topApis = await searchAPIs(userMessage);
    
    // ✅ Build enriched session context for the LLM
    const sessionContext = `
Session context:
- Last successful user message: ${session.lastSuccessUserMessage || "None"}
- Last successful API intent: ${session.lastSuccessIntent || "None"}
- Last response contained: ${
    session.lastSuccessApiResponse 
        ? `${Array.isArray(session.lastSuccessApiResponse) 
            ? session.lastSuccessApiResponse.length + ' items' 
            : 'single object'}${
                Array.isArray(session.lastSuccessApiResponse) && session.lastSuccessApiResponse[0]
                    ? ' with fields: ' + Object.keys(session.lastSuccessApiResponse[0]).join(', ')
                    : ''
            }`
        : "None"
}
- Last missing field bot message: ${session?.missingField?.lastMissingFieldBotMessage || "None"}
- Last missing API intent: ${session?.missingField?.lastMissingApiIntent || "None"}
- Last known missing fields: ${session?.missingField?.missingFields?.join(", ") || "None"}
- Last known params: ${JSON.stringify(session?.missingField?.lastParams || {})}
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

${sessionContext}

Current user message:
"${userMessage}"

Instructions:
- Decide first if the current user message is **independent** (a fresh query), **dependent** (requires context), **multi-intent** (needs multiple APIs), **missing field resolution** (user is providing previously requested info), or **visualization follow-up**.

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

### Dependent API Call (Follow-up)
If the user's message asks for NEW, RELATED information about the items from the last response (e.g., "for these drivers, get their driving hours" or "what are the contact details for these people?"):
→ Then classify this as a **dependent_api_call**.
→ Identify the next API needed from the list (e.g., GetDriverWeeklyWorkingHrList).
→ Return JSON in this format:
{
  "apiName": "<new API name, e.g., GetDriverWeeklyWorkingHrList>",
  "params": {},
  "dependent": true,
  "type": "dependent_api_call"
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
  "apiName": "<exact API name from above>",
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

    // 🔹 Check abort before OpenAI call
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

    // 🔹 Check abort after OpenAI call
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

    console.log("🎯 Extracted intent:", extracted);

    // ===== HANDLE DEPENDENT API CALL (UNIVERSAL FOLLOW-UP) =====
    if (extracted.type === 'dependent_api_call') {
        console.log("🧠 Handling a UNIVERSAL Dependent API Call...");
        const cachedData = session.lastSuccessApiResponse;

        if (!cachedData || !Array.isArray(cachedData) || cachedData.length === 0) {
            return { error: "I'm sorry, I don't have a previous list to work with." };
        }

        // 1. Dynamically find the lookup key from a sample of the cached data.
        const lookupKey = await getLookupKeyFromData(cachedData[0]);

        if (!lookupKey) {
            return { error: "I couldn't figure out how to identify the items from the last response." };
        }
        console.log(`🤖 AI discovered the lookupKey is: '${lookupKey}'`);

        // 2. Extract the lookup values (e.g., names) dynamically using the discovered key.
        const lookupValues = cachedData.map(item => item[lookupKey]).filter(Boolean);
        console.log(`Found ${lookupValues.length} items to process using key '${lookupKey}':`, lookupValues.slice(0, 5));

        if (lookupValues.length === 0) {
            return { error: `I found the previous data but couldn't extract any values for '${lookupKey}'.` };
        }

        // 3. Find the NEW API handler.
        const nextApi = apiListData.find(api => api.name === extracted.apiName);
        if (!nextApi) { 
            return { error: "I can't seem to find the right tool for that request." };
        }

        try {
            // 4. Call the next API for each item with error handling
            const promises = lookupValues.map(value => 
                nextApi.handler(
                    { [lookupKey]: value, ClientId: session.ClientId }, 
                    userMessage, 
                    session, 
                    onStream, 
                    abortSignal
                ).catch(err => {
                    console.error(`Failed to fetch data for ${lookupKey}=${value}:`, err);
                    return null;
                })
            );
            
            const results = await Promise.allSettled(promises);
            
            // Filter out failed promises
            const successfulResults = results
                .filter(r => r.status === 'fulfilled' && r.value !== null)
                .map(r => r.value);
            
            if (successfulResults.length === 0) {
                return { error: "Failed to fetch additional information for the items." };
            }
            
            // 5. Combine the original data with the new data by matching the dynamic lookupKey.
            const enrichedData = cachedData.map(originalItem => {
                const matchingResult = successfulResults
                    .map(res => res.actualData || res)
                    .flat()
                    .find(resItem => resItem && resItem[lookupKey] === originalItem[lookupKey]);
                
                return { 
                    ...originalItem, 
                    ...(matchingResult || {}),
                    _enrichedWith: nextApi.name
                };
            });
            
            // 6. Call your original formatter, which will also save the session.
            const apiResponse = await processIntentAndFormatResponse({
                userMessage,
                api: nextApi,
                actualData: enrichedData,
                params: { derivedFromContext: true },
                session,
                onStream,
                abortSignal
            });

            return { formattedReply: apiResponse.userReply };

        } catch (error) {
            console.error(`Error in universal dependent API call for ${nextApi.name}:`, error);
            return { error: "I encountered an error while fetching the additional information." };
        }
    }

    const matchedApi = apiListData.find((api) => api.name === extracted.apiName);
    let params = extracted.params || {};

    // 🔹 Check abort before multi-intent handling
    if (abortSignal?.aborted) {
        console.log("🚫 getIntentFromOpenAI: Aborted before multi-intent processing");
        return { error: "Request aborted" };
    }

    if (extracted?.type === "multi_intent") {
        console.log("🔀 Entering multi intent....");
        return await handleMultiIntentApis(extracted, userMessage, session, { onStream, abortSignal });
    }

    // ===== HANDLE DEPENDENT REQUESTS =====
    if (extracted.dependent) {
        // 🔹 Check abort before dependent processing
        if (abortSignal?.aborted) {
            console.log("🚫 getIntentFromOpenAI: Aborted before dependent processing");
            return { error: "Request aborted" };
        }

        if (extracted.type === "visualization_request") {
            console.log("📊 Handling visualization request...");
            return await getGraphJsonFromLastResponse(userMessage, session, { onStream, abortSignal });
        } 
        
        if (extracted.type === "refinement_request") {
            console.log("🔄 Handling refinement request...");
            
            // ✅ Use cached data even if API name doesn't match exactly
            if (session.lastSuccessApiResponse && Array.isArray(session.lastSuccessApiResponse)) {
                console.log("🔄 Using cached data for refinement...");
                return await refineResponseFromLastResponse(
                    userMessage, 
                    session, 
                    matchedApi,
                    { onStream, abortSignal }
                );
            } else {
                console.log("⚠️ No cached data available, treating as independent");
                extracted.dependent = false;
                extracted.type = "independent";
            }
        }
    }

    // ✅ Optimization: If same API is called with similar params, refine existing response
    if (matchedApi?.name === session?.lastSuccessIntent && 
        session.lastSuccessApiResponse && 
        !extracted.dependent) {
        
        console.log("🔁 Same API detected, checking if refinement is appropriate...");
        
        const paramsSimilar = JSON.stringify(params) === JSON.stringify(session.lastSuccessParams);
        
        if (paramsSimilar) {
            console.log("✅ Parameters match, using refinement...");
            return await refineResponseFromLastResponse(
                userMessage, 
                session,
                matchedApi, 
                { onStream, abortSignal }
            );
        } else {
            console.log("⚠️ Parameters differ, making fresh API call...");
        }
    }

    // ===== FALLBACK: NO MATCHING API =====
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

    // 🔹 Check abort before param handling
    if (abortSignal?.aborted) {
        console.log("🚫 getIntentFromOpenAI: Aborted before param handling");
        return { error: "Request aborted" };
    }

    // ===== HANDLE PARAMETERS AND MISSING FIELDS =====
    const {
        params: finalParams,
        missingFields,
        formattedReply,
    } = await handleParamsForApi(matchedApi, params, userMessage, session, { onStream, abortSignal });

    params = finalParams;

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

        console.log("⚠️ Missing fields:", missingFields);
        
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
        console.log("📝 Fallback message:", fallbackMessage);

        return {
            error: "Missing required fields",
            requires: missingFields,
            params,
            api: matchedApi,
            fallbackMessage,
        };
    }

    // 🔹 Check abort before API execution
    if (abortSignal?.aborted) {
        console.log("🚫 getIntentFromOpenAI: Aborted before API execution");
        return { error: "Request aborted" };
    }

    // ===== EXECUTE API CALL (INDEPENDENT) =====
   try {
    console.log("🚀 Executing API:", matchedApi.name);
    
    // Step 1: Call the handler
    const apiResponse = await matchedApi.handler(params, userMessage, session, onStream, abortSignal);

    if (apiResponse.error) {
        return { error: apiResponse.message };
    }

    // 🔍 Check if handler already formatted the response
    if (apiResponse.userReply && typeof apiResponse.userReply === 'string') {
        console.log("✅ Handler already formatted response, using it directly");
        
        // Handler already called processIntentAndFormatResponse
        // Just return the formatted reply
        return {
            formattedReply: apiResponse.userReply,
            api: matchedApi,
            params
        };
    }

    // 🔍 Handler returned raw data, needs formatting
    if (apiResponse.actualData || Array.isArray(apiResponse) || typeof apiResponse === 'object') {
        console.log("✅ Handler returned raw data, formatting now...");
        
        const dataToFormat = apiResponse.actualData || apiResponse;
        
        // Check if data is actually present
        if (Array.isArray(dataToFormat) && dataToFormat.length === 0) {
            console.log("⚠️ Handler returned empty array");
            return { 
                formattedReply: "<p>No results found for your query.</p>",
                api: matchedApi,
                params 
            };
        }
        
        // Step 2: Call formatter which also saves the session
        const finalResult = await processIntentAndFormatResponse({
            userMessage,
            api: matchedApi,
            actualData: dataToFormat,
            params,
            session,
            onStream,
            abortSignal,
        });

        if (finalResult.error) {
            return { error: finalResult.userReply };
        }

        // Step 3: Return the final, formatted reply
        return {
            formattedReply: finalResult.userReply,
            api: matchedApi,
            params
        };
    }

    // Fallback: unexpected response format
    console.error("❌ Unexpected handler response format:", apiResponse);
    return { error: "Unexpected response format from API handler" };
    
} catch (err) {
    if (err.name === "AbortError" || abortSignal?.aborted) {
        console.log("🚫 API handler was aborted");
        return { error: "Request aborted" };
    }
    console.error("❌ API handler error:", err);
    return { error: "API execution failed" };
 }}

module.exports = getIntentFromOpenAI;