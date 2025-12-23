const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== DATE UTILITY FUNCTIONS =====

/**
 * Map day name to day number (0 = Sunday, 1 = Monday, etc.)
 */
function getDayNumber(dayName) {
	const days = {
		Sunday: 0,
		Monday: 1,
		Tuesday: 2,
		Wednesday: 3,
		Thursday: 4,
		Friday: 5,
		Saturday: 6,
	};
	return days[dayName] !== undefined ? days[dayName] : 0;
}

/**
 * Get the day name from day number
 */
function getDayName(dayNumber) {
	const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	return days[dayNumber] || "Sunday";
}

/**
 * Get current week number based on custom week start day
 * @param {string} weekStartDay - Client's week start day (e.g., "Monday")
 */
function getCurrentWeekNumber(weekStartDay = "Sunday") {
	const now = new Date();
	const weekStartNum = getDayNumber(weekStartDay);

	// Calculate the most recent week start date
	const currentDayNum = now.getDay();
	let daysToSubtract = (currentDayNum - weekStartNum + 7) % 7;

	const weekStart = new Date(now);
	weekStart.setDate(now.getDate() - daysToSubtract);

	// Find the first week start day of the year
	const startOfYear = new Date(now.getFullYear(), 0, 1);
	const firstWeekStart = new Date(startOfYear);
	const dayOfWeek = startOfYear.getDay();
	const daysToFirstWeekStart = (weekStartNum - dayOfWeek + 7) % 7;

	if (daysToFirstWeekStart !== 0) {
		firstWeekStart.setDate(startOfYear.getDate() + daysToFirstWeekStart);
	}

	// Calculate week number
	const daysDiff = Math.floor((weekStart - firstWeekStart) / (24 * 60 * 60 * 1000));
	const weekNumber = Math.floor(daysDiff / 7) + 1;

	return Math.max(1, weekNumber);
}

/**
 * Get start date of a given week number based on custom week start day
 * @param {number} weekNumber - Week number
 * @param {number} year - Year
 * @param {string} weekStartDay - Client's week start day
 */
function getStartDateOfWeek(weekNumber, year, weekStartDay = "Sunday") {
	const weekStartNum = getDayNumber(weekStartDay);

	// Find the first occurrence of the week start day in the year
	const startOfYear = new Date(year, 0, 1);
	const firstWeekStart = new Date(startOfYear);
	const dayOfWeek = startOfYear.getDay();
	const daysToFirstWeekStart = (weekStartNum - dayOfWeek + 7) % 7;

	if (daysToFirstWeekStart !== 0) {
		firstWeekStart.setDate(startOfYear.getDate() + daysToFirstWeekStart);
	}

	// Add (weekNumber - 1) weeks
	const targetDate = new Date(firstWeekStart);
	targetDate.setDate(firstWeekStart.getDate() + (weekNumber - 1) * 7);

	console.log("Start Date Calculated:", targetDate);
	return targetDate;
}

/**
 * Get end date of a given week number based on custom week end day
 * @param {number} weekNumber - Week number
 * @param {number} year - Year
 * @param {string} weekStartDay - Client's week start day
 * @param {string} weekEndDay - Client's week end day
 */

