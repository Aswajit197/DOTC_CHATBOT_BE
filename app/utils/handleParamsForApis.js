const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Get last context from session
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

// Merge all historic params
function gatherMergedParams(session) {
	const merged = {};
	for (const entry of session.history || []) {
		if (entry.context?.lastParams) {
			Object.assign(merged, entry.context.lastParams);
		}
	}
	return merged;
}

// Get current ISO week number
function getCurrentWeekNumber() {
	const now = new Date();
	const oneJan = new Date(now.getFullYear(), 0, 1);
	const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
	return Math.ceil((now.getDay() + 1 + numberOfDays) / 7);
}

// Resolve natural descriptions into week numbers
function resolveWeekDescription(desc) {
	const currentWeek = getCurrentWeekNumber();

	if (!desc || desc.trim() === "") return null;
	desc = desc.toLowerCase().trim();

	if (desc.includes("current")) return currentWeek;

	const matchLastWeeks = desc.match(/last (\d+) weeks?/);
	if (matchLastWeeks) {
		const n = parseInt(matchLastWeeks[1], 10);
		// For "last 3 weeks", we want to start 3 weeks ago
		const startWeek = currentWeek - n + 1;
		return startWeek >= 1 ? startWeek : 1;
	}

	const matchLastWeek = desc.match(/last week/);
	if (matchLastWeek) {
		return currentWeek - 1 >= 1 ? currentWeek - 1 : 1;
	}

	const matchWeekNumber = desc.match(/week (\d+)/);
	if (matchWeekNumber) {
		return parseInt(matchWeekNumber[1], 10);
	}

	return null;
}

// Helper to extract date-related fields from OpenAI
async function extractDateParamsFromOpenAI(userMessage) {
	const prompt = `
Extract the following fields from the user message if mentioned, else return null:
- WeekStartingDescription (natural description like "last 3 weeks", "week 32", "current week")
- WeekEndingDescription (natural description like "current week", "week 37")
- Year (4-digit integer or null)

User message: "${userMessage}"

Return a valid JSON object like:
{
  "WeekStartingDescription": string or null,
  "WeekEndingDescription": string or null,
  "Year": number or null
}
`;

	try {
		const completion = await openai.chat.completions.create({
			messages: [{ role: "user", content: prompt }],
			model: "gpt-4",
			temperature: 0,
		});

		const response = completion.choices[0].message.content.trim();
		return JSON.parse(response);
	} catch (err) {
		console.warn("OpenAI param extraction failed:", err.message);
		return {
			WeekStartingDescription: null,
			WeekEndingDescription: null,
			Year: null,
		};
	}
}

// Main param handler
async function handleParamsForApi(matchedApi, params, userMessage, session, onStream, type) {
	console.log(params, "params in param handler");
	// Normalize casing
	if (matchedApi?.requiredFields?.length) {
		const normalized = {};
		for (const key in params) {
			const matchKey = matchedApi.requiredFields.find((rf) => rf.toLowerCase() === key.toLowerCase());
			if (matchKey) normalized[matchKey] = params[key];
			else normalized[key] = params[key];
		}
		params = normalized;
	}

	// Auto-fill ClientId & StationId
	if (matchedApi.requiredFields.includes("ClientId") && !params.ClientId) {
		params.ClientId = session.ClientId;
	}
	if (matchedApi.requiredFields.includes("StationId") && !params.StationId) {
		params.StationId = session.StationId;
	}

	let missingFields = matchedApi.requiredFields.filter((f) => !params[f]);

	// Pre-run handler
	if (missingFields.length) {
		try {
			const tempParams = { ...params };
			let tempResult;
			if (type === "multi_intent") {
				tempResult = await matchedApi.multiHandler(tempParams, userMessage, session, onStream);
			} else {
				tempResult = await matchedApi.handler(tempParams, userMessage, session, onStream);
			}

			if (!tempResult?.missingFields) {
				return {
					params: tempParams,
					formattedReply: tempResult?.userReply,
					missingFields: [],
				};
			} else {
				for (const f of matchedApi.requiredFields) {
					if (!params[f] && tempParams[f]) params[f] = tempParams[f];
				}
			}

			missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
		} catch (err) {
			console.warn("Pre-run handler check failed:", err.message);
		}
	}

	// OpenAI-based intelligent extraction
	const dateFields = ["WeekStarting", "WeekEnding", "Year"];
	const needsDateExtraction = missingFields.some((f) => dateFields.includes(f));

	if (needsDateExtraction) {
		const extracted = await extractDateParamsFromOpenAI(userMessage);
		console.log("OpenAI extracted:", extracted);

		const { WeekStartingDescription, WeekEndingDescription, Year } = extracted;
		const currentWeek = getCurrentWeekNumber();

		// Resolve week numbers based on OpenAI's intelligent parsing
		if (WeekStartingDescription) {
			const resolvedStart = resolveWeekDescription(WeekStartingDescription);
			if (resolvedStart !== null) {
				params.WeekStarting = resolvedStart;
			}
		}

		if (WeekEndingDescription) {
			const resolvedEnd = resolveWeekDescription(WeekEndingDescription);
			if (resolvedEnd !== null) {
				params.WeekEnding = resolvedEnd;
			}
		}

		// Set year
		if (Number.isInteger(Year)) {
			params.Year = Year;
		} else {
			params.Year = new Date().getFullYear();
		}

		// Final fallback: if still missing required fields, default to current week
		if (matchedApi.requiredFields.includes("WeekStarting") && !params.WeekStarting) {
			params.WeekStarting = currentWeek;
		}
		if (matchedApi.requiredFields.includes("WeekEnding") && !params.WeekEnding) {
			params.WeekEnding = currentWeek;
		}

		missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	}

	console.log(params, "final resolved params");
	console.log(missingFields, "missing fields");

	return { params, missingFields };
}

module.exports = { handleParamsForApi };

// Last context fallback
// if (missingFields.length && matchedApi?.name !== "GetLMDPMaxQualificationsList") {
// 	const lastContext = getLastContext(session);
// 	if (lastContext?.lastIntent === matchedApi.name) {
// 		for (const field of missingFields) {
// 			if (lastContext.lastParams[field]) {
// 				params[field] = lastContext.lastParams[field];
// 			}
// 		}
// 	}
// 	missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
// }

// // Merged params fallback
// if (missingFields.length && matchedApi?.name !== "GetLMDPMaxQualificationsList") {
// 	const merged = gatherMergedParams(session);
// 	for (const field of missingFields) {
// 		if (merged[field]) {
// 			params[field] = merged[field];
// 		}
// 	}
// 	missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
// }
