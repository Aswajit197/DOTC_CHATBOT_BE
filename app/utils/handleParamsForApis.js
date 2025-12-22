const { OpenAI } = require("openai");
const { getCurrentWeekDates, handleFromDateToDate, formatToISODate } = require("./dateParamsHandler");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Get current ISO week number
function getCurrentWeekNumber() {
	const now = new Date();
	const oneJan = new Date(now.getFullYear(), 0, 1);
	const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
	return Math.ceil((now.getDay() + 1 + numberOfDays) / 7);
}

// Helper to extract date-related fields from OpenAI
// async function extractDateParamsFromOpenAI(userMessage) {
// 	console.log("entered Here 💬💬💬💬");

// 	const currentWeek = getCurrentWeekNumber();
// 	const currentYear = new Date().getFullYear();

// 	const prompt = `
// You are a date parameter extraction assistant. Today's information:
// - Current Week Number: ${currentWeek}
// - Current Year: ${currentYear}

// Extract week and year parameters from the user's message and return the ACTUAL WEEK NUMBERS.

// Rules:
// 1. For "last N weeks" or "past N weeks":
//    - WeekStarting = current week - N + 1
//    - WeekEnding = current week

// 2. For "last week" (singular):
//    - WeekStarting = current week - 1
//    - WeekEnding = current week - 1

// 3. For "current week" or "this week":
//    - WeekStarting = current week
//    - WeekEnding = current week

// 4. For "week N" (specific week):
//    - WeekStarting = N
//    - WeekEnding = N

// 5. If year is mentioned, use it. Otherwise, use current year.

// 6. If no time period is mentioned, return null for all fields.

// User message: "${userMessage}"

// Return ONLY a valid JSON object with actual week numbers (integers):
// {
//   "WeekStarting": number or null,
//   "WeekEnding": number or null,
//   "Year": number or null
// }

// Examples:
// - "last 4 weeks" → {"WeekStarting": ${currentWeek - 4 + 1}, "WeekEnding": ${currentWeek}, "Year": ${currentYear}}
// - "last week" → {"WeekStarting": ${currentWeek - 1}, "WeekEnding": ${currentWeek - 1}, "Year": ${currentYear}}
// - "current week" → {"WeekStarting": ${currentWeek}, "WeekEnding": ${currentWeek}, "Year": ${currentYear}}
// - "week 35" → {"WeekStarting": 35, "WeekEnding": 35, "Year": ${currentYear}}
// `;

// 	try {
// 		const completion = await openai.chat.completions.create({
// 			messages: [{ role: "user", content: prompt }],
// 			model: "gpt-4",
// 			temperature: 0,
// 		});

// 		const response = completion.choices[0].message.content.trim();
// 		console.log(response, "response params");
// 		return JSON.parse(response);
// 	} catch (err) {
// 		console.warn("OpenAI param extraction failed:", err.message);
// 		return {
// 			WeekStarting: null,
// 			WeekEnding: null,
// 			Year: null,
// 		};
// 	}
// }

// Main param handler

async function handleParamsForApi(matchedApi, params, userMessage, session, { onStream, abortSignal } = {}, type) {
	console.log(params, "params in param handler");

	// 🔹 Exit early if aborted
	if (abortSignal?.aborted) {
		console.log("🚫 handleParamsForApi: Aborted before processing");
		return { params, missingFields: matchedApi?.requiredFields || [], formattedReply: null };
	}

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
	const dateFields = ["WeekStarting", "WeekEnding", "Year"];
	const needsDateExtraction = missingFields.some((f) => dateFields.includes(f));

	if (needsDateExtraction) {
		const extracted = await extractDateParamsFromOpenAI(userMessage);

		if (abortSignal?.aborted) {
			console.log("🚫 handleParamsForApi aborted during date extraction");
			return { params, missingFields, formattedReply: null };
		}

		const { WeekStarting, WeekEnding, Year } = extracted;
		const currentWeek = getCurrentWeekNumber();

		// Use the week numbers directly from OpenAI
		if (WeekStarting !== null && WeekStarting !== undefined) {
			params.WeekStarting = WeekStarting;
		}

		if (WeekEnding !== null && WeekEnding !== undefined) {
			params.WeekEnding = WeekEnding;
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
	}

	// 🔹 Handle FromDate / ToDate fields (new logic)
	const fromToFields = ["FromDate", "ToDate"];
	const needsFromToExtraction = missingFields.some((f) => fromToFields.includes(f));

	if (needsFromToExtraction) {
		try {
			const { FromDate, ToDate } = await handleFromDateToDate(userMessage, session.clientWeekStartDay, session.clientWeekEndDay);

			// Validate ISO format or fix it
			params.FromDate = formatToISODate(FromDate);
			params.ToDate = formatToISODate(ToDate);
		} catch (err) {
			console.warn("⚠️ FromDate/ToDate extraction failed, using current week:", err);
			const { FromDate, ToDate } = getCurrentWeekDates();
			params.FromDate = FromDate;
			params.ToDate = ToDate;
		}
	}

	missingFields = matchedApi.requiredFields.filter((f) => !params[f]);
	console.log(params, "final resolved params");
	console.log(missingFields, "missing fields");
	return { params, missingFields };
}

module.exports = { handleParamsForApi };
