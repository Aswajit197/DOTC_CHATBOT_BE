const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

// ===== CALCULATION UTILITIES =====

function getNestedValue(obj, path) {
	if (!path) return obj;
	return path.split(".").reduce((current, key) => (current === null || current === undefined ? undefined : current[key]), obj);
}

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
		/index/i,
		/position/i,
		/order/i,
		/status/i,
		/state/i,
		/type/i,
		/^EDV$/i,
		/^80f3dfsd$/i, // Exclude specific metadata fields
	];
	return metadataPatterns.some((pattern) => pattern.test(fieldName));
}

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
		if (shouldInclude(current) && !isMetadataField(currentKey)) {
			numbers.push(current);
			return;
		}
		if (Array.isArray(current)) {
			current.forEach((item) => traverse(item));
		} else if (typeof current === "object" && current !== null) {
			Object.entries(current).forEach(([key, value]) => {
				if (!isMetadataField(key)) traverse(value, key);
			});
		}
	}

	traverse(data);
	return numbers;
}

// ===== PRE-CALCULATION ENGINE =====

function detectCalculationIntent(userMessage) {
	const msg = userMessage.toLowerCase();

	const patterns = {
		percentageDeviation: [
			/deviation/i, // Catch any deviation mention
			/percentage\s+(deviation|difference|variance)/i,
			/compare.*percentage/i,
			/how\s+much.*deviate/i,
			/variance/i,
		],
		standardDeviation: [/standard\s+deviation/i, /statistical\s+deviation/i],
		average: [/average/i, /mean(?!\s+deviation)/i, /avg\b/i],
		sum: [/total(?!\s+hours)/i, /sum\b/i, /add\s+up/i, /how\s+much\s+in\s+total/i],
	};

	// Check for percentage deviation first (higher priority)
	if (patterns.percentageDeviation.some((regex) => regex.test(msg))) {
		return "percentageDeviation";
	}

	for (const [type, regexList] of Object.entries(patterns)) {
		if (regexList.some((regex) => regex.test(msg))) {
			return type;
		}
	}

	return null;
}

function performCalculations(data, intent, userMessage) {
	const results = {};

	try {
		// Extract field path from user message if mentioned
		const fieldMatch = userMessage.match(/\b(shifts?|hours?|sales?|score|value)s?\b/i);
		const fieldPath = fieldMatch ? fieldMatch[1].toLowerCase() : null;

		console.log(`🎯 Detected intent: ${intent}, Field path: ${fieldPath}`);

		switch (intent) {
			case "percentageDeviation":
				// Check if it's driver-specific data structure
				if (Array.isArray(data) && data.length > 0 && data[0]?.shifts) {
					console.log("📊 Using driver percentage deviation calculation");
					results.percentageDeviation = calculatePercentageDeviation({
						data,
						exclude_zeros: true,
					});
				} else {
					console.log("📊 Using custom percentage deviation calculation");
					results.customPercentageDeviation = calculateCustomPercentageDeviation({
						data,
						field_path: fieldPath,
						exclude_zeros: false,
					});
				}
				break;

			case "standardDeviation":
				console.log("📊 Calculating standard deviation");
				results.deviation = calculateDeviation({
					data,
					field_path: fieldPath,
					exclude_zeros: false,
				});
				break;

			case "average":
				console.log("📊 Calculating average");
				results.average = calculateAverage({
					data,
					field_path: fieldPath,
					exclude_zeros: false,
				});
				break;

			case "sum":
				console.log("📊 Calculating sum");
				results.sum = calculateSum({
					data,
					field_path: fieldPath,
					exclude_zeros: false,
				});
				break;
		}

		console.log("✅ Pre-calculation complete:", Object.keys(results));
	} catch (error) {
		console.error("❌ Pre-calculation error:", error.message);
	}

	return results;
}

// ===== CALCULATION FUNCTIONS =====