function getEndDateOfWeek(weekNumber, year, weekStartDay = "Sunday", weekEndDay = "Saturday") {
	const startDate = getStartDateOfWeek(weekNumber, year, weekStartDay);

	// Calculate days between start and end
	const startNum = getDayNumber(weekStartDay);
	const endNum = getDayNumber(weekEndDay);
	const daysDiff = (endNum - startNum + 7) % 7;

	const endDate = new Date(startDate);
	endDate.setDate(startDate.getDate() + daysDiff);
	console.log("End Date Calculated:", endDate);

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
 * Get current week's start and end dates based on client's week configuration
 */
function getCurrentWeekDates(weekStartDay = "Sunday", weekEndDay = "Saturday") {
	const currentWeek = getCurrentWeekNumber(weekStartDay);
	const currentYear = new Date().getFullYear();

	const fromDate = formatDate(getStartDateOfWeek(currentWeek, currentYear, weekStartDay));
	const toDate = formatDate(getEndDateOfWeek(currentWeek, currentYear, weekStartDay, weekEndDay));

	console.log("\n📅 Current Week Dates (Dynamic):");
	console.log(`  - Week ${currentWeek}, ${currentYear}`);
	console.log(`  - ${weekStartDay} (FromDate): ${fromDate}`);
	console.log(`  - ${weekEndDay} (ToDate): ${toDate}`);

	return {
		FromDate: fromDate,
		ToDate: toDate,
	};
}

// ===== AI-POWERED DATE EXTRACTION =====

/**
 * Extract date parameters from user message using OpenAI
 * Now handles dynamic week start/end days
 */
async function extractDateParamsFromOpenAI(userMessage, weekStartDay = "Sunday", weekEndDay = "Saturday") {
	console.log("\n📅 Extracting date parameters from user message...");

	const currentWeek = getCurrentWeekNumber(weekStartDay);
	const currentYear = new Date().getFullYear();

	// Get actual current week dates for reference
	const currentWeekDates = getCurrentWeekDates(weekStartDay, weekEndDay);

	const prompt = `
You are a date parameter extraction assistant. Today's information:
- Current Week Number: ${currentWeek}
- Current Year: ${currentYear}
- Today's Date: ${new Date().toISOString().split("T")[0]}
- Client's Week Configuration: ${weekStartDay} to ${weekEndDay}
- Current Week Range: ${currentWeekDates.FromDate} (${weekStartDay}) to ${currentWeekDates.ToDate} (${weekEndDay})

Extract week and year parameters from the user's message and return the ACTUAL WEEK NUMBERS.

**IMPORTANT: Weeks run from ${weekStartDay} to ${weekEndDay} for this client**

Rules:
1. For "last N weeks" or "past N weeks": 
   - WeekStarting = current week - N
   - WeekEnding = current week - 1
   - Example: "last 4 weeks" = weeks ${currentWeek - 4} to ${currentWeek - 1}
   
2. For "last week" (singular):
   - WeekStarting = current week - 1
   - WeekEnding = current week - 1
   - Example: "last week" = week ${currentWeek - 1}
   
3. For "current week" or "this week":
   - WeekStarting = current week (${currentWeek})
   - WeekEnding = current week (${currentWeek})
   
4. For "week N" (specific week):
   - WeekStarting = N
   - WeekEnding = N

5. For "next week":
   - WeekStarting = current week + 1
   - WeekEnding = current week + 1

6. For "next N weeks":
   - WeekStarting = current week + 1
   - WeekEnding = current week + N
   
7. If year is mentioned, use it. Otherwise, use current year (${currentYear}).

8. If NO time period is mentioned in the message, return null for all fields.

User message: "${userMessage}"

Return ONLY a valid JSON object with actual week numbers (integers):
{
  "WeekStarting": number or null,
  "WeekEnding": number or null,
  "Year": number or null,
  "hasDateHint": boolean
}

Examples:
- "last 4 weeks" → {"WeekStarting": ${currentWeek - 4}, "WeekEnding": ${
		currentWeek - 1
	}, "Year": ${currentYear}, "hasDateHint": true}
- "last week" → {"WeekStarting": ${currentWeek - 1}, "WeekEnding": ${
		currentWeek - 1
	}, "Year": ${currentYear}, "hasDateHint": true}
- "current week" → {"WeekStarting": ${currentWeek}, "WeekEnding": ${currentWeek}, "Year": ${currentYear}, "hasDateHint": true}
- "this week" → {"WeekStarting": ${currentWeek}, "WeekEnding": ${currentWeek}, "Year": ${currentYear}, "hasDateHint": true}
- "week 35" → {"WeekStarting": 35, "WeekEnding": 35, "Year": ${currentYear}, "hasDateHint": true}
- "show me drivers" → {"WeekStarting": null, "WeekEnding": null, "Year": null, "hasDateHint": false}

IMPORTANT: Only set hasDateHint to true if the user explicitly mentioned a time period.
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
			hasDateHint: false,
		};
	}
}

/**
 * Main handler to extract and format FromDate and ToDate
 * Now uses client's week configuration from session
 * @param {string} userMessage - The user's query
 * @param {string} weekStartDay - Client's week start day (from session.clientWeekStartDay)
 * @param {string} weekEndDay - Client's week end day (from session.clientWeekEndDay)
 * @returns {Promise<{FromDate: string, ToDate: string}>} - Formatted dates (YYYY-MM-DD)
 */
async function handleFromDateToDate(userMessage, weekStartDay = "Sunday", weekEndDay = "Saturday") {
	console.log(weekStartDay, weekEndDay, "week days in date param handler");
	console.log("\n🔍 Handling FromDate and ToDate extraction (Dynamic)...");
	console.log("User message:", userMessage);
	console.log("Client Week Config:", `${weekStartDay} - ${weekEndDay}`);

	// Extract week parameters using AI with client's week config
	const { WeekStarting, WeekEnding, Year, hasDateHint } = await extractDateParamsFromOpenAI(
		userMessage,
		weekStartDay,
		weekEndDay
	);

	// If no date hints in message, use current week
	if (!hasDateHint || WeekStarting === null || WeekEnding === null) {
		console.log("📅 No date hints found - using current week");
		const currentWeekDates = getCurrentWeekDates(weekStartDay, weekEndDay);
		return currentWeekDates;
	}

	// Use provided year or default to current year
	const year = Year || new Date().getFullYear();

	// Convert week numbers to actual dates using client's week config
	const FromDate = formatDate(getStartDateOfWeek(WeekStarting, year, weekStartDay));
	const ToDate = formatDate(getEndDateOfWeek(WeekEnding, year, weekStartDay, weekEndDay));

	console.log("📅 Extracted dates (Dynamic):");
	console.log("  - Week Range:", `Week ${WeekStarting} - Week ${WeekEnding}, ${year}`);
	console.log("  - FromDate (${weekStartDay}):", FromDate);
	console.log("  - ToDate (${weekEndDay}):", ToDate);

	return { FromDate, ToDate };
}

/**
 * Format string date to ISO format (YYYY-MM-DD)
 */
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
	getDayNumber,
	getDayName,
	getCurrentWeekNumber,
	getStartDateOfWeek,
	getEndDateOfWeek,
	formatDate,
	getCurrentWeekDates,
	formatToISODate,
	extractDateParamsFromOpenAI,
	handleFromDateToDate,
};
