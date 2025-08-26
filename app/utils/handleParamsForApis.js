const { OpenAI } = require("openai");
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

async function handleParamsForApi(matchedApi, params, userMessage, session, onStream) {
	// Normalize parameter casing
	if (matchedApi?.requiredFields?.length) {
		const normalized = {};
		for (const key in params) {
			const matchKey = matchedApi.requiredFields.find((rf) => rf.toLowerCase() === key.toLowerCase());
			if (matchKey) {
				normalized[matchKey] = params[key];
			} else {
				normalized[key] = params[key];
			}
		}
		params = normalized;
	}

	// Auto-fill ClientId & StationId if missing
	if (matchedApi.requiredFields.includes("ClientId") && !params.ClientId) {
		params.ClientId = session.ClientId;
	}
	if (matchedApi.requiredFields.includes("StationId") && !params.StationId) {
		params.StationId = session.StationId;
	}

	let missingFields = matchedApi.requiredFields.filter((f) => !params[f]);

	// 1. Try handler pre-run for defaults
	if (missingFields.length) {
		try {
			const tempParams = { ...params };
			const tempResult = await matchedApi.handler(tempParams, userMessage, onStream);

			if (!tempResult?.missingFields) {
				return {
					params: tempParams,
					formattedReply: tempResult?.userReply,
					missingFields: [],
				};
			} else {
				for (const f of matchedApi.requiredFields) {
					if (!params[f] && tempParams[f]) {
						params[f] = tempParams[f];
					}
				}
			}
			missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
		} catch (err) {
			console.warn("Pre-run handler check failed:", err.message);
		}
	}

	// 2. Try last context
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

	// 3. Try merged params
	if (missingFields.length && matchedApi?.name !== "GetLMDPMaxQualificationsList") {
		const merged = gatherMergedParams(session);
		for (const field of missingFields) {
			if (merged[field]) {
				params[field] = merged[field];
			}
		}
		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	// 4. Try resolving with OpenAI
	
// 	if (missingFields.length && matchedApi?.name !== "GetLMDPMaxQualificationsList") {
// 		console.log("breaking Here");
// 		const contextText = session.history.map((h) => `${h.sender}: ${h.message}`).join("\n");

// 		const resolutionPrompt = `
// You are a smart assistant helping resolve missing required fields for API "${matchedApi.name}".
// Required fields: ${matchedApi.requiredFields.join(", ")}
// User message: "${userMessage}"

// Chat history:
// ${contextText}

// Try to infer values for: ${missingFields.join(", ")}

// Respond ONLY in JSON:
// {
//   "resolved": {
//     "field1": "value1"
//   }
// }
// If nothing found, return: { "resolved": {} }
// `;

// 		const resolutionResp = await openai.chat.completions.create({
// 			model: "gpt-3.5-turbo",
// 			messages: [{ role: "system", content: resolutionPrompt }],
// 			temperature: 0,
// 		});

// 		let resolvedData = {};
// 		try {
// 			const parsed = JSON.parse(resolutionResp.choices[0].message.content.trim());
// 			resolvedData = parsed.resolved || {};
// 		} catch (err) {
// 			console.warn("Could not parse field resolution JSON.");
// 		}
// 		params = { ...params, ...resolvedData };
// 		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
// 	}

	return { params, missingFields };
}

module.exports = { handleParamsForApi };