function calculateAverage({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	const sum = numbers.reduce((acc, num) => acc + num, 0);
	const average = sum / numbers.length;

	return {
		average: parseFloat(average.toFixed(2)),
		count: numbers.length,
		total_sum: parseFloat(sum.toFixed(2)),
		exclude_zeros,
	};
}

function calculateSum({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	const sum = numbers.reduce((acc, num) => acc + num, 0);
	return {
		sum: parseFloat(sum.toFixed(2)),
		count: numbers.length,
		exclude_zeros,
	};
}

function calculateDeviation({ data, field_path, population = false, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };
	if (numbers.length === 1) return { standard_deviation: 0, variance: 0, mean: numbers[0], count: 1 };

	const mean = numbers.reduce((acc, num) => acc + num, 0) / numbers.length;
	const squaredDifferences = numbers.map((num) => Math.pow(num - mean, 2));
	const variance = squaredDifferences.reduce((acc, diff) => acc + diff, 0) / (population ? numbers.length : numbers.length - 1);
	const standardDeviation = Math.sqrt(variance);

	return {
		standard_deviation: parseFloat(standardDeviation.toFixed(2)),
		variance: parseFloat(variance.toFixed(2)),
		mean: parseFloat(mean.toFixed(2)),
		count: numbers.length,
		type: population ? "population" : "sample",
	};
}

function calculatePercentageDeviation({ data, exclude_zeros = true }) {
	console.log("📊 Calculating percentage deviation for", data.length, "drivers");

	const driverTotals = data.map((driver) => {
		const shifts = driver.shifts || {};
		let totalHours = 0;

		// Sum all shift types, excluding metadata fields
		Object.entries(shifts).forEach(([shiftType, hours]) => {
			// Skip metadata fields like EDV, 80f3dfsd, etc.
			if (isMetadataField(shiftType)) {
				console.log(`   ⏭️ Skipping metadata field: ${shiftType}`);
				return;
			}

			if (typeof hours === "number" && !isNaN(hours)) {
				if (!exclude_zeros || hours !== 0) {
					console.log(`   ✅ ${driver.driverName}: ${shiftType} = ${hours}h`);
					totalHours += hours;
				}
			}
		});

		console.log(`📈 ${driver.driverName} total: ${totalHours}h`);
		return {
			driverId: driver.driverId,
			driverName: driver.driverName,
			totalHours,
			shifts,
		};
	});

	const totalHours = driverTotals.map((d) => d.totalHours);
	console.log("📊 All total hours:", totalHours.slice(0, 10));

	if (totalHours.length === 0) return { error: "No valid working hours found" };

	const average = totalHours.reduce((sum, h) => sum + h, 0) / totalHours.length;
	console.log("📊 Average hours:", average);

	const results = driverTotals.map((driver) => {
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

	results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

	console.log(
		"✅ Top 3 deviations:",
		results.slice(0, 3).map((r) => `${r.driverName}: ${r.percentageDeviation}%`)
	);

	return {
		averageTotalHours: parseFloat(average.toFixed(2)),
		totalDrivers: results.length,
		results,
		summary: {
			highestDeviation: results[0]?.percentageDeviation || 0,
			lowestDeviation: results[results.length - 1]?.percentageDeviation || 0,
			averageDeviation: parseFloat(
				(results.reduce((sum, r) => sum + Math.abs(r.percentageDeviation), 0) / results.length).toFixed(2)
			),
		},
	};
}

function calculateCustomPercentageDeviation({ data, field_path, group_by, exclude_zeros = false }) {
	if (!Array.isArray(data)) return { error: "Data must be an array" };

	const groups = {};

	data.forEach((item, index) => {
		const value = field_path ? getNestedValue(item, field_path) : typeof item === "number" ? item : null;
		const groupKey = group_by ? getNestedValue(item, group_by) || `item_${index}` : `item_${index}`;

		if (typeof value === "number" && !isNaN(value)) {
			if (!exclude_zeros || value !== 0) {
				if (!groups[groupKey]) groups[groupKey] = [];
				groups[groupKey].push({ ...item, value });
			}
		}
	});

	const allValues = Object.values(groups)
		.flat()
		.map((item) => item.value);
	if (allValues.length === 0) return { error: "No valid numbers found" };

	const overallAverage = allValues.reduce((sum, val) => sum + val, 0) / allValues.length;

	const results = Object.entries(groups).map(([groupKey, items]) => {
		const groupValues = items.map((item) => item.value);
		const groupAverage = groupValues.reduce((sum, val) => sum + val, 0) / groupValues.length;
		const deviation = groupAverage - overallAverage;
		const percentageDeviation = (deviation / overallAverage) * 100;

		return {
			group: groupKey,
			average: parseFloat(groupAverage.toFixed(2)),
			count: groupValues.length,
			deviation: parseFloat(deviation.toFixed(2)),
			percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
			items,
		};
	});

	results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

	return {
		overallAverage: parseFloat(overallAverage.toFixed(2)),
		totalItems: allValues.length,
		totalGroups: results.length,
		results,
		summary: {
			highestDeviation: results[0]?.percentageDeviation || 0,
			lowestDeviation: results[results.length - 1]?.percentageDeviation || 0,
		},
	};
}

// ===== MAIN FUNCTION =====

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
		// 🚀 OPTIMIZATION 1: Pre-calculate if calculation intent detected
		const calculationIntent = detectCalculationIntent(userMessage);
		let preCalculatedResults = null;

		if (calculationIntent) {
			console.log(`📊 Pre-calculating: ${calculationIntent}`);
			preCalculatedResults = performCalculations(actualData, calculationIntent, userMessage);
		}

		// 🚀 OPTIMIZATION 2: Build compact data summary instead of full data
		const dataSummary = Array.isArray(actualData)
			? `Array with ${actualData.length} items. Sample: ${JSON.stringify(actualData.slice(0, 2))}`
			: `Object with ${Object.keys(actualData || {}).length} keys`;

		// 🚀 OPTIMIZATION 3: Single-shot prompt with pre-calculated results
		const prompt = `
You're a smart assistant processing structured API data.

### API Info
Name: ${api.name}
Description: ${api.description}

### User Message
"${userMessage}"

### Query Parameters
${JSON.stringify(params, null, 2)}

${
	preCalculatedResults
		? `
### Pre-Calculated Results
${JSON.stringify(preCalculatedResults, null, 2)}

IMPORTANT: These calculations have been pre-computed. You MUST:
1. Display the average hours: ${
				preCalculatedResults.percentageDeviation?.averageTotalHours || preCalculatedResults.average?.average || "N/A"
		  } hours
2. Show EVERY driver with their total hours and deviation percentage
3. Create an HTML table with columns: Driver Name, Total Hours, Deviation from Average, Percentage Deviation
4. Sort by percentage deviation (highest to lowest)
5. Include summary statistics at the end
`
		: ""
}

### Data Summary
${dataSummary}

### Full Data (for reference)
${JSON.stringify(actualData, null, 2)}

---

### Instructions
1. Understand user intent - they want total hours AND deviations from average
2. **CRITICAL**: If pre-calculated results exist, use them to create a complete table
3. Display ALL ${actualData?.length || 0} drivers in the table
4. Format as HTML table with these exact columns:
   - Driver Name
   - Total Hours
   - Deviation (hours from average)
   - Percentage Deviation (%)
5. Start with <p> stating: "Here are the total hours scheduled for each driver over the last three weeks, along with their deviations from the average hours scheduled."
6. After the table, include <div class="summary"> with:
   - Total number of drivers: ${actualData?.length || 0}
   - Average hours scheduled: [exact number]
   - Highest deviation: [driver name] at [X]%
   - Lowest deviation: [driver name] at [X]%
7. Format dates in readable format
8. Use alternating row colors for better readability

${
	api?.isSuitableForGraph
		? `<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>`
		: ""
}

Output only valid HTML. End with exactly: ###END###
`;

		// 🚀 OPTIMIZATION 4: Single streaming call, no function calling overhead
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

		const finalReply = fullText.replace(/###END###/g, "").trim();

		// Save session
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
		console.error("processIntentAndFormatResponse error:", err.message);
		return {
			userReply: "Here's the available data. (Intent-based processing failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;

// const { OpenAI } = require("openai");
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const Session = require("../model/session.model");

// console.log("📋 API Processor module loaded with enhanced logging");

// // Enhanced dynamic tools with exclude_zeros parameter for all calculation functions
// const tools = [
// 	{
// 		type: "function",
// 		function: {
// 			name: "calculate_average",
// 			description: "Calculate the arithmetic mean (average) of numbers from any JSON structure",
// 			parameters: {
// 				type: "object",
// 				properties: {
// 					data: {
// 						description: "The data source - can be array of numbers or JSON objects",
// 					},
// 					field_path: {
// 						type: "string",
// 						description: "Dot notation path to extract numbers from JSON objects (e.g., 'score', 'sales.q1', 'grades.0')",
// 					},
// 					exclude_zeros: {
// 						type: "boolean",
// 						description: "Whether to exclude zero values from the calculation",
// 						default: false,
// 					},
// 				},
// 				required: ["data"],
// 			},
// 		},
// 	},
// 	{
// 		type: "function",
// 		function: {
// 			name: "calculate_sum",
// 			description: "Calculate the sum total of numbers from any JSON structure",
// 			parameters: {
// 				type: "object",
// 				properties: {
// 					data: {
// 						description: "The data source - can be array of numbers or JSON objects",
// 					},
// 					field_path: {
// 						type: "string",
// 						description: "Dot notation path to extract numbers from JSON objects",
// 					},
// 					exclude_zeros: {
// 						type: "boolean",
// 						description: "Whether to exclude zero values from the calculation",
// 						default: false,
// 					},
// 				},
// 				required: ["data"],
// 			},
// 		},
// 	},
// 	{
// 		type: "function",
// 		function: {
// 			name: "calculate_deviation",
// 			description: "Calculate standard deviation and variance for numbers from any JSON structure",
// 			parameters: {
// 				type: "object",
// 				properties: {
// 					data: {
// 						description: "The data source - can be array of numbers or JSON objects",
// 					},
// 					field_path: {
// 						type: "string",
// 						description: "Dot notation path to extract numbers from JSON objects",
// 					},
// 					population: {
// 						type: "boolean",
// 						description: "True for population standard deviation, false for sample standard deviation",
// 						default: false,
// 					},
// 					exclude_zeros: {
// 						type: "boolean",
// 						description: "Whether to exclude zero values from the calculation",
// 						default: false,
// 					},
// 				},
// 				required: ["data"],
// 			},
// 		},
// 	},
// 	{
// 		type: "function",
// 		function: {
// 			name: "get_all_numbers",
// 			description: "Extract all numbers from a JSON structure for analysis",
// 			parameters: {
// 				type: "object",
// 				properties: {
// 					data: {
// 						description: "The JSON data to extract numbers from - can be array, object, or primitive",
// 					},
// 					field_path: {
// 						type: "string",
// 						description: "Optional dot notation path to extract only a specific field",
// 					},
// 					exclude_zeros: {
// 						type: "boolean",
// 						description: "Whether to exclude zero values from the results",
// 						default: false,
// 					},
// 				},
// 				required: ["data"],
// 			},
// 		},
// 	},
// 	{
// 		type: "function",
// 		function: {
// 			name: "calculate_percentage_deviation",
// 			description: "Calculate percentage deviation from average for total working hours across all shift types",
// 			parameters: {
// 				type: "object",
// 				properties: {
// 					data: {
// 						description: "Array of driver objects with shifts data",
// 					},
// 					exclude_zeros: {
// 						type: "boolean",
// 						description: "Whether to exclude zero values when calculating totals",
// 						default: true,
// 					},
// 				},
// 				required: ["data"],
// 			},
// 		},
// 	},
// 	{
// 		type: "function",
// 		function: {
// 			name: "calculate_custom_percentage_deviation",
// 			description: "Calculate percentage deviation from average for any numeric field in the data",
// 			parameters: {
// 				type: "object",
// 				properties: {
// 					data: {
// 						description: "The data source - can be array of numbers or JSON objects",
// 					},
// 					field_path: {
// 						type: "string",
// 						description: "Dot notation path to extract numbers from JSON objects for deviation calculation",
// 					},
// 					group_by: {
// 						type: "string",
// 						description: "Field to group results by (e.g., 'day', 'category', 'type')",
// 					},
// 					exclude_zeros: {
// 						type: "boolean",
// 						description: "Whether to exclude zero values when calculating",
// 						default: false,
// 					},
// 				},
// 				required: ["data"],
// 			},
// 		},
// 	},
// ];

// /**
//  * Utility function to get value from object using dot notation
//  */
// function getNestedValue(obj, path) {
// 	console.log("🔍 Getting nested value:", { path, objType: typeof obj });
// 	if (!path) return obj;
// 	const result = path.split(".").reduce((current, key) => {
// 		if (current === null || current === undefined) return undefined;
// 		return current[key];
// 	}, obj);
// 	console.log("🔍 Nested value result:", { path, result });
// 	return result;
// }

// /**
//  * Check if a field name should be excluded as metadata
//  */
// function isMetadataField(fieldName) {
// 	if (!fieldName) return false;

// 	const metadataPatterns = [
// 		/^id$/i,
// 		/.*_id$/i,
// 		/.*Id$/,
// 		/^uid$/i,
// 		/^uuid$/i,
// 		/^guid$/i,
// 		/timestamp/i,
// 		/created/i,
// 		/updated/i,
// 		/modified/i,
// 		/version/i,
// 		/revision/i,
// 		/build/i,
// 		/index/i,
// 		/position/i,
// 		/order/i,
// 		/status/i,
// 		/state/i,
// 		/type/i,
// 		/kind/i,
// 		/.*_key$/i,
// 		/.*Key$/,
// 		/.*_code$/i,
// 		/.*Code$/,
// 	];

// 	const isMetadata = metadataPatterns.some((pattern) => pattern.test(fieldName));
// 	console.log("🏷️ Metadata field check:", { fieldName, isMetadata });
// 	return isMetadata;
// }

// /**
//  * Extract numbers from any data structure, including nested objects
//  */
// function extractNumbers(data, fieldPath = null, excludeZeros = false) {
// 	console.log("🔢 Starting number extraction:", {
// 		dataType: typeof data,
// 		isArray: Array.isArray(data),
// 		fieldPath,
// 		excludeZeros,
// 	});

// 	const numbers = [];

// 	const shouldInclude = (value) => {
// 		if (typeof value !== "number" || isNaN(value)) return false;
// 		if (excludeZeros && value === 0) return false;
// 		return true;
// 	};

// 	if (fieldPath) {
// 		console.log("🎯 Using field path extraction");
// 		if (Array.isArray(data)) {
// 			console.log(`📊 Processing array with ${data.length} items for field path: ${fieldPath}`);
// 			data.forEach((item, index) => {
// 				const value = getNestedValue(item, fieldPath);
// 				console.log(`📝 Item ${index} field value:`, value);
// 				if (typeof value === "object" && value !== null) {
// 					Object.values(value).forEach((val) => {
// 						if (shouldInclude(val)) {
// 							console.log("✅ Adding nested object value:", val);
// 							numbers.push(val);
// 						}
// 					});
// 				} else if (shouldInclude(value)) {
// 					console.log("✅ Adding direct value:", value);
// 					numbers.push(value);
// 				}
// 			});
// 		} else {
// 			console.log("📊 Processing single object for field path");
// 			const value = getNestedValue(data, fieldPath);
// 			if (typeof value === "object" && value !== null) {
// 				Object.values(value).forEach((val) => {
// 					if (shouldInclude(val)) {
// 						console.log("✅ Adding nested object value:", val);
// 						numbers.push(val);
// 					}
// 				});
// 			} else if (shouldInclude(value)) {
// 				console.log("✅ Adding direct value:", value);
// 				numbers.push(value);
// 			}
// 		}
// 		console.log("🔢 Field path extraction complete. Numbers found:", numbers.length);
// 		return numbers;
// 	}

// 	console.log("🔄 Using recursive traversal");
// 	function traverse(current, currentKey = null) {
// 		if (shouldInclude(current, currentKey)) {
// 			console.log("✅ Adding number:", current, "from key:", currentKey);
// 			numbers.push(current);
// 			return;
// 		}

// 		if (Array.isArray(current)) {
// 			console.log("📋 Traversing array with", current.length, "items");
// 			current.forEach((item, index) => {
// 				console.log(`🔄 Processing array item ${index}`);
// 				traverse(item);
// 			});
// 		} else if (typeof current === "object" && current !== null) {
// 			const entries = Object.entries(current);
// 			console.log("🏗️ Traversing object with", entries.length, "properties");
// 			entries.forEach(([key, value]) => {
// 				if (!isMetadataField(key)) {
// 					console.log(`🔄 Processing object property: ${key}`);
// 					traverse(value, key);
// 				} else {
// 					console.log(`⏭️ Skipping metadata field: ${key}`);
// 				}
// 			});
// 		}
// 	}

// 	traverse(data);
// 	console.log("🔢 Recursive extraction complete. Numbers found:", numbers.length);
// 	console.log("🔢 Sample numbers:", numbers.slice(0, 5));
// 	return numbers;
// }

// // Calculation functions
// function calculateAverage({ data, field_path, exclude_zeros = false }) {
// 	console.log("📊 Starting average calculation:", { field_path, exclude_zeros });
// 	try {
// 		const numbers = extractNumbers(data, field_path, exclude_zeros);

// 		if (numbers.length === 0) {
// 			console.log("❌ No valid numbers found for average calculation");
// 			return {
// 				error: "No valid numbers found",
// 				data_sample: JSON.stringify(data).substring(0, 200) + "...",
// 			};
// 		}

// 		const sum = numbers.reduce((acc, num) => acc + num, 0);
// 		const average = sum / numbers.length;

// 		const result = {
// 			average: parseFloat(average.toFixed(2)),
// 			count: numbers.length,
// 			total_sum: parseFloat(sum.toFixed(2)),
// 			field_path: field_path || "auto-detected (excluding metadata)",
// 			exclude_zeros: exclude_zeros,
// 			sample_values: numbers.slice(0, 5),
// 		};

// 		console.log("✅ Average calculation complete:", result);
// 		return result;
// 	} catch (error) {
// 		console.error("❌ Average calculation error:", error.message);
// 		return { error: `Calculation error: ${error.message}` };
// 	}
// }

// function calculateSum({ data, field_path, exclude_zeros = false }) {
// 	console.log("📊 Starting sum calculation:", { field_path, exclude_zeros });
// 	try {
// 		const numbers = extractNumbers(data, field_path, exclude_zeros);

// 		if (numbers.length === 0) {
// 			console.log("❌ No valid numbers found for sum calculation");
// 			return {
// 				error: "No valid numbers found",
// 				data_sample: JSON.stringify(data).substring(0, 200) + "...",
// 			};
// 		}

// 		const sum = numbers.reduce((acc, num) => acc + num, 0);

// 		const result = {
// 			sum: parseFloat(sum.toFixed(2)),
// 			count: numbers.length,
// 			field_path: field_path || "auto-detected (excluding metadata)",
// 			exclude_zeros: exclude_zeros,
// 			sample_values: numbers.slice(0, 5),
// 		};

// 		console.log("✅ Sum calculation complete:", result);
// 		return result;
// 	} catch (error) {
// 		console.error("❌ Sum calculation error:", error.message);
// 		return { error: `Calculation error: ${error.message}` };
// 	}
// }

// function calculateDeviation({ data, field_path, population = false, exclude_zeros = false }) {
// 	console.log("📊 Starting deviation calculation:", { field_path, population, exclude_zeros });
// 	try {
// 		const numbers = extractNumbers(data, field_path, exclude_zeros);

// 		if (numbers.length === 0) {
// 			console.log("❌ No valid numbers found for deviation calculation");
// 			return {
// 				error: "No valid numbers found",
// 				data_sample: JSON.stringify(data).substring(0, 200) + "...",
// 			};
// 		}

// 		if (numbers.length === 1) {
// 			console.log("ℹ️ Only one number found, deviation is 0");
// 			return {
// 				standard_deviation: 0,
// 				variance: 0,
// 				mean: numbers[0],
// 				count: 1,
// 				field_path: field_path || "auto-detected (excluding metadata)",
// 				exclude_zeros: exclude_zeros,
// 			};
// 		}

// 		const mean = numbers.reduce((acc, num) => acc + num, 0) / numbers.length;
// 		const squaredDifferences = numbers.map((num) => Math.pow(num - mean, 2));
// 		const variance = squaredDifferences.reduce((acc, diff) => acc + diff, 0) / (population ? numbers.length : numbers.length - 1);
// 		const standardDeviation = Math.sqrt(variance);

// 		const result = {
// 			standard_deviation: parseFloat(standardDeviation.toFixed(2)),
// 			variance: parseFloat(variance.toFixed(2)),
// 			mean: parseFloat(mean.toFixed(2)),
// 			count: numbers.length,
// 			field_path: field_path || "auto-detected (excluding metadata)",
// 			exclude_zeros: exclude_zeros,
// 			type: population ? "population" : "sample",
// 			sample_values: numbers.slice(0, 5),
// 		};

// 		console.log("✅ Deviation calculation complete:", result);
// 		return result;
// 	} catch (error) {
// 		console.error("❌ Deviation calculation error:", error.message);
// 		return { error: `Calculation error: ${error.message}` };
// 	}
// }

// function calculatePercentageDeviation({ data, exclude_zeros = true }) {
// 	console.log("📊 Starting percentage deviation calculation (driver-specific):", { exclude_zeros });
// 	try {
// 		const driverTotals = data.map((driver, index) => {
// 			console.log(`👤 Processing driver ${index}:`, driver.driverName || driver.driverId);
// 			const shifts = driver.shifts || {};
// 			let totalHours = 0;

// 			Object.entries(shifts).forEach(([shiftType, hours]) => {
// 				console.log(`   ⏰ Shift ${shiftType}: ${hours} hours`);
// 				if (typeof hours === "number" && !isNaN(hours)) {
// 					if (!exclude_zeros || hours !== 0) {
// 						totalHours += hours;
// 					}
// 				}
// 			});

// 			console.log(`📈 Driver total hours: ${totalHours}`);
// 			return {
// 				driverId: driver.driverId,
// 				driverName: driver.driverName,
// 				totalHours: totalHours,
// 				shifts: shifts,
// 			};
// 		});

// 		const totalHours = driverTotals.map((driver) => driver.totalHours);
// 		console.log("📊 All driver total hours:", totalHours);

// 		if (totalHours.length === 0) {
// 			console.log("❌ No valid working hours found");
// 			return { error: "No valid working hours found" };
// 		}

// 		const average = totalHours.reduce((sum, hours) => sum + hours, 0) / totalHours.length;
// 		console.log("📊 Average total hours:", average);

// 		const results = driverTotals.map((driver) => {
// 			const deviation = driver.totalHours - average;
// 			const percentageDeviation = (deviation / average) * 100;

// 			console.log(`👤 ${driver.driverName}: ${driver.totalHours}h (${percentageDeviation.toFixed(2)}% deviation)`);

// 			return {
// 				driverId: driver.driverId,
// 				driverName: driver.driverName,
// 				totalHours: driver.totalHours,
// 				deviation: parseFloat(deviation.toFixed(2)),
// 				percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
// 				shifts: driver.shifts,
// 			};
// 		});

// 		results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

// 		const finalResult = {
// 			averageTotalHours: parseFloat(average.toFixed(2)),
// 			totalDrivers: results.length,
// 			results: results,
// 			summary: {
// 				highestDeviation: results[0].percentageDeviation,
// 				lowestDeviation: results[results.length - 1].percentageDeviation,
// 				averageDeviation: parseFloat((results.reduce((sum, r) => sum + r.percentageDeviation, 0) / results.length).toFixed(2)),
// 			},
// 		};

// 		console.log("✅ Percentage deviation calculation complete:", finalResult.summary);
// 		return finalResult;
// 	} catch (error) {
// 		console.error("❌ Percentage deviation calculation error:", error.message);
// 		return { error: `Calculation error: ${error.message}` };
// 	}
// }

// function calculateCustomPercentageDeviation({ data, field_path, group_by, exclude_zeros = false }) {
// 	console.log("📊 Starting custom percentage deviation calculation:", { field_path, group_by, exclude_zeros });
// 	try {
// 		if (!Array.isArray(data)) {
// 			console.log("❌ Data is not an array");
// 			return { error: "Data must be an array for custom percentage deviation calculation" };
// 		}

// 		// Extract values and group by specified field
// 		const groups = {};

// 		data.forEach((item, index) => {
// 			console.log(`📝 Processing item ${index}`);
// 			const value = field_path ? getNestedValue(item, field_path) : typeof item === "number" ? item : null;
// 			const groupKey = group_by ? getNestedValue(item, group_by) || `item_${index}` : `item_${index}`;

// 			console.log(`   🎯 Value: ${value}, Group: ${groupKey}`);

// 			if (typeof value === "number" && !isNaN(value)) {
// 				if (!exclude_zeros || value !== 0) {
// 					if (!groups[groupKey]) {
// 						groups[groupKey] = [];
// 						console.log(`   🆕 Created new group: ${groupKey}`);
// 					}
// 					groups[groupKey].push({ ...item, value });
// 					console.log(`   ✅ Added to group ${groupKey}: ${value}`);
// 				} else {
// 					console.log(`   ⏭️ Excluded zero value for group ${groupKey}`);
// 				}
// 			} else {
// 				console.log(`   ❌ Invalid value for item ${index}: ${value}`);
// 			}
// 		});

// 		console.log("📊 Groups created:", Object.keys(groups));

// 		// Calculate overall average
// 		const allValues = Object.values(groups)
// 			.flat()
// 			.map((item) => item.value);

// 		console.log("📊 All values for average calculation:", allValues);

// 		if (allValues.length === 0) {
// 			console.log("❌ No valid numbers found for calculation");
// 			return { error: "No valid numbers found for calculation" };
// 		}

// 		const overallAverage = allValues.reduce((sum, val) => sum + val, 0) / allValues.length;
// 		console.log("📊 Overall average:", overallAverage);

// 		// Calculate percentage deviation for each group
// 		const results = Object.entries(groups).map(([groupKey, items]) => {
// 			const groupValues = items.map((item) => item.value);
// 			const groupAverage = groupValues.reduce((sum, val) => sum + val, 0) / groupValues.length;
// 			const deviation = groupAverage - overallAverage;
// 			const percentageDeviation = (deviation / overallAverage) * 100;

// 			console.log(`📊 Group ${groupKey}: avg=${groupAverage}, dev=${percentageDeviation.toFixed(2)}%`);

// 			return {
// 				group: groupKey,
// 				average: parseFloat(groupAverage.toFixed(2)),
// 				count: groupValues.length,
// 				deviation: parseFloat(deviation.toFixed(2)),
// 				percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
// 				items: items,
// 			};
// 		});

// 		// Sort by percentage deviation
// 		results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

// 		const finalResult = {
// 			overallAverage: parseFloat(overallAverage.toFixed(2)),
// 			totalItems: allValues.length,
// 			totalGroups: results.length,
// 			results: results,
// 			summary: {
// 				highestDeviation: results[0]?.percentageDeviation || 0,
// 				lowestDeviation: results[results.length - 1]?.percentageDeviation || 0,
// 			},
// 		};

// 		console.log("✅ Custom percentage deviation calculation complete:", finalResult.summary);
// 		return finalResult;
// 	} catch (error) {
// 		console.error("❌ Custom percentage deviation calculation error:", error.message);
// 		return { error: `Calculation error: ${error.message}` };
// 	}
// }

// function getAllNumbersFromData({ data, field_path, exclude_zeros = false }) {
// 	console.log("📊 Starting get all numbers extraction:", { field_path, exclude_zeros });
// 	try {
// 		const numbers = extractNumbers(data, field_path, exclude_zeros);

// 		const result = {
// 			numbers: numbers,
// 			count: numbers.length,
// 			field_path: field_path || "auto-detected",
// 			exclude_zeros: exclude_zeros,
// 			sample_values: numbers.slice(0, 10),
// 			min: numbers.length > 0 ? Math.min(...numbers) : null,
// 			max: numbers.length > 0 ? Math.max(...numbers) : null,
// 			total: numbers.length > 0 ? numbers.reduce((sum, num) => sum + num, 0) : null,
// 		};

// 		console.log("✅ Get all numbers extraction complete:", {
// 			count: result.count,
// 			min: result.min,
// 			max: result.max,
// 			total: result.total,
// 		});
// 		return result;
// 	} catch (error) {
// 		console.error("❌ Get all numbers extraction error:", error.message);
// 		return { error: `Extraction error: ${error.message}` };
// 	}
// }

// /**
//  * Streams GPT's partial plain text response until "###END###",
//  * with integrated function calling capabilities for calculations
//  */
// const processIntentAndFormatResponse = async ({
// 	userMessage,
// 	api,
// 	exampleResponse,
// 	actualData,
// 	params = {},
// 	session,
// 	onStream,
// }) => {
// 	console.log("🚀 Starting processIntentAndFormatResponse");
// 	console.log("📝 User message:", userMessage);
// 	console.log("🔧 API info:", api?.name);
// 	console.log("📊 Data type:", typeof actualData, "Is array:", Array.isArray(actualData));
// 	console.log("⚙️ Params:", params);

// 	let fullText = "";

// 	try {
// 		// Enhanced system prompt with calculation capabilities
// 		const systemPrompt = `You are a smart assistant specialized in processing structured API data and performing statistical calculations.

// KEY CAPABILITIES:
// 1. calculate_average: Calculate average of numbers from any data structure
// 2. calculate_sum: Calculate sum of numbers from any data structure
// 3. calculate_deviation: Calculate standard deviation and variance
// 4. get_all_numbers: Extract all numbers from data structure
// 5. calculate_percentage_deviation: Calculate percentage deviation for driver working hours
// 6. calculate_custom_percentage_deviation: Calculate percentage deviation for any field with grouping

// CRITICAL FUNCTION SELECTION:
// - For queries about "deviation in percentage", "percentage difference", "compare items": USE calculate_custom_percentage_deviation or calculate_percentage_deviation
// - For general "standard deviation" or "variance": USE calculate_deviation
// - For averages: USE calculate_average
// - For totals/sums: USE calculate_sum
// - For data exploration: USE get_all_numbers

// ANALYSIS WORKFLOW:
// 1. If user asks for calculations, use appropriate function tools first
// 2. Present results in clear HTML format with proper tables
// 3. Always calculate averages before showing deviation percentages
// 4. Stream the response naturally while incorporating calculation results

// Your tasks:
// 1. Understand the user's intent from their message.
// 2. Use function tools for any calculations requested (averages, deviations, sums, etc.)
// 3. Filter, transform, or aggregate the provided API data as needed.
// 4. If user asks for "top N items per category", group and display accordingly.
// 5. Apply numeric thresholds strictly when specified.
// 6. Format responses in appropriate HTML (tables, lists, or paragraphs).
// 7. Always provide summary insights with exact numbers.

// ---

// ### API Info
// Name: ${api.name}
// Description: ${api.description}

// ### User Message
// "${userMessage}"

// ### Query Parameters
// ${JSON.stringify(params, null, 2)}

// ### Example Response Format
// ${JSON.stringify(exampleResponse, null, 2)}

// ### Raw API Data
// ${JSON.stringify(actualData, null, 2)}

// ---

// ### Output Instructions
// - Use function tools for any mathematical calculations
// - Format output as HTML based on data type and user intent
// - Start with <p> introduction before tables/lists
// - Include <div class="summary"> with exact counts and insights
// - Format dates in readable format
// - For calculations, show both the process and results clearly
// - End response with exactly: ###END###

// ${
// 	api?.isSuitableForGraph
// 		? `<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>`
// 		: ``
// }
// `;

// 		console.log("💭 System prompt created, length:", systemPrompt.length);

// 		let messages = [
// 			{ role: "system", content: systemPrompt },
// 			{ role: "user", content: `${userMessage}\n\nData: ${JSON.stringify(actualData)}` },
// 		];

// 		console.log("📨 Initial messages prepared, count:", messages.length);

// 		// Handle function calling workflow
// 		let iterationCount = 0;
// 		while (true) {
// 			iterationCount++;
// 			console.log(`🔄 Function calling iteration ${iterationCount}`);

// 			const response = await openai.chat.completions.create({
// 				model: "gpt-4o-mini",
// 				messages,
// 				tools,
// 				tool_choice: "auto",
// 				temperature: 0,
// 			});

// 			console.log("🤖 OpenAI response received");
// 			const message = response.choices[0].message;
// 			console.log("📝 Message content length:", message.content?.length || 0);
// 			console.log("🔧 Tool calls count:", message.tool_calls?.length || 0);

// 			messages.push(message);

// 			// If no tool calls, proceed to streaming response
// 			if (!message.tool_calls || message.tool_calls.length === 0) {
// 				console.log("✅ No more tool calls needed, proceeding to final response");
// 				break;
// 			}

// 			// Execute function calls
// 			for (const toolCall of message.tool_calls) {
// 				console.log("🔧 Executing tool call:", toolCall.function.name);
// 				console.log("📋 Tool arguments:", toolCall.function.arguments);

// 				let result;
// 				const args = JSON.parse(toolCall.function.arguments);

// 				switch (toolCall.function.name) {
// 					case "calculate_average":
// 						console.log("📊 Executing calculate_average");
// 						result = calculateAverage({
// 							data: args.data,
// 							field_path: args.field_path,
// 							exclude_zeros: args.exclude_zeros,
// 						});
// 						break;
// 					case "calculate_sum":
// 						console.log("📊 Executing calculate_sum");
// 						result = calculateSum({
// 							data: args.data,
// 							field_path: args.field_path,
// 							exclude_zeros: args.exclude_zeros,
// 						});
// 						break;
// 					case "calculate_deviation":
// 						console.log("📊 Executing calculate_deviation");
// 						result = calculateDeviation({
// 							data: args.data,
// 							field_path: args.field_path,
// 							population: args.population !== undefined ? args.population : false,
// 							exclude_zeros: args.exclude_zeros,
// 						});
// 						break;
// 					case "calculate_percentage_deviation":
// 						console.log("📊 Executing calculate_percentage_deviation");
// 						result = calculatePercentageDeviation({
// 							data: args.data,
// 							exclude_zeros: args.exclude_zeros !== undefined ? args.exclude_zeros : true,
// 						});
// 						break;
// 					case "calculate_custom_percentage_deviation":
// 						console.log("📊 Executing calculate_custom_percentage_deviation");
// 						result = calculateCustomPercentageDeviation({
// 							data: args.data,
// 							field_path: args.field_path,
// 							group_by: args.group_by,
// 							exclude_zeros: args.exclude_zeros,
// 						});
// 						break;
// 					case "get_all_numbers":
// 						console.log("📊 Executing get_all_numbers");
// 						result = getAllNumbersFromData(args);
// 						break;
// 					default:
// 						console.log("❌ Unknown function:", toolCall.function.name);
// 						result = { error: `Unknown function: ${toolCall.function.name}` };
// 				}

// 				console.log("✅ Tool call result:", result.error ? "ERROR" : "SUCCESS");
// 				if (result.error) {
// 					console.log("❌ Tool call error:", result.error);
// 				}

// 				messages.push({
// 					role: "tool",
// 					tool_call_id: toolCall.id,
// 					content: JSON.stringify(result),
// 				});
// 			}

// 			console.log("📨 Messages count after tool calls:", messages.length);
// 		}

// 		// Now stream the final response
// 		console.log("🌊 Starting final response streaming");
// 		const finalPrompt = `Based on the function call results above, provide a comprehensive HTML response that addresses the user's question: "${userMessage}"

// Include:
// - Clear introduction paragraph
// - Properly formatted HTML tables/lists based on the data
// - Summary section with key insights
// - End with ###END###`;

// 		messages.push({ role: "user", content: finalPrompt });
// 		console.log("📨 Final messages count:", messages.length);

// 		const completion = await openai.chat.completions.create({
// 			model: "gpt-4o-mini",
// 			messages,
// 			temperature: 0,
// 			stream: true,
// 		});

// 		console.log("🌊 Streaming response started");
// 		let chunkCount = 0;
// 		for await (const chunk of completion) {
// 			chunkCount++;
// 			const delta = chunk.choices?.[0]?.delta?.content || "";
// 			if (!delta) continue;

// 			fullText += delta;

// 			// Stop when END marker appears
// 			if (fullText.includes("###END###")) {
// 				console.log("🛑 END marker found, stopping stream");
// 				break;
// 			}

// 			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
// 			if (cleaned) {
// 				const formatted = cleaned
// 					.replace(/([a-z])([A-Z])/g, "$1 $2")
// 					.replace(/(\d)([A-Za-z])/g, "$1 $2")
// 					.replace(/([a-zA-Z])(\d)/g, "$1 $2");
// 				if (onStream) onStream(formatted);
// 			}
// 		}

// 		const finalReply = fullText.replace(/###END###/g, "").trim();

// 		// Save the session
// 		await Session.updateOne(
// 			{ _id: session._id },
// 			{
// 				$set: {
// 					lastResponseMessage: finalReply,
// 					lastSuccessUserMessage: userMessage,
// 					lastSuccessIntent: api?.name || null,
// 					lastSuccessApiResponse: actualData,
// 					lastSuccessParams: params,
// 					missingField: null,
// 				},
// 			}
// 		);

// 		return {
// 			userReply: finalReply,
// 			params,
// 			api,
// 		};
// 	} catch (err) {
// 		console.error("processIntentAndFormatResponse error:", err.message);
// 		return {
// 			userReply: "Here's the available data. (Intent-based processing failed.)",
// 			params,
// 			api,
// 		};
// 	}
// };

// module.exports = processIntentAndFormatResponse;
