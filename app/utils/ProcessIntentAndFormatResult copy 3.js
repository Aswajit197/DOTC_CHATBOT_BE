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
		/^80f3dfsd$/i,
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
			if (shouldInclude(value)) numbers.push(value);
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

function calculatePercentageDeviation({ data, field_path = null, exclude_zeros = true }) {
	let itemsWithValues = [];

	// Handle driver-specific structure (shifts object)
	if (Array.isArray(data) && data.length > 0 && data[0]?.shifts) {
		itemsWithValues = data.map((driver) => {
			const shifts = driver.shifts || {};
			let totalValue = 0;

			Object.entries(shifts).forEach(([shiftType, hours]) => {
				if (isMetadataField(shiftType)) return;
				if (typeof hours === "number" && !isNaN(hours)) {
					if (!exclude_zeros || hours !== 0) {
						totalValue += hours;
					}
				}
			});

			return {
				name: driver.driverName || driver.name || `Driver ${driver.driverId}`,
				id: driver.driverId || driver.id,
				value: totalValue,
				rawData: driver,
			};
		});
	}
	// Handle generic array with field_path
	else if (Array.isArray(data)) {
		itemsWithValues = data
			.map((item, index) => {
				const value = field_path ? getNestedValue(item, field_path) : typeof item === "number" ? item : null;

				if (typeof value === "number" && !isNaN(value)) {
					if (!exclude_zeros || value !== 0) {
						return {
							name: item.name || item.driverName || item.dayName || `Item ${index + 1}`,
							id: item.id || index,
							value: value,
							rawData: item,
						};
					}
				}
				return null;
			})
			.filter(Boolean);
	}

	if (itemsWithValues.length === 0) return { error: "No valid numbers found for deviation calculation" };

	const values = itemsWithValues.map((item) => item.value);
	const average = values.reduce((sum, val) => sum + val, 0) / values.length;

	const results = itemsWithValues.map((item) => {
		const deviation = item.value - average;
		const percentageDeviation = average !== 0 ? (deviation / average) * 100 : 0;

		return {
			name: item.name,
			id: item.id,
			value: item.value,
			deviation: parseFloat(deviation.toFixed(2)),
			percentageDeviation: parseFloat(percentageDeviation.toFixed(2)),
			rawData: item.rawData,
		};
	});

	results.sort((a, b) => b.percentageDeviation - a.percentageDeviation);

	return {
		average: parseFloat(average.toFixed(2)),
		totalItems: results.length,
		results,
		summary: {
			highestDeviation: results[0]?.percentageDeviation || 0,
			highestDeviationItem: results[0]?.name || "N/A",
			lowestDeviation: results[results.length - 1]?.percentageDeviation || 0,
			lowestDeviationItem: results[results.length - 1]?.name || "N/A",
			averageDeviation: parseFloat(
				(results.reduce((sum, r) => sum + Math.abs(r.percentageDeviation), 0) / results.length).toFixed(2)
			),
		},
	};
}

function calculateMinMax({ data, field_path, exclude_zeros = false }) {
	const numbers = extractNumbers(data, field_path, exclude_zeros);
	if (numbers.length === 0) return { error: "No valid numbers found" };

	return {
		min: Math.min(...numbers),
		max: Math.max(...numbers),
		range: Math.max(...numbers) - Math.min(...numbers),
		count: numbers.length,
	};
}

// ===== INTENT DETECTION =====
async function detectCalculationIntent(userMessage, apiData) {
	try {
		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{
					role: "system",
					content: `You are a calculation intent detector. Analyze the user's message and determine if they're asking for mathematical calculations.
Response format (JSON only):
{
  "needsCalculation": true/false,
  "calculationType": "average" | "sum" | "deviation" | "percentageDeviation" | "minMax" | "none",
  "fieldPath": "field.path" or null,
  "excludeZeros": true/false
}

Calculation types:
- "average" or "mean": average/mean of values
- "sum" or "total": sum/total of values (only when explicitly asked for "total of X" or "sum of X")
- "deviation": standard deviation, variance, statistical spread
- "percentageDeviation": percentage deviation, deviation from average, how much above/below average
- "minMax": minimum, maximum, highest, lowest, range
- "none": no calculation needed`,
				},
				{
					role: "user",
					content: `User message: "${userMessage}"

Data structure sample: ${JSON.stringify(apiData?.slice?.(0, 2) || apiData, null, 2)}`,
				},
			],
			temperature: 0,
			response_format: { type: "json_object" },
		});

		const result = JSON.parse(response.choices[0].message.content);
		console.log("🎯 Calculation intent detected:", result);
		return result;
	} catch (error) {
		console.error("❌ Intent detection failed:", error.message);
		return { needsCalculation: false, calculationType: "none", fieldPath: null, excludeZeros: false };
	}
}

