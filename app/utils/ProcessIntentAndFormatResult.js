const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

/**
 * Utility function to get value from object using dot notation
 */
function getNestedValue(obj, path) {
	if (!path) return obj;
	return path.split(".").reduce((current, key) => {
		if (current === null || current === undefined) return undefined;
		return current[key];
	}, obj);
}

/**
 * Check if a field name should be excluded as metadata
 */
function isMetadataField(fieldName) {
	if (!fieldName) return false;

	const metadataPatterns = [
		/^id$/i,
		/.*_id$/i,
		/.*Id$/,
		/^uid$/i,
		/^uuid$/i,
		/^guid$/i,
		/timestamp/i,
		/created/i,
		/updated/i,
		/modified/i,
		/version/i,
		/revision/i,
		/build/i,
		/index/i,
		/position/i,
		/order/i,
		/status/i,
		/state/i,
		/type/i,
		/kind/i,
		/.*_key$/i,
		/.*Key$/,
		/.*_code$/i,
		/.*Code$/,
	];

	return metadataPatterns.some((pattern) => pattern.test(fieldName));
}

/**
 * Extract numbers from any data structure
 */
function extractNumbers(data, fieldPath = null, excludeZeros = false) {
	const numbers = [];

	const shouldInclude = (value) => {
		if (typeof value !== "number" || isNaN(value)) return false;
		if (excludeZeros && value === 0) return false;
		return true;
	};

	if (fieldPath) {
		if (Array.isArray(data)) {
			data.forEach((item) => {
				const value = getNestedValue(item, fieldPath);
				if (typeof value === "object" && value !== null) {
					Object.values(value).forEach((val) => {
						if (shouldInclude(val)) numbers.push(val);
					});
				} else if (shouldInclude(value)) {
					numbers.push(value);
				}
			});
		} else {
			const value = getNestedValue(data, fieldPath);
			if (typeof value === "object" && value !== null) {
				Object.values(value).forEach((val) => {
					if (shouldInclude(val)) numbers.push(val);
				});
			} else if (shouldInclude(value)) {
				numbers.push(value);
			}
		}
		return numbers;
	}

	function traverse(current, currentKey = null) {
		if (shouldInclude(current)) {
			numbers.push(current);
			return;
		}

		if (Array.isArray(current)) {
			current.forEach((item) => traverse(item));
		} else if (typeof current === "object" && current !== null) {
			Object.entries(current).forEach(([key, value]) => {
				if (!isMetadataField(key)) {
					traverse(value, key);
				}
			});
		}
	}

	traverse(data);
	return numbers;
}

/**
 * Calculate average with zero exclusion option
 */
function calculateAverage({ data, field_path, exclude_zeros = false }) {
	try {
		const numbers = extractNumbers(data, field_path, exclude_zeros);

		if (numbers.length === 0) {
			return {
				error: "No valid numbers found",
				data_sample: JSON.stringify(data).substring(0, 200) + "...",
			};
		}

		const sum = numbers.reduce((acc, num) => acc + num, 0);
		const average = sum / numbers.length;

		return {
			average: parseFloat(average.toFixed(2)),
			count: numbers.length,
			total_sum: parseFloat(sum.toFixed(2)),
			field_path: field_path || "auto-detected (excluding metadata)",
			exclude_zeros: exclude_zeros,
			sample_values: numbers.slice(0, 5),
		};
	} catch (error) {
		return { error: `Calculation error: ${error.message}` };
	}
}

/**
 * Calculate sum with zero exclusion option
 */
function calculateSum({ data, field_path, exclude_zeros = false }) {
	try {
		const numbers = extractNumbers(data, field_path, exclude_zeros);

		if (numbers.length === 0) {
			return {
				error: "No valid numbers found",
				data_sample: JSON.stringify(data).substring(0, 200) + "...",
			};
		}

		const sum = numbers.reduce((acc, num) => acc + num, 0);

		return {
			sum: parseFloat(sum.toFixed(2)),
			count: numbers.length,
			field_path: field_path || "auto-detected (excluding metadata)",
			exclude_zeros: exclude_zeros,
			sample_values: numbers.slice(0, 5),
		};
	} catch (error) {
		return { error: `Calculation error: ${error.message}` };
	}
}

