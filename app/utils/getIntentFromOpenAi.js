const { OpenAI } = require("openai");
const apiListData = require("../../apiDetails");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function gatherMergedParams(session) {
	const merged = {};
	for (const entry of session.history || []) {
		if (entry.context?.lastParams) {
			Object.assign(merged, entry.context.lastParams);
		}
	}
	return merged;
}

async function getIntentFromOpenAI(userMessage, session) {
	const systemPrompt = `
You are an assistant that maps user queries to API operations.

Below are the available APIs:
${apiListData.map((api, i) => `${i + 1}. ${api.name}: ${api.description}`).join("\n")}

If the user's message clearly maps to one of these API operations, respond in this exact JSON format:
{
  "apiName": "<exact matching API name from above>",
  "params": {
    // extracted params like StationId, driverID, etc.
  }
}

You can also extract advanced filters like:
- "onlyField": if the user wants only like minQualification or hoursPerShift
- "filter": if the user asks for "maximum" or "minimum" values


If the user's message does NOT correspond to any of these API operations (e.g. it's a question about features or general talk), respond with:
{
  "apiName": null,
  "params": {}
}

Do not add any explanation. Only respond with valid JSON.
`;

	const completion = await openai.chat.completions.create({
		model: "gpt-4",
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userMessage },
		],
		temperature: 0,
	});

	let extracted;
	try {
		extracted = JSON.parse(completion.choices[0].message.content.trim());
	} catch (err) {
		console.error("Failed to parse OpenAI response:", err);
		return { error: "OpenAI parsing failed" };
	}

	const matchedApi = apiListData.find((api) => api.name === extracted.apiName);

	if (!matchedApi || extracted.apiName === null) {
		const fallbackPrompt = `
The user sent the message: "${userMessage}"

You are a smart assistant that helps users interact with various APIs for driver and scheduling operations.

Available APIs:
${apiListData.map((api, i) => `${i + 1}. ${api.name}: ${api.description}`).join("\n")}

If the message is just a greeting or small talk (e.g. "hi", "how are you", "what's the date today"), reply politely and naturally.

If the message seems related to driver/scheduling operations but doesn't match an API exactly, explain that you can help with tasks like:
${apiListData.map((api) => `- ${api.description}`).join("\n")}

Don't invent new APIs. Be helpful and concise.

Respond only with plain text (no JSON).
`;

		const fallbackResponse = await openai.chat.completions.create({
			model: "gpt-4",
			messages: [{ role: "system", content: fallbackPrompt }],
			temperature: 0.7,
		});

		const fallbackMessage = fallbackResponse.choices[0].message.content.trim();
		return {
			error: "No API matched",
			fallbackMessage,
		};
	}

	let params = extracted.params || {};
	let missingFields = matchedApi.requiredFields.filter((f) => !params[f]);

	// Step 1: Try from last context (only matching intent)
	if (missingFields.length) {
		const lastContext = getLastContext(session);
		if (lastContext?.lastIntent === extracted.apiName) {
			for (const field of missingFields) {
				if (lastContext.lastParams[field]) {
					params[field] = lastContext.lastParams[field];
				}
			}
		}

		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	// Step 2: Try from merged history
	if (missingFields.length) {
		const historicalParams = gatherMergedParams(session);
		for (const field of missingFields) {
			if (historicalParams[field]) {
				params[field] = historicalParams[field];
			}
		}

		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	// Step 3: Ask GPT to infer from full chat
	if (missingFields.length) {
		const contextHistoryText = session.history.map((h) => `${h.sender}: ${h.message}`).join("\n");

		const resolutionPrompt = `
You are a smart assistant. The user is trying to use API "${
			matchedApi.name
		}" which requires fields: ${matchedApi.requiredFields.join(", ")}.
The current message is: "${userMessage}"

Try to infer the missing fields (${missingFields.join(", ")}) using this chat history:

${contextHistoryText}

Respond ONLY in JSON like this:
{
  "resolved": {
    "field1": "value1",
    ...
  }
}
If you can't resolve, return an empty object.
`;

		const resolutionResp = await openai.chat.completions.create({
			model: "gpt-4",
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
			return {
				error: `Missing required fields: ${missingFields.join(", ")}`,
				requires: missingFields,
				params,
				api: matchedApi,
			};
		}
	}

	// Execute the API
	try {
		const apiResponse = await matchedApi.handler(params);
		return {
			api: matchedApi,
			params,
			apiResponse,
		};
	} catch (err) {
		console.error("API handler error:", err);
		return { error: "API execution failed" };
	}
}

module.exports = getIntentFromOpenAI;