// ===== PRE-CALCULATION ENGINE =====

function performCalculations(data, intent) {
	const { calculationType, fieldPath, excludeZeros } = intent;

	console.log(`📊 Performing calculation: ${calculationType}`);

	try {
		switch (calculationType) {
			case "average":
			case "mean":
				return {
					type: "average",
					result: calculateAverage({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "sum":
			case "total":
				return {
					type: "sum",
					result: calculateSum({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "deviation":
				return {
					type: "standardDeviation",
					result: calculateDeviation({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "percentageDeviation":
				return {
					type: "percentageDeviation",
					result: calculatePercentageDeviation({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			case "minMax":
				return {
					type: "minMax",
					result: calculateMinMax({ data, field_path: fieldPath, exclude_zeros: excludeZeros }),
				};

			default:
				return null;
		}
	} catch (error) {
		console.error("❌ Calculation error:", error.message);
		return null;
	}
}

// ===== MAIN PROCESSING FUNCTION =====

const processIntentAndFormatResponse = async ({
	userMessage,
	api,
	exampleResponse,
	actualData,
	params = {},
	session,
	onStream,
	abortSignal,
}) => {
	let fullText = "";

	try {
		// 🔹 Check abort at start
		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted before execution");
			return { error: "Request aborted" };
		}

		// 🚀 STEP 1: Detect if calculation is needed
		const calculationIntent = await detectCalculationIntent(userMessage, actualData);

		// 🔹 Check abort after intent detection
		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted after intent detection");
			return { error: "Request aborted" };
		}

		// 🚀 STEP 2: Pre-calculate if needed
		let preCalculatedResults = null;
		if (calculationIntent.needsCalculation) {
			preCalculatedResults = performCalculations(actualData, calculationIntent);
			console.log("✅ Pre-calculation complete:", preCalculatedResults?.type);
		}

		// 🚀 STEP 3: Build the prompt (GENERIC, NOT BIASED)
		const prompt = `
You are a smart assistant processing structured API data and answering user questions.

### Context
API Name: ${api.name}
API Description: ${api.description}
User Message: "${userMessage}"
Query Parameters: ${JSON.stringify(params, null, 2)}

### Available Data
${JSON.stringify(actualData, null, 2)}

${
	preCalculatedResults
		? `
### Pre-Calculated Results
Type: ${preCalculatedResults.type}
${JSON.stringify(preCalculatedResults.result, null, 2)}

IMPORTANT: Use these pre-calculated results in your response. They are already computed and accurate.
`
		: ""
}

### Your Task
1. **Understand the user's intent** from their message
2. **Filter, transform, or aggregate** the data as needed to answer their question
3. **Use pre-calculated results** if provided - don't recalculate
4. **Apply filters strictly**: 
   - For "top N per category": show N items per group, display all categories even if empty
   - For thresholds (e.g., "at least 800 hours"): only include items meeting the exact condition
   - Never include partial matches
5. **Choose the best format** for the response:
   - **Tables**: Use for tabular data, comparisons, lists with multiple attributes
     - Always include <thead> with <th> headers and <tbody> with <tr><td> rows
     - Use meaningful column names that match the data
   - **Lists**: Use for simple enumerations or when explicitly requested
   - **Paragraphs**: Use for descriptive/narrative content
   - For specific item lookups (e.g., single driver ID), prefer list format
6. **Format dates** into readable format (e.g., "September 12, 2025")
7. **Structure your response**:
   - Start with a clear introductory <p> sentence
   - Present the data in the chosen format
   - End with a <div class="summary"> containing:
     * Exact counts (never use "several" or "some")
     * 2-3 key insights from the data
     * Use pre-calculated statistics if available

${
	api?.isSuitableForGraph
		? `
8. **After the summary**, optionally add:
   <p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>
`
		: ""
}

### Output Format
- Output ONLY valid HTML (no markdown, no JSON, no code blocks)
- Use semantic HTML tags appropriately
- End your response with exactly: ###END###

Generate the response now:
`;

		// 🚀 STEP 4: Stream the response
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
			stream: true,
		});

		for await (const chunk of completion) {
			// 🔹 Check abort during streaming
			if (abortSignal?.aborted) {
				console.log("🚫 processIntentAndFormatResponse: Aborted during streaming");
				return { error: "Request aborted" };
			}

			const delta = chunk.choices?.[0]?.delta?.content || "";
			if (!delta) continue;

			fullText += delta;

			if (fullText.includes("###END###")) break;

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

		// 🔹 Check abort before saving
		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted before session save");
			return { error: "Request aborted" };
		}

		// ✅ Save the session
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
		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted during error handling");
			return { error: "Request aborted" };
		}

		console.error("❌ processIntentAndFormatResponse error:", err.message);
		return {
			userReply: "Here's the available data. (Intent-based processing failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