/**
 * Calculate standard deviation and variance
 */
function calculateDeviation({ data, field_path, population = false, exclude_zeros = false }) {
	try {
		const numbers = extractNumbers(data, field_path, exclude_zeros);

		if (numbers.length === 0) {
			return {
				error: "No valid numbers found",
				data_sample: JSON.stringify(data).substring(0, 200) + "...",
			};
		}

		if (numbers.length === 1) {
			return {
				standard_deviation: 0,
				variance: 0,
				mean: numbers[0],
				count: 1,
				field_path: field_path || "auto-detected (excluding metadata)",
				exclude_zeros: exclude_zeros,
			};
		}

		const mean = numbers.reduce((acc, num) => acc + num, 0) / numbers.length;
		const squaredDifferences = numbers.map((num) => Math.pow(num - mean, 2));
		const variance = squaredDifferences.reduce((acc, diff) => acc + diff, 0) / (population ? numbers.length : numbers.length - 1);
		const standardDeviation = Math.sqrt(variance);

		return {
			standard_deviation: parseFloat(standardDeviation.toFixed(2)),
			variance: parseFloat(variance.toFixed(2)),
			mean: parseFloat(mean.toFixed(2)),
			count: numbers.length,
			field_path: field_path || "auto-detected (excluding metadata)",
			exclude_zeros: exclude_zeros,
			type: population ? "population" : "sample",
			sample_values: numbers.slice(0, 5),
		};
	} catch (error) {
		return { error: `Calculation error: ${error.message}` };
	}
}

/**
 * Calculate percentage deviation for driver working hours
 */
function calculatePercentageDeviation({ data, exclude_zeros = true }) {
	try {
		const driverTotals = data.map((driver) => {
			const shifts = driver.shifts || {};
			let totalHours = 0;

			Object.values(shifts).forEach((hours) => {
				if (typeof hours === "number" && !isNaN(hours)) {
					if (!exclude_zeros || hours !== 0) {
						totalHours += hours;
					}
				}
			});

			return {
				driverId: driver.driverId,
				driverName: driver.driverName,
				totalHours: totalHours,
				shifts: shifts,
			};
		});

		const totalHours = driverTotals.map((driver) => driver.totalHours);

		if (totalHours.length === 0) {
			return { error: "No valid working hours found" };
		}

		const average = totalHours.reduce((sum, hours) => sum + hours, 0) / totalHours.length;

		const results = driverTotals.map((driver) => {
			const deviation = driver.totalHours - average;
			const percentageDeviation = average === 0 ? 0 : (deviation / average) * 100;

			return {
				driverId: driver.driverId,
				driverName: driver.driverName,
				totalHours: driver.totalHours,
				deviation: parseFloat(deviation.toFixed(2)),
				percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
				shifts: driver.shifts,
			};
		});

		results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

		return {
			averageTotalHours: parseFloat(average.toFixed(2)),
			totalDrivers: results.length,
			results: results,
			summary: {
				highestDeviation: results.length > 0 ? results[0].percentageDeviation : 0,
				lowestDeviation: results.length > 0 ? results[results.length - 1].percentageDeviation : 0,
				averageDeviation:
					results.length > 0
						? parseFloat((results.reduce((sum, r) => sum + r.percentageDeviation, 0) / results.length).toFixed(2))
						: 0,
			},
		};
	} catch (error) {
		return { error: `Calculation error: ${error.message}` };
	}
}

/**
 * Get all numbers from data structure
 */
