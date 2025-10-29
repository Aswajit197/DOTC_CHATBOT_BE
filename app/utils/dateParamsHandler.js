const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== DATE UTILITY FUNCTIONS =====

/**
 * Get current ISO week number
 */
function getCurrentWeekNumber() {
	const now = new Date();
	const oneJan = new Date(now.getFullYear(), 0, 1);
	const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
	return Math.ceil((now.getDay() + 1 + numberOfDays) / 7);
}

/**
 * Get start date (Monday) of a given week number and year
 */
function getStartDateOfWeek(weekNumber, year) {
	const firstDayOfYear = new Date(year, 0, 1);
	const daysOffset = (weekNumber - 1) * 7;
	const startDate = new Date(firstDayOfYear);
	startDate.setDate(firstDayOfYear.getDate() + daysOffset);

	// Adjust to Monday (if not already)
	const dayOfWeek = startDate.getDay();
	const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	startDate.setDate(startDate.getDate() + daysToMonday);

	return startDate;
}

/**
 * Get end date (Sunday) of a given week number and year
 */
function getEndDateOfWeek(weekNumber, year) {
	const startDate = getStartDateOfWeek(weekNumber, year);
	const endDate = new Date(startDate);
	endDate.setDate(startDate.getDate() + 6); // Add 6 days to get Sunday
	return endDate;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Get current week's start (Monday) and end (Sunday) dates
 */
function getCurrentWeekDates() {
	const currentWeek = getCurrentWeekNumber();
	const currentYear = new Date().getFullYear();

	return {
		FromDate: formatDate(getStartDateOfWeek(currentWeek, currentYear)),
		ToDate: formatDate(getEndDateOfWeek(currentWeek, currentYear)),
	};
}

// ===== AI-POWERED DATE EXTRACTION =====

/**
 * Extract date parameters from user message using OpenAI
 * Handles week-based queries and converts them to FromDate/ToDate
 */
async function extractDateParamsFromOpenAI(userMessage) {
	console.log("\n📅 Extracting date parameters from user message...");

	const currentWeek = getCurrentWeekNumber();
	const currentYear = new Date().getFullYear();

	const prompt = `
You are a date parameter extraction assistant. Today's information:
- Current Week Number: ${currentWeek}
- Current Year: ${currentYear}
- Today's Date: ${new Date().toISOString().split("T")[0]}

Extract week and year parameters from the user's message and return the ACTUAL WEEK NUMBERS.

Rules:
1. For "last N weeks" or "past N weeks": 
   - WeekStarting = current week - N + 1
   - WeekEnding = current week
   
2. For "last week" (singular):
   - WeekStarting = current week - 1
   - WeekEnding = current week - 1
   
3. For "current week" or "this week":
   - WeekStarting = current week
   - WeekEnding = current week
   
4. For "week N" (specific week):
   - WeekStarting = N
   - WeekEnding = N

5. For "next week":
   - WeekStarting = current week + 1
   - WeekEnding = current week + 1

6. For "next N weeks":
   - WeekStarting = current week + 1
   - WeekEnding = current week + N
   
7. If year is mentioned, use it. Otherwise, use current year.

8. If no time period is mentioned, return null for all fields.

User message: "${userMessage}"

Return ONLY a valid JSON object with actual week numbers (integers):
{
  "WeekStarting": number or null,
  "WeekEnding": number or null,
  "Year": number or null
}

Examples:
- "last 4 weeks" → {"WeekStarting": ${currentWeek - 4 + 1}, "WeekEnding": ${currentWeek}, "Year": ${currentYear}}
- "last week" → {"WeekStarting": ${currentWeek - 1}, "WeekEnding": ${currentWeek - 1}, "Year": ${currentYear}}
- "current week" → {"WeekStarting": ${currentWeek}, "WeekEnding": ${currentWeek}, "Year": ${currentYear}}
- "this week" → {"WeekStarting": ${currentWeek}, "WeekEnding": ${currentWeek}, "Year": ${currentYear}}
- "week 35" → {"WeekStarting": 35, "WeekEnding": 35, "Year": ${currentYear}}
- "no time mentioned" → {"WeekStarting": null, "WeekEnding": null, "Year": null}
`;

	try {
		const completion = await openai.chat.completions.create({
			messages: [{ role: "user", content: prompt }],
			model: "gpt-4o-mini",
			temperature: 0,
		});

		const response = completion.choices[0].message.content.trim();
		console.log("📅 AI Response:", response);

		const parsed = JSON.parse(response);
		console.log("📅 Parsed params:", parsed);

		return parsed;
	} catch (err) {
		console.warn("⚠️ OpenAI param extraction failed:", err.message);
		return {
			WeekStarting: null,
			WeekEnding: null,
			Year: null,
		};
	}
}

/**
 * Main handler to extract and format FromDate and ToDate
 * @param {string} userMessage - The user's query
 * @returns {Promise<{FromDate: string, ToDate: string}>} - Formatted dates (YYYY-MM-DD)
 */
async function handleFromDateToDate(userMessage) {
	console.log("\n🔍 Handling FromDate and ToDate extraction...");
	console.log("User message:", userMessage);

	// Extract week parameters using AI
	const { WeekStarting, WeekEnding, Year } = await extractDateParamsFromOpenAI(userMessage);

	// If no date hints in message, use current week
	if (WeekStarting === null || WeekEnding === null) {
		console.log("📅 No date hints found - using current week");
		const currentWeekDates = getCurrentWeekDates();
		console.log("📅 Current week dates:", currentWeekDates);
		return currentWeekDates;
	}

	// Use provided year or default to current year
	const year = Year || new Date().getFullYear();

	// Convert week numbers to actual dates
	const FromDate = formatDate(getStartDateOfWeek(WeekStarting, year));
	const ToDate = formatDate(getEndDateOfWeek(WeekEnding, year));

	console.log("📅 Extracted dates:");
	console.log("  - Week Range:", `Week ${WeekStarting} - Week ${WeekEnding}, ${year}`);
	console.log("  - FromDate:", FromDate);
	console.log("  - ToDate:", ToDate);

	return { FromDate, ToDate };
}

// ===== UPDATED API HANDLER =====

/**
 * Updated GetDriverWeeklyWorkingHrList handler with date extraction
 */
const GetDriverWeeklyWorkingHrListHandler = async (params, userMessage, session, onStream, abortSignal, isContextual = false) => {
	console.log("\n🔹 GetDriverWeeklyWorkingHrList Handler");

	if (abortSignal?.aborted) {
		console.log("🚫 GetDriverWeeklyWorkingHrList handler: Aborted before execution");
		return { error: "Request aborted" };
	}

	// Set default ClientId if not provided
	if (!params?.ClientId) params.ClientId = session.ClientId || 2;

	// 🔹 Handle FromDate and ToDate extraction
	if (!params.FromDate || !params.ToDate) {
		console.log("\n⚠️ FromDate or ToDate missing - extracting from user message...");

		try {
			const { FromDate, ToDate } = await handleFromDateToDate(userMessage);
			params.FromDate = FromDate;
			params.ToDate = ToDate;

			console.log("✅ Date parameters set:");
			console.log("  - FromDate:", params.FromDate);
			console.log("  - ToDate:", params.ToDate);
		} catch (err) {
			console.error("❌ Date extraction failed:", err.message);

			// Fallback to current week
			const currentWeekDates = getCurrentWeekDates();
			params.FromDate = currentWeekDates.FromDate;
			params.ToDate = currentWeekDates.ToDate;

			console.log("⚠️ Using current week as fallback:", params.FromDate, "-", params.ToDate);
		}
	}

	try {
		if (abortSignal?.aborted) {
			console.log("🚫 GetDriverWeeklyWorkingHrList handler: Aborted before axios call");
			return { error: "Request aborted" };
		}

		// Build API URL with all parameters
		const apiUrl = `${API_BASE}/GetDriverWeeklyWorkingHrList?ClientId=${params.ClientId}&FromDate=${params.FromDate}&ToDate=${params.ToDate}`;
		console.log("📡 API URL:", apiUrl);

		const { data } = await axios.get(apiUrl);
		console.log("📊 API Response length:", data?.data?.length);

		if (abortSignal?.aborted) {
			console.log("🚫 GetDriverWeeklyWorkingHrList handler: Aborted after axios call");
			return { error: "Request aborted" };
		}

		const driversWeeklyWorkingHrList =
			data?.data?.map((item) => ({
				driverId: item?.driverId,
				driverName: item?.driverName,
				hours: item?.hours,
			})) || [];

		console.log("📋 Processed data length:", driversWeeklyWorkingHrList.length);
		console.log("📋 Sample item:", driversWeeklyWorkingHrList[0]);

		return await processIntentAndFormatResponse({
			userMessage,
			api: {
				name: "GetDriverWeeklyWorkingHrList",
				description:
					"Returns a list of drivers with their total weekly working hours preference for the given station and date range.",
				isSuitableForGraph: true,
			},
			exampleResponse: [
				{ driverId: 1482, driverName: "Alejandro Reyes", hours: 30 },
				{ driverId: 1484, driverName: "Hele Reyes", hours: 40 },
			],
			actualData: driversWeeklyWorkingHrList,
			params,
			session,
			onStream,
			abortSignal,
			isContextual,
			followupItem: "driverId",
		});
	} catch (err) {
		if (abortSignal?.aborted) {
			console.log("🚫 GetDriverWeeklyWorkingHrList handler: Aborted during execution");
			return { error: "Request aborted" };
		}

		console.error("❌ API Error:", err.message);
		return {
			error: true,
			message: err.response?.data?.message || "Failed to fetch drivers' working hours list.",
		};
	}
};
function formatToISODate(dateStr) {
	if (!dateStr) return null;
	try {
		const d = new Date(dateStr);
		if (!isNaN(d.getTime())) {
			return d.toISOString().split("T")[0]; // 'YYYY-MM-DD'
		}
		return null;
	} catch {
		return null;
	}
}


// ===== EXPORTS =====

module.exports = {
	getCurrentWeekNumber,
	getStartDateOfWeek,
	getEndDateOfWeek,
	formatDate,
    getCurrentWeekDates,
    formatToISODate,
	extractDateParamsFromOpenAI,
	handleFromDateToDate,
	GetDriverWeeklyWorkingHrListHandler,
};
