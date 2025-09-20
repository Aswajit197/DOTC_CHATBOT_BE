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

// Define arithmetic tools for OpenAI function calling
const arithmeticTools = [
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
];

/**
 * Enhanced processIntentAndFormatResponse with arithmetic operations support
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
	console.log("🚀 Starting processIntentAndFormatResponse");
	console.log("📝 User message:", userMessage);
	console.log("📊 Data sample:", JSON.stringify(actualData).substring(0, 200) + "...");
	console.log("🔧 onStream function exists:", typeof onStream === "function");

	try {
		// Enhanced prompt that includes arithmetic capabilities
		console.log("📝 Building prompt...");
		const prompt = `
You're a smart assistant designed to process structured API data intelligently and answer the user's message with advanced arithmetic capabilities.

Your tasks:
1. Understand the user's intent from their message.
2. If the user asks for calculations (average, sum, standard deviation, percentage deviation, etc.), use the provided function tools to perform accurate calculations on the data.
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

ARITHMETIC OPERATION GUIDELINES:
- For queries involving "average", "mean": Use calculate_average function
- For queries involving "sum", "total": Use calculate_sum function  
- For queries involving "standard deviation", "variance": Use calculate_deviation function
- For queries involving "percentage deviation", "performance comparison": Use calculate_percentage_deviation function
- For extracting numeric data: Use get_all_numbers function
- Always exclude zeros for shift/working hours data (exclude_zeros=true)
- Present calculation results in clear, well-formatted HTML tables

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
- For arithmetic calculations, present results in well-formatted tables with clear headers and proper numerical formatting.
- Always include a <div class="summary"> block summarizing:
    - Exact total counts per category or in total.
    - 1-2 additional meaningful computed insights (e.g., highest working hours and by whom).
    - For calculations, include key statistical insights (min, max, range, etc.)
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

		// Create messages array for function calling
		console.log("🤖 Creating OpenAI messages array");
		let messages = [
			{
				role: "system",
				content: "You are a statistical analysis assistant specialized in working hours data with function calling capabilities.",
			},
			{ role: "user", content: prompt },
		];

		let finalMessage = null;
		console.log("🔄 Starting function calling loop...");

		// Function calling loop
		while (true) {
			console.log("🔄 Making OpenAI API call with tools...");
			const completion = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages,
				tools: arithmeticTools,
				tool_choice: "auto",
				temperature: 0,
				stream: false, // Disable streaming for function calls
			});

			console.log("✅ Received OpenAI response");
			const message = completion.choices[0].message;
			messages.push(message);

			console.log("🔍 Checking for function calls:", message.tool_calls ? message.tool_calls.length : 0);

			if (!message.tool_calls || message.tool_calls.length === 0) {
				console.log("✅ No more function calls needed, final message received");
				finalMessage = message;
				break;
			}

			// Handle function calls
			console.log("⚡ Processing function calls...");
			for (const toolCall of message.tool_calls) {
				console.log(`🛠️ Executing function: ${toolCall.function.name}`);
				let result;
				const args = JSON.parse(toolCall.function.arguments);
				console.log("📝 Function args:", JSON.stringify(args, null, 2));

				switch (toolCall.function.name) {
					case "calculate_average":
						console.log("📊 Calculating average...");
						result = calculateAverage({
							data: args.data,
							field_path: args.field_path,
							exclude_zeros: args.exclude_zeros,
						});
						console.log("📊 Average result:", result);
						break;
					case "calculate_sum":
						console.log("➕ Calculating sum...");
						result = calculateSum({
							data: args.data,
							field_path: args.field_path,
							exclude_zeros: args.exclude_zeros,
						});
						console.log("➕ Sum result:", result);
						break;
					case "calculate_deviation":
						console.log("📈 Calculating deviation...");
						result = calculateDeviation({
							data: args.data,
							field_path: args.field_path,
							population: args.population !== undefined ? args.population : false,
							exclude_zeros: args.exclude_zeros,
						});
						console.log("📈 Deviation result:", result);
						break;
					case "calculate_percentage_deviation":
						console.log("📊 Calculating percentage deviation...");
						result = calculatePercentageDeviation({
							data: args.data,
							exclude_zeros: args.exclude_zeros !== undefined ? args.exclude_zeros : true,
						});
						console.log("📊 Percentage deviation result:", result);
						break;
					case "get_all_numbers":
						console.log("🔢 Getting all numbers...");
						result = getAllNumbersFromData(args);
						console.log("🔢 Numbers result:", result);
						break;
					default:
						console.log(`❌ Unknown function: ${toolCall.function.name}`);
						result = { error: `Unknown function: ${toolCall.function.name}` };
				}

				console.log(`🔄 Adding function result to messages for ${toolCall.function.name}`);
				messages.push({
					role: "tool",
					tool_call_id: toolCall.id,
					content: JSON.stringify(result),
				});
			}
		}

		// Get the final response and stream it
		console.log("📤 Starting response streaming...");
		const finalContent = finalMessage.content;
		console.log("📝 Final content length:", finalContent.length);
		console.log("📝 Final content preview:", finalContent.substring(0, 200) + "...");

		// Check if we need to use streaming or regular OpenAI call
		const needsStreaming = !finalContent || finalContent.includes("###END###");
		console.log("🌊 Needs streaming?", needsStreaming);

		if (needsStreaming || !finalContent) {
			console.log("🌊 Using OpenAI streaming completion...");
			const streamingCompletion = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages,
				temperature: 0,
				stream: true,
			});

			for await (const chunk of streamingCompletion) {
				const delta = chunk.choices?.[0]?.delta?.content || "";
				if (!delta) continue;

				fullText += delta;
				console.log("🌊 Streaming chunk:", delta.length, "chars");

				// Stop when END marker appears
				if (fullText.includes("###END###")) {
					console.log("🛑 Found END marker, stopping stream");
					break;
				}

				const cleaned = delta.replace(/###\s*END\s*###/gi, "");
				if (cleaned) {
					const formatted = cleaned
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.replace(/(\d)([A-Za-z])/g, "$1 $2")
						.replace(/([a-zA-Z])(\d)/g, "$1 $2");

					console.log("🌊 Streaming formatted:", formatted.length, "chars");
					if (onStream) {
						console.log("📤 Calling onStream callback");
						onStream(formatted);
					} else {
						console.log("❌ onStream callback not available");
					}
				}
			}
		} else {
			// Stream the existing final content character by character
			console.log("📤 Character-by-character streaming...");
			for (let i = 0; i < finalContent.length; i++) {
				const char = finalContent[i];
				fullText += char;

				// Stop when END marker appears
				if (fullText.includes("###END###")) {
					console.log("🛑 Found END marker at position", i);
					break;
				}

				if (onStream && char !== "#") {
					// Avoid streaming the END marker
					const formatted = char
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.replace(/(\d)([A-Za-z])/g, "$1 $2")
						.replace(/([a-zA-Z])(\d)/g, "$1 $2");

					console.log("📤 Streaming char:", char, "->", formatted);
					onStream(formatted);
				}

				// Add small delay to simulate streaming
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();
		console.log("✅ Final reply length:", finalReply.length);
		console.log("📝 Final reply preview:", finalReply.substring(0, 200) + "...");

		// Save the last reply in session
		console.log("💾 Saving to session...");
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
		console.log("✅ Session saved successfully");

		return {
			userReply: finalReply,
			params,
			api,
		};
	} catch (err) {
		console.error("❌ processIntentAndFormatResponse error:", err);
		console.error("❌ Error stack:", err.stack);
		console.log("❌ Error details:", {
			message: err.message,
			name: err.name,
			userMessage,
			apiName: api?.name,
		});
		return {
			userReply: "Here's the available data. (Intent-based personalization failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