function getAllNumbersFromData({ data, field_path, exclude_zeros = false }) {
	try {
		const numbers = extractNumbers(data, field_path, exclude_zeros);

		return {
			numbers: numbers,
			count: numbers.length,
			field_path: field_path || "auto-detected",
			exclude_zeros: exclude_zeros,
			sample_values: numbers.slice(0, 10),
			min: numbers.length > 0 ? Math.min(...numbers) : null,
			max: numbers.length > 0 ? Math.max(...numbers) : null,
			total: numbers.length > 0 ? numbers.reduce((sum, num) => sum + num, 0) : null,
		};
	} catch (error) {
		return { error: `Extraction error: ${error.message}` };
	}
}

/**
 * Detect if user message requires mathematical calculations
 */
function isMathematicalQuery(userMessage) {
	const mathKeywords = [
		"average",
		"mean",
		"sum",
		"total",
		"calculate",
		"deviation",
		"variance",
		"percentage",
		"standard deviation",
		"std dev",
		"median",
		"mode",
		"statistics",
		"stats",
		"analysis",
	];

	const message = userMessage.toLowerCase();
	return mathKeywords.some((keyword) => message.includes(keyword));
}

/**
 * Execute all relevant calculations based on user message
 */
function executeRelevantCalculations(userMessage, data) {
	const message = userMessage.toLowerCase();
	const calculations = {};

	if (message.includes("average") || message.includes("mean")) {
		calculations.average = calculateAverage({ data, exclude_zeros: true });
	}

	if (message.includes("sum") || message.includes("total")) {
		calculations.sum = calculateSum({ data, exclude_zeros: true });
	}

	if (message.includes("deviation") || message.includes("variance") || message.includes("std")) {
		calculations.deviation = calculateDeviation({ data, exclude_zeros: true });
	}

	if (message.includes("percentage")) {
		calculations.percentageDeviation = calculatePercentageDeviation({ data, exclude_zeros: true });
	}

	return calculations;
}

/**
 * HYBRID APPROACH: Fast math + Complete AI response
 */
