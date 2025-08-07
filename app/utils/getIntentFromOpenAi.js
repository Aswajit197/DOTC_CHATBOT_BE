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
	const systemPrompt = `
You are an assistant that maps user queries to API operations.

Available APIs:
${apiListData.map((api, i) => `${i + 1}. ${api.name}: ${api.description}`).join("\n")}

Instructions:
- Identify the most appropriate API based on the user's message.
- Extract only the parameters explicitly mentioned in the message.
- Do NOT assume or infer values like ClientId or SessionId from the message unless they are explicitly included.
- For missing required parameters (like ClientId or SessionId), do not include them in "params". The system will later inject them from the session if available.
- Only extract what is present in the user message itself.

Respond in EXACTLY the following JSON format:
{
  "apiName": "<exact API name from above>",
  "params": {
    // extracted parameters based on user message
  }
}

If the user's message is casual, small talk, or does not match any API intent, respond like:
{
  "apiName": null,
  "params": {}
}

Important:
- DO NOT explain your reasoning.
- DO NOT add comments or extra text.
- Only return valid JSON as per the above structure.
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

	// Fallback case: No matching API
	if (!matchedApi || extracted.apiName === null) {
		const fallbackPrompt = `
The user sent this message: "${userMessage}"

You're a helpful assistant for a DRIVER MANAGEMENT PLATFORM.

1. If this is a casual message (greeting/small talk like "hi", "how are you", "what's the date"), respond politely and naturally.
2. If it's not casual but related to drivers/platform, explain what you can help with — like:
${apiListData.map((api) => `- ${api.description}`).join("\n")}

DO NOT make up any new APIs. Just respond in a helpful and conversational tone.

Respond ONLY with plain text.
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

	// Proceed with matched API and param handling
	let params = extracted.params || {};
	// Auto-fill ClientId and StationId if required
	if (matchedApi.requiredFields.includes("ClientId") && !params.ClientId) {
		params.ClientId = session.ClientId;
	}
	if (matchedApi.requiredFields.includes("StationId") && !params.StationId) {
		params.StationId = session.StationId;
	}

	console.log(params)
	let missingFields = matchedApi.requiredFields.filter((f) => !params[f]);

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

	if (missingFields.length) {
		const merged = gatherMergedParams(session);
		for (const field of missingFields) {
			if (merged[field]) {
				params[field] = merged[field];
			}
		}
		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	if (missingFields.length) {
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

		// if (missingFields.length) {
		// 	return {
		// 		error: `Missing required fields: ${missingFields.join(", ")}`,
		// 		requires: missingFields,
		// 		params,
		// 		api: matchedApi,
		// 	};
		// }
		if (missingFields.length) {
			// Generate a helpful fallback message using OpenAI
			const fallbackHelpPrompt = `
You are a helpful assistant for a Driver Management platform.

The user said: "${userMessage}"
You're trying to call the API "${matchedApi.name}" which requires these fields: ${matchedApi.requiredFields.join(", ")}.

Currently, the following fields are missing: ${missingFields.join(", ")}

Based on the user message and missing fields, generate a friendly and helpful response asking the user to provide the missing info.

Example:
- "To help you assign a shift, I need the driverId and shiftType. Could you please provide them?"

Respond ONLY with plain text.
`;

			const fallbackResponse = await openai.chat.completions.create({
				model: "gpt-4",
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
		const apiResponse = await matchedApi.handler(params, userMessage);
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
