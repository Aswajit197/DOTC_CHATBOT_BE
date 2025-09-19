const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

/**
 * Enhanced tools with arithmetic operations
 */
const tools = [
	{
		type: "function",
		function: {
			name: "calculate_average",
			description: "Calculate the arithmetic mean (average) of numbers from any JSON structure",
			parameters: {
				type: "object",
				properties: {
					data: {
						description: "The data source - can be array of numbers or JSON objects",
					},
					field_path: {
						type: "string",
						description: "Dot notation path to extract numbers from JSON objects (e.g., 'score', 'sales.q1', 'grades.0')",
					},
					exclude_zeros: {
						type: "boolean",
						description: "Whether to exclude zero values from the calculation",
						default: false,
					},
				},
				required: ["data"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "calculate_sum",
			description: "Calculate the sum total of numbers from any JSON structure",
			parameters: {
				type: "object",
				properties: {
					data: {
						description: "The data source - can be array of numbers or JSON objects",
					},
					field_path: {
						type: "string",
						description: "Dot notation path to extract numbers from JSON objects",
					},
					exclude_zeros: {
						type: "boolean",
						description: "Whether to exclude zero values from the calculation",
						default: false,
					},
				},
				required: ["data"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "calculate_deviation",
			description: "Calculate standard deviation and variance for numbers from any JSON structure",
			parameters: {
				type: "object",
				properties: {
					data: {
						description: "The data source - can be array of numbers or JSON objects",
					},
					field_path: {
						type: "string",
						description: "Dot notation path to extract numbers from JSON objects",
					},
					population: {
						type: "boolean",
						description: "True for population standard deviation, false for sample standard deviation",
						default: false,
					},
					exclude_zeros: {
						type: "boolean",
						description: "Whether to exclude zero values from the calculation",
						default: false,
					},
				},
				required: ["data"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_all_numbers",
			description: "Extract all numbers from a JSON structure for analysis",
			parameters: {
				type: "object",
				properties: {
					data: {
						description: "The JSON data to extract numbers from - can be array, object, or primitive",
					},
					field_path: {
						type: "string",
						description: "Optional dot notation path to extract only a specific field",
					},
					exclude_zeros: {
						type: "boolean",
						description: "Whether to exclude zero values from the results",
						default: false,
					},
				},
				required: ["data"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "calculate_percentage_deviation",
			description: "Calculate percentage deviation from average for total working hours across all shift types",
			parameters: {
				type: "object",
				properties: {
					data: {
						description: "Array of driver objects with shifts data",
					},
					exclude_zeros: {
						type: "boolean",
						description: "Whether to exclude zero values when calculating totals",
						default: true,
					},
				},
				required: ["data"],
			},
		},
	},
];

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
 * Calculate percentage deviation for driver working hours
 * Enhanced to handle various data structures and field names
 */
function calculatePercentageDeviation({ data, exclude_zeros = true }) {
	try {
		console.log("DEBUG - Input data sample:", JSON.stringify(data.slice(0, 2), null, 2));

		// Calculate total working hours for each driver
		const driverTotals = data.map((driver) => {
			let totalHours = 0;
			let driverName = driver.driverName || driver.name || driver.driver_name || "Unknown";
			let driverId = driver.driverId || driver.id || driver.driver_id || driver.ID;

			// Try multiple possible structures for shift data
			let shifts = driver.shifts || driver.shiftHours || driver.hours || {};

			// If shifts is not an object, try to find numeric fields in the main driver object
			if (typeof shifts !== "object" || shifts === null) {
				shifts = {};
				// Look for numeric fields that might represent working hours
				Object.keys(driver).forEach((key) => {
					const value = driver[key];
					if (
						typeof value === "number" &&
						!isNaN(value) &&
						!key.toLowerCase().includes("id") &&
						!key.toLowerCase().includes("week") &&
						key !== "driverId" &&
						key !== "id"
					) {
						shifts[key] = value;
					}
				});
			}

			// Handle case where individual shift columns are directly in driver object
			// Common patterns: Parcel Van, Step Van, Walker, Box Truck, etc.
			const possibleShiftFields = ["Parcel Van", "Step Van", "Walker", "Box Truck", "parcelVan", "stepVan", "walker", "boxTruck"];
			possibleShiftFields.forEach((field) => {
				if (driver[field] !== undefined && typeof driver[field] === "number") {
					shifts[field] = driver[field];
				}
			});

			// Sum all shift hours
			Object.entries(shifts).forEach(([key, hours]) => {
				if (typeof hours === "number" && !isNaN(hours)) {
					if (!exclude_zeros || hours !== 0) {
						totalHours += hours;
					}
				}
			});

			// If still no total hours, try to find a total field directly
			if (totalHours === 0) {
				const totalField = driver.totalHours || driver.total || driver.Total || driver.total_hours;
				if (typeof totalField === "number" && !isNaN(totalField)) {
					totalHours = totalField;
				}
			}

			console.log(`DEBUG - Driver ${driverName}: totalHours = ${totalHours}, shifts =`, shifts);

			return {
				driverId: driverId,
				driverName: driverName,
				totalHours: totalHours,
				shifts: shifts,
			};
		});

		// Filter out drivers with zero hours if exclude_zeros is true
		const validDrivers = exclude_zeros ? driverTotals.filter((driver) => driver.totalHours > 0) : driverTotals;

		// Extract just the total hours for calculations
		const totalHours = validDrivers.map((driver) => driver.totalHours);

		console.log("DEBUG - Total hours array:", totalHours);

		if (totalHours.length === 0) {
			return { error: "No valid working hours found" };
		}

		// Calculate average
		const average = totalHours.reduce((sum, hours) => sum + hours, 0) / totalHours.length;
		console.log("DEBUG - Calculated average:", average);

		// Calculate percentage deviation for each driver
		const results = validDrivers.map((driver) => {
			const deviation = driver.totalHours - average;
			const percentageDeviation = average !== 0 ? (deviation / average) * 100 : 0;

			return {
				driverId: driver.driverId,
				driverName: driver.driverName,
				totalHours: driver.totalHours,
				deviation: parseFloat(deviation.toFixed(2)),
				percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
				shifts: driver.shifts,
			};
		});

		// Sort by percentage deviation (most positive to most negative)
		results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

		console.log("DEBUG - Final results sample:", results.slice(0, 3));

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
		console.error("calculatePercentageDeviation error:", error);
		return { error: `Calculation error: ${error.message}` };
	}
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
 * Extract numbers from any data structure, including nested objects
 */
function extractNumbers(data, fieldPath = null, excludeZeros = false) {
	const numbers = [];

	// Helper function to check if a value should be included
	const shouldInclude = (value) => {
		if (typeof value !== "number" || isNaN(value)) return false;
		if (excludeZeros && value === 0) return false;
		return true;
	};

	// If specific field path is requested
	if (fieldPath) {
		// Handle array of objects with field path
		if (Array.isArray(data)) {
			data.forEach((item) => {
				const value = getNestedValue(item, fieldPath);

				if (typeof value === "object" && value !== null) {
					// If the field contains an object, extract all numeric values from it
					Object.values(value).forEach((val) => {
						if (shouldInclude(val)) {
							numbers.push(val);
						}
					});
				} else if (shouldInclude(value)) {
					// If it's a single numeric value
					numbers.push(value);
				}
			});
		} else {
			// Handle single object with field path
			const value = getNestedValue(data, fieldPath);

			if (typeof value === "object" && value !== null) {
				// If the field contains an object, extract all numeric values from it
				Object.values(value).forEach((val) => {
					if (shouldInclude(val)) {
						numbers.push(val);
					}
				});
			} else if (shouldInclude(value)) {
				// If it's a single numeric value
				numbers.push(value);
			}
		}

		return numbers;
	}

	// If no field path provided, use the original logic
	function traverse(current, currentKey = null) {
		if (shouldInclude(current, currentKey)) {
			numbers.push(current);
			return;
		}

		if (Array.isArray(current)) {
			current.forEach((item) => traverse(item));
		} else if (typeof current === "object" && current !== null) {
			Object.entries(current).forEach(([key, value]) => {
				// Skip metadata fields
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
 * Enhanced calculation functions with zero exclusion option
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
 * Execute function tools for arithmetic operations
 */
async function executeFunctionTool(toolCall, actualData) {
	const args = JSON.parse(toolCall.function.arguments);
	// Replace data parameter with actualData if it references the API data
	if (args.data) {
		args.data = actualData;
	}

	let result;
	switch (toolCall.function.name) {
		case "calculate_average":
			result = calculateAverage(args);
			break;
		case "calculate_sum":
			result = calculateSum(args);
			break;
		case "calculate_deviation":
			result = calculateDeviation(args);
			break;
		case "calculate_percentage_deviation":
			result = calculatePercentageDeviation(args);
			break;
		case "get_all_numbers":
			result = getAllNumbersFromData(args);
			break;
		default:
			result = { error: `Unknown function: ${toolCall.function.name}` };
	}

	return result;
}

/**
 * Enhanced system prompt that includes arithmetic operations
 */
const getEnhancedSystemPrompt = (api, userMessage, params, exampleResponse, actualData) => `
You're a smart assistant designed to process structured API data intelligently and answer the user's message. You now have access to advanced arithmetic operations.

AVAILABLE ARITHMETIC FUNCTIONS:
1. calculate_average: Calculate average of numbers from data
2. calculate_sum: Calculate sum total of numbers  
3. calculate_deviation: Calculate standard deviation and variance
4. calculate_percentage_deviation: Calculate % deviation from average (specialized for driver working hours)
5. get_all_numbers: Extract all numbers from data for analysis

FUNCTION SELECTION RULES:
- For "average", "mean" queries: Use calculate_average
- For "total", "sum" queries: Use calculate_sum  
- For "deviation in percentage", "percentage difference", "percentage deviation", "compare performance", or when user asks for "percentage of deviations from average": Use calculate_percentage_deviation
- For "standard deviation", "variance": Use calculate_deviation
- For "extract numbers", "show all values": Use get_all_numbers
- Always use exclude_zeros=true for shift/working hours data
- Use appropriate field_path for nested data extraction

IMPORTANT FOR PERCENTAGE DEVIATION:
- When displaying percentage deviation results, format percentages properly (e.g., "+15.23%" or "-8.45%")
- Show positive deviations as above average, negative as below average
- Include the calculated average in the summary
- Sort results by deviation (highest to lowest)

Your tasks:
1. Understand the user's intent from their message.
2. **FIRST**: If the user is asking for arithmetic operations (average, sum, deviation, percentage analysis), use the appropriate function tools to calculate the results.
3. Filter, transform, or aggregate the provided API data as needed to directly answer the user's request.
4. If the user asks for "top N items per category" (e.g., "top 10 drivers per shift type"), do the following:
   - Treat each category in the data (like "Parcel Van", "Step Van", etc.) as a separate group.
   - For each category, select up to N items sorted by the highest relevant metric (e.g., total shift hours).
   - Always display each category, even if no matching items are found. In that case, display a table with a row stating "No drivers found" or similar message.
   - Display each category in its own HTML table, starting with a clear introductory sentence.
5. If the user provides numeric thresholds (e.g., "at least 800 hours", "more than 50 deliveries"), strictly filter the data so that only items satisfying those thresholds remain.
6. Never include items that partially match the condition.
7. If no explicit top-N or filter is present, display all data in the most meaningful way (table, list, or paragraph).
8. Check the response if its more likely a table format or list format or paragraph always try to give better format as per response
9. Properly format any date strings into user-friendly readable formats.

---

### API Info
Name: ${api.name}
Description: ${api.description}

### User Message
"${userMessage}"

### Query Parameters
${JSON.stringify(params, null, 2)}

### Example Response Format
${JSON.stringify(exampleResponse, null, 2)}

### Raw API Data
${JSON.stringify(actualData, null, 2)}

---

### Output Instructions
Decide the HTML output format dynamically based on intent and API description:

- If the **user message** explicitly asks for "table", "tabular" or if the **API description** indicates tabular data, then format the reply as an HTML <table> with <thead>, <tbody>, <tr>, <th>, <td>.
- If the data is best represented as a **list**, use <ul><li>...</li></ul>.
- If userMessage intent is for specific one driver id or LMDP ID try to send in list format.
- Try to provide complete list/table always if user message don't contains any filter action.
- If the data is descriptive or narrative, use <p>...</p>.
- If the data contains date string send in proper user readable format.
- Always start with a <p> introduction sentence before table or list.
- For top-N per category requests, provide multiple separate HTML <table> sections—one for each category (e.g., shift type).
   - If a category has no matching items, include a single-row table with the message "No drivers found for this shift type."
- Always include a <div class="summary"> block summarizing:
    - Exact total counts per category or in total.
    - 1-2 additional meaningful computed insights (e.g., highest working hours and by whom).
    - Include arithmetic calculation results if functions were used.
    - Do not use vague terms like "several" or "some".
- Format dates into readable forms (e.g., "September 12, 2025").
- If the API is suitable for graphs, suggest a visualization follow-up only if applicable.

${
	api?.isSuitableForGraph
		? `<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>`
		: ``
}

- Do not include Markdown, JSON, or plain text—only valid HTML.
- After the HTML reply, summary, and optional follow-up message, output exactly:
###END###
`;

/**
 * Streams GPT's partial plain text response until "###END###",
 * and returns the full HTML reply at the end.
 * Now with enhanced arithmetic operations support.
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

	try {
		const prompt = getEnhancedSystemPrompt(api, userMessage, params, exampleResponse, actualData);

		let messages = [{ role: "user", content: prompt }];

		let finalMessage = null;
		let hasUsedTools = false;

		// Handle function calls first (if needed)
		while (true) {
			const completion = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages,
				tools,
				tool_choice: "auto",
				temperature: 0,
				stream: false, // Use non-streaming for tool calls
			});

			const message = completion.choices[0].message;
			messages.push(message);

			if (!message.tool_calls || message.tool_calls.length === 0) {
				finalMessage = message;
				break;
			}

			hasUsedTools = true;

			// Execute all tool calls
			for (const toolCall of message.tool_calls) {
				const result = await executeFunctionTool(toolCall, actualData);

				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: JSON.stringify(result),
				});
			}
		}

		// If we used tools, the response is already complete
		if (hasUsedTools && finalMessage) {
			const responseText = finalMessage.content;
			fullText = responseText + "###END###";

			// Stream the complete response
			if (onStream) {
				const cleanedResponse = responseText
					.replace(/([a-z])([A-Z])/g, "$1 $2")
					.replace(/(\d)([A-Za-z])/g, "$1 $2")
					.replace(/([a-zA-Z])(\d)/g, "$1 $2");
				onStream(cleanedResponse);
			}
		} else {
			// If no tools were used, fall back to streaming response
			const completion = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: prompt }],
				temperature: 0,
				stream: true,
			});

			for await (const chunk of completion) {
				const delta = chunk.choices?.[0]?.delta?.content || "";
				if (!delta) continue;

				fullText += delta;

				// Stop when END marker appears
				if (fullText.includes("###END###")) break;

				const cleaned = delta.replace(/###\s*END\s*###/gi, "");
				if (cleaned) {
					const formatted = cleaned
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.replace(/(\d)([A-Za-z])/g, "$1 $2")
						.replace(/([a-zA-Z])(\d)/g, "$1 $2");

					if (onStream) onStream(formatted);
				}
			}
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();

		// ✅ Save the last reply in session
		await Session.updateOne(
			{ _id: session._id },
			{
				$set: {
					lastResponseMessage: finalReply,
					lastSuccessUserMessage: userMessage,
					lastSuccessIntent: api?.name || null,
					lastSuccessApiResponse: actualData,
					lastSuccessParams: params,
					missingField: null,
				},
			}
		);

		return {
			userReply: finalReply,
			params,
			api,
		};
	} catch (err) {
		console.log(err);
		console.error("processIntentAndFormatResponse error:", err.message);
		return {
			userReply: "Here's the available data. (Intent-based personalization failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
