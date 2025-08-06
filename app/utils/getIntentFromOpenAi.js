const { OpenAI } = require("openai");
const apiListData = require("../../apiDetails");

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
	return merged;
}

async function getIntentFromOpenAI(userMessage, session) {
	// Step 1: Ask GPT to identify intent and basic params
	const systemPrompt = `
You are an assistant that maps user queries to API operations.

Available APIs:
${apiListData.map((api, i) => `${i + 1}. ${api.name}: ${api.description}`).join("\n")}

Based on the user's message, respond in JSON:
{
  "apiName": "<exact API name>",
  "params": {
    // extracted fields from user's request
  }
}

Only return JSON. No explanations. If nothing matches, return:
{ "apiName": null, "params": {} }
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
		return { error: "No API matched" };
	}

	let params = extracted.params || {};
	let missingFields = matchedApi.requiredFields.filter((f) => !params[f]);

	// Step 2a: Fill from matching previous context
	if (missingFields.length) {
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

	// Step 2b: Fill from merged history
	if (missingFields.length) {
		const merged = gatherMergedParams(session);
		for (const field of missingFields) {
			if (merged[field]) {
				params[field] = merged[field];
			}
		}
		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	// Step 2c: Use GPT to resolve missing fields from history
	if (missingFields.length) {
		const contextText = session.history.map((h) => `${h.sender}: ${h.message}`).join("\n");

		const resolutionPrompt = `
You are a smart assistant helping resolve missing required fields for API "${matchedApi.name}".
Required fields: ${matchedApi.requiredFields.join(", ")}
User message: "${userMessage}"

Try to infer the values for: ${missingFields.join(", ")} using chat history:

${contextText}

Respond ONLY in JSON:
{
  "resolved": {
    "field1": "value1"
  }
}
If nothing can be resolved, return: { "resolved": {} }
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

	// Step 3: Execute API and return full raw response
	try {
		// const apiResponse = await matchedApi.handler(params);
		const apiResponse = await matchedApi.handler(params, userMessage);
		return {
			api: matchedApi,
			params,
			userMessage,
			apiResponse,
		};
	} catch (err) {
		console.error("API handler error:", err);
		return { error: "API execution failed" };
	}
}

module.exports = getIntentFromOpenAI;
