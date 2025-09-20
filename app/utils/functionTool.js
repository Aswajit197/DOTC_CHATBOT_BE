const express = require("express");
const { OpenAI } = require("openai");
require("dotenv").config({ override: true });

const app = express();
const port = 8000;
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.json());

// Enhanced dynamic tools with exclude_zeros parameter for all calculation functions
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

function calculatePercentageDeviation({ data, exclude_zeros = true }) {
	try {
		// Calculate total working hours for each driver
		const driverTotals = data.map((driver) => {
			const shifts = driver.shifts || {};
			let totalHours = 0;

			// Sum all shift hours
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

		// Extract just the total hours for calculations
		const totalHours = driverTotals.map((driver) => driver.totalHours);

		if (totalHours.length === 0) {
			return { error: "No valid working hours found" };
		}

		// Calculate average
		const average = totalHours.reduce((sum, hours) => sum + hours, 0) / totalHours.length;

		// Calculate percentage deviation for each driver
		const results = driverTotals.map((driver) => {
			const deviation = driver.totalHours - average;
			const percentageDeviation = (deviation / average) * 100;

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

		return {
			averageTotalHours: parseFloat(average.toFixed(2)),
			totalDrivers: results.length,
			results: results,
			summary: {
				highestDeviation: results[0].percentageDeviation,
				lowestDeviation: results[results.length - 1].percentageDeviation,
				averageDeviation: parseFloat((results.reduce((sum, r) => sum + r.percentageDeviation, 0) / results.length).toFixed(2)),
			},
		};
	} catch (error) {
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
 * FIXED: Extract numbers from any data structure, including nested objects
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
 * Enhanced getAllNumbersFromData function
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
 * Enhanced calculation functions with zero exclusion option
 */
function calculateAverage({ data, field_path, exclude_zeros = false }) {
	try {
		const numbers = extractNumbers(data, field_path, exclude_zeros);
		console.log("DEBUG - Average numbers:", numbers, "count:", numbers.length);

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

		// ADD DEBUG LOGGING TO SEE WHAT'S HAPPENING:
		console.log("DEBUG - Sum calculation:", {
			field_path,
			exclude_zeros,
			numbers_count: numbers.length,
			numbers_sample: numbers.slice(0, 5),
		});

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
		console.log("DEBUG - Deviation numbers:", numbers, "count:", numbers.length);

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

// Update the system prompt to mention zero exclusion
const systemPrompt = `You are a statistical analysis assistant specialized in working hours data.

KEY CAPABILITIES:
1. calculate_average: Calculate average of numbers
2. calculate_sum: Calculate sum of numbers  
3. calculate_deviation: Calculate standard deviation and variance (general stats)
4. get_all_numbers: Extract all numbers from data
5. calculate_percentage_deviation: SPECIALIZED - Calculate % deviation from average for driver working hours

CRITICAL FUNCTION SELECTION:
- For queries about "deviation in percentage", "percentage difference", "compare drivers", or "performance deviation": USE calculate_percentage_deviation
- For general "standard deviation" or "variance" questions: USE calculate_deviation
- For simple averages: USE calculate_average
- For totals: USE calculate_sum

WORKING HOURS ANALYSIS RULES:
- For driver shift data, calculate TOTAL hours across all shift types per driver
- Always exclude zeros (exclude_zeros=true) for shift data
- Present percentage results in clear tabular format when requested
- Use calculate_percentage_deviation for driver comparison queries

Always choose the most appropriate function based on the query context and provide clear, well-formatted results.`;

app.post("/calculate", async (req, res) => {
	try {
		const { query, data } = req.body;

		if (!query) {
			return res.status(400).json({ error: "Query is required" });
		}

		const fullQuery = data ? `${query}\n\nData: ${JSON.stringify(data)}` : query;

		let messages = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: fullQuery },
		];

		let finalMessage = null;

		while (true) {
			const response = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages,
				tools,
				tool_choice: "auto",
				temperature: 0,
			});

			const message = response.choices[0].message;
			messages.push(message);

			if (!message.tool_calls || message.tool_calls.length === 0) {
				finalMessage = message;
				break;
			}

			for (const toolCall of message.tool_calls) {
				let result;
				const args = JSON.parse(toolCall.function.arguments);
				console.log("DEBUG - Function:", toolCall.function.name);
				console.log("DEBUG - Args received:", JSON.stringify(args, null, 2));
				console.log("DEBUG - exclude_zeros value:", args.exclude_zeros);

				switch (toolCall.function.name) {
					case "calculate_average":
						result = calculateAverage({
							data: args.data,
							field_path: args.field_path,
							exclude_zeros: args.exclude_zeros,
						});
						console.log("Average calculation result:", result);
						break;
					case "calculate_sum":
						result = calculateSum({
							data: args.data,
							field_path: args.field_path,
							exclude_zeros: args.exclude_zeros,
						});
						console.log("Sum calculation result:", result);
						break;
					case "calculate_deviation":
						result = calculateDeviation({
							data: args.data,
							field_path: args.field_path,
							population: args.population !== undefined ? args.population : false,
							exclude_zeros: args.exclude_zeros,
						});
						console.log("Deviation calculation result:", result);
						break;
					case "calculate_percentage_deviation":
						result = calculatePercentageDeviation({
							data: args.data,
							exclude_zeros: args.exclude_zeros !== undefined ? args.exclude_zeros : true,
						});
						console.log("Percentage deviation calculation result:", result);
						break;
					case "get_all_numbers":
						result = getAllNumbersFromData(args);
						console.log("Get all numbers result:", result);
						break;
					default:
						result = { error: `Unknown function: ${toolCall.function.name}` };
				}

				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: JSON.stringify(result),
				});
			}
		}

		return res.json({ success: true, response: finalMessage.content });
	} catch (error) {
		console.error("Error:", error);
		return res.status(500).json({ error: "Internal server error", details: error.message });
	}
});

app.listen(port, () => {
	console.log(`Dynamic JSON Stats Server running on port ${port}`);
	console.log(`Calculate: POST http://localhost:${port}/calculate`);
});

module.exports = app;