const processIntentAndFormatResponse = async ({
	userMessage,
	api,
	exampleResponse,
	actualData,
	params = {},
	session,
	onStream,
}) => {
	let fullText = "";
	console.log("🚀 Starting HYBRID processIntentAndFormatResponse");
	console.log(`📝 User message: ${userMessage}`);
	console.log(`📊 Data size: ${Array.isArray(actualData) ? actualData.length : "Not array"} items`);

	try {
		// STEP 1: Quick math detection and calculation
		const isMathQuery = isMathematicalQuery(userMessage);
		let preCalculatedResults = null;

		if (isMathQuery) {
			console.log("⚡ Detected mathematical query - executing fast calculations");
			preCalculatedResults = executeRelevantCalculations(userMessage, actualData);
			console.log("✅ Pre-calculations completed:", Object.keys(preCalculatedResults));
		}

		// STEP 2: Build comprehensive prompt with pre-calculated results
		const prompt = `
You're a smart assistant designed to process structured API data intelligently and answer the user's message.

Your tasks:
1. Understand the user's intent from their message.
2. Use the provided pre-calculated mathematical results when available (these are 100% accurate).
3. Filter, transform, or aggregate the provided API data as needed to directly answer the user's request.
4. For "top N items per category" requests, display each category in its own HTML table.
5. Apply numeric thresholds strictly when specified.
6. Format dates into user-friendly readable formats.
7. Always provide complete, comprehensive responses with full data sets unless explicitly filtered.

### API Info
Name: ${api.name}
Description: ${api.description}

### User Message
"${userMessage}"

${
	preCalculatedResults
		? `
### Pre-Calculated Mathematical Results (USE THESE - They are 100% accurate):
${JSON.stringify(preCalculatedResults, null, 2)}
`
		: ""
}

### Query Parameters
${JSON.stringify(params, null, 2)}

### Example Response Format
${JSON.stringify(exampleResponse, null, 2)}

### Raw API Data
${JSON.stringify(actualData, null, 2)}

---

### Output Instructions
Create a comprehensive HTML response that:

- Uses PRE-CALCULATED RESULTS when available (don't recalculate math)
- Formats data appropriately: <table> for tabular data, <ul> for lists, <p> for descriptions
- Always starts with an introduction <p> sentence
- For calculations, presents results in well-formatted tables
- For top-N requests, provides separate tables per category
- Includes ALL relevant data unless explicitly filtered
- Ends with a <div class="summary"> containing:
  - Total counts and key insights
  - Statistical highlights (highest/lowest values and their owners)
  - Any performance patterns or notable findings

${
	api?.isSuitableForGraph
		? `<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>`
		: ""
}

  - Output only valid HTML, no Markdown or JSON
  - End with exactly: ###END###
`;            

// <-- STEP 1: LOAD the rich history from the session
        const richHistory = session.history || [];

        // <-- STEP 2: TRANSFORM the rich history into the simple format OpenAI needs
        const messagesForAPI = richHistory.map(turn => ({
            role: turn.sender === 'user' ? 'user' : 'assistant',
            content: turn.message
        }));

        // <-- STEP 3: BUILD the full messages array, including the history
        const messages = [
            {
                role: "system",
                content: "You are a data analysis expert. Create comprehensive HTML responses using provided calculations. Never recalculate math - use the pre-calculated results provided.",
            },
            // Add all previous messages from the history
            ...messagesForAPI,
            // Add the new user message with all its context for this turn
            { role: "user", content: prompt },
        ];

        console.log(`🤖 Starting AI streaming with ${richHistory.length} previous turns in history...`);

		// STEP 3: Single AI call with all context and pre-calculated results

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: messages,
			temperature: 0,
			tools: openAITools,
			tool_choice: "auto",
			stream: true,
			max_tokens: 3000,
		});

		// STEP 4: Stream the complete response
		for await (const chunk of completion) {
			const delta = chunk.choices?.[0]?.delta?.content || "";
			if (!delta) continue;

			fullText += delta;

			// Stop when END marker appears
			if (fullText.includes("###END###")) {
				console.log("🛑 Found END marker, stopping stream");
				break;
			}

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			if (cleaned && onStream) {
				const formatted = cleaned
					.replace(/([a-z])([A-Z])/g, "$1 $2")
					.replace(/(\d)([A-Za-z])/g, "$1 $2")
					.replace(/([a-zA-Z])(\d)/g, "$1 $2");

				onStream(formatted);
			}
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();

         const userHistoryTurn = {
            sender: 'user',
            message: userMessage, // The simple, original message
            timestamp: new Date()
        };
        const assistantHistoryTurn = {
            sender: 'assistant',
            message: finalReply,
            data: actualData, // Save the data used for this response
            chatType: 'response', // Or determine this dynamically
            timestamp: new Date()
        };

		// Save to session
		await Session.updateOne(
			{ _id: session._id },
            {
				$push: { 
					history: { $each: [userHistoryTurn, assistantHistoryTurn] } 
				},
				$set: {
					lastResponseMessage: finalReply,
					lastSuccessUserMessage: userMessage,
					lastSuccessIntent: api?.name,
					lastSuccessApiResponse: actualData,
					lastSuccessParams: params,
					lastCalculationResults: preCalculatedResults,
					missingField: null,
				}
			}
		);

		console.log(`✅ HYBRID response completed - Math: ${isMathQuery ? "Fast" : "N/A"}, AI: Complete`);
		return {
			userReply: finalReply,
			params,
			api,
			calculations: preCalculatedResults,
		};

	} catch (err) {
		console.error("❌ processIntentAndFormatResponse error:", err);
		return {
			userReply: fallback,
			params,
			api,
			calculations: preCalculatedResults,
			error: err.message
		};
	}
};

module.exports = processIntentAndFormatResponse;