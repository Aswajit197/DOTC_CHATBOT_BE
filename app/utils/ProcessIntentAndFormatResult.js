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

// ===== AI-POWERED INTENT DETECTION =====

async function detectCalculationIntent(userMessage, apiData, apiDescription) {
	try {
		const dataSample = Array.isArray(apiData) ? apiData.slice(0, 3) : apiData;

		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{
					role: "system",
					content: `You are an intelligent calculation intent analyzer. Your job is to understand what mathematical operations the user wants performed on their data.

**CRITICAL: Check API Capabilities First**
Before recommending ANY calculation, check if the API description already provides that data:
- If API says "Returns total hours" → Don't calculate sum, just display
- If API says "Returns average" → Don't calculate average, just display
- If API says "Returns breakdown by..." → Don't aggregate, just display the breakdown
- If API says "Returns list of items with values" → User is just asking to see the data

Only recommend calculation if the API does NOT already provide that specific metric.

**Response Format (JSON only):**
{
  "needsCalculation": boolean,
  "calculationType": "average" | "sum" | "deviation" | "percentageDeviation" | "minMax" | "none",
  "fieldPath": "field.name" or null,
  "excludeZeros": boolean,
  "reasoning": "brief explanation of your choice",
  "apiAlreadyProvides": "what the API already provides",
  "userJustWantsToSee": boolean
}

**Key Decision Logic:**

1. **API Already Provides This** (needsCalculation = false):
   - API description contains "total" + user asks for "total" → Display only
   - API description contains "average" + user asks for "average" → Display only
   - API description contains "breakdown" + user asks to "show breakdown" → Display only
   - API description contains "returns list" + user asks to "show list/all drivers" → Display only
   - Set calculationType: "none"
   - Set userJustWantsToSee: true

2. **User Wants Analysis Beyond API Scope** (needsCalculation = true):
   - User asks for "which driver deviates most from average" → percentageDeviation
   - User asks for "standard deviation of values" → deviation
   - User asks for "highest and lowest" → minMax
   - API provides list, but user wants statistical comparison → appropriate calculation

3. **Ambiguous Cases:**
   - If user says "give me hours" and API already returns hours → Display only
   - If user says "show all drivers" and API shows all drivers → Display only
   - If user says "total for each driver" and API returns per-driver breakdown → Display only

**Calculation Types Explained:**

1. **"percentageDeviation"** - When user wants to see how items differ from the average:
   - Keywords: "deviation", "variance", "differ from average", "above/below average"
   - Common phrases: 
     * "which driver deviates most"
     * "how much do drivers differ from average"
     * "show variance from mean"
   - Use when: User wants BOTH the values AND statistical comparison

2. **"average"** - When user ONLY wants the mean value:
   - ONLY if API does NOT already return "average" or "mean"
   - Keywords: "what is the average"
   - Use when: API provides raw data and user specifically asks for mean calculation

3. **"sum"** - When user ONLY wants the total:
   - ONLY if API does NOT already return "total"
   - Keywords: "what is the total", "add them up"
   - Use when: API provides items and user wants them summed

4. **"deviation"** - For standard deviation (statistical measure):
   - Keywords: "standard deviation", "std dev"
   - ONLY if user explicitly asks for this statistical metric

5. **"minMax"** - For finding extremes:
   - Keywords: "highest", "lowest", "maximum", "minimum"
   - Use when: User wants to identify outliers/extremes

6. **"none"** - No calculations needed:
   - API already provides what user asks for
   - User just wants to see/list/display data
   - NO mathematical operations mentioned or needed

**CRITICAL DECISION TREE:**

1. Check if API description mentions the requested metric (total, average, breakdown, etc.)
2. If YES → calculationType: "none", userJustWantsToSee: true
3. If NO → Check what calculation would add value
4. Match user intent to appropriate calculation type

**Field Path Detection:**
- If data has nested objects (like "shifts"), set fieldPath appropriately
- For simple arrays with direct values, fieldPath can be the numeric field name
- If unclear, leave as null (system will auto-detect)

**Exclude Zeros:**
- Set to true when dealing with working hours, attendance, or similar metrics where zeros are not meaningful
- Set to false for financial data or when zeros are significant`,
				},
				{
					role: "user",
					content: `Analyze this query and determine if calculation is actually needed.

**User Message:** "${userMessage}"

**API Description:**
${apiDescription || "No description provided"}

**API Context:**
- Data Type: ${Array.isArray(apiData) ? `Array with ${apiData.length} items` : "Object"}

**Data Sample (first 3 items):**
${JSON.stringify(dataSample, null, 2)}

**Data Structure Keys:**
${Array.isArray(apiData) && apiData.length > 0 ? Object.keys(apiData[0] || {}).join(", ") : "N/A"}

**Analysis Instructions:**
1. First, check the API description for what it already returns
2. Compare with what the user is asking for
3. If the user just wants to SEE what the API already provides, set needsCalculation to false
4. Only set needsCalculation to true if the user wants NEW calculations/analysis

Provide your analysis in JSON format.`,
				},
			],
			temperature: 0.1,
			response_format: { type: "json_object" },
		});

		const result = JSON.parse(response.choices[0].message.content);
		console.log("🎯 AI Intent Analysis:", {
			calculationType: result.calculationType,
			reasoning: result.reasoning,
			apiAlreadyProvides: result.apiAlreadyProvides,
			userJustWantsToSee: result.userJustWantsToSee,
			needsCalculation: result.needsCalculation,
			fieldPath: result.fieldPath,
			excludeZeros: result.excludeZeros,
		});

		return result;
	} catch (error) {
		console.error("❌ AI intent detection failed:", error.message);
		// Fallback: return safe default
		return {
			needsCalculation: false,
			calculationType: "none",
			fieldPath: null,
			excludeZeros: false,
			reasoning: "Error in detection, falling back to display mode",
			apiAlreadyProvides: "Unknown",
			userJustWantsToSee: true,
		};
	}
}

// ===== PRE-CALCULATION ENGINE =====

function performCalculations(data, intent) {
	const { calculationType, fieldPath, excludeZeros } = intent;

	console.log(`📊 Performing calculation: ${calculationType}`);
	console.log(`   Field path: ${fieldPath || "auto-detect"}`);
	console.log(`   Exclude zeros: ${excludeZeros}`);

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

		// 🚀 STEP 1: AI-powered intent detection
		console.log("🤖 Starting AI intent detection...");
		const calculationIntent = await detectCalculationIntent(userMessage, actualData, api?.description);

		// 🔹 Check abort after intent detection
		if (abortSignal?.aborted) {
			console.log("🚫 processIntentAndFormatResponse: Aborted after intent detection");
			return { error: "Request aborted" };
		}

		// 🚀 STEP 2: Pre-calculate if needed
		let preCalculatedResults = null;
		if (calculationIntent.needsCalculation && calculationIntent.calculationType !== "none") {
			console.log("📊 Pre-calculation triggered...");
			preCalculatedResults = performCalculations(actualData, calculationIntent);

			if (preCalculatedResults) {
				console.log("✅ Pre-calculation complete:", preCalculatedResults.type);
				console.log("   Result summary:", Object.keys(preCalculatedResults.result).join(", "));
			}
		} else {
			console.log("ℹ️ No calculation needed, proceeding with display-only mode");
		}

		// 🚀 STEP 3: Build the intelligent prompt
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
Calculation Type: ${preCalculatedResults.type}
${JSON.stringify(preCalculatedResults.result, null, 2)}

**CRITICAL: Pre-calculated results are provided. You MUST use them.**

${
	preCalculatedResults.type === "percentageDeviation"
		? `
**Instructions for Percentage Deviation:**
1. Create an HTML table with these EXACT columns:
   - Driver Name (or item name from results[].name)
   - Total Hours/Value (from results[].value)
   - Deviation (from results[].deviation)
   - Percentage Deviation (from results[].percentageDeviation with %)

2. Start with: "<p>The average working hours is ${preCalculatedResults.result.average} hours. Here's how each driver compares:</p>"

3. Display ALL ${preCalculatedResults.result.totalItems} items from the results array

4. In the summary, include:
   - Total drivers: ${preCalculatedResults.result.totalItems}
   - Average hours: ${preCalculatedResults.result.average}
   - Highest deviation: ${preCalculatedResults.result.summary.highestDeviationItem} at ${preCalculatedResults.result.summary.highestDeviation}%
   - Lowest deviation: ${preCalculatedResults.result.summary.lowestDeviationItem} at ${preCalculatedResults.result.summary.lowestDeviation}%

Do NOT recalculate - use these exact values.
`
		: ""
}

${
	preCalculatedResults.type === "average"
		? `
**Instructions for Average:**
Display the average (${preCalculatedResults.result.average}), count (${preCalculatedResults.result.count}), and total sum (${preCalculatedResults.result.total_sum}).
`
		: ""
}

${
	preCalculatedResults.type === "sum"
		? `
**Instructions for Sum:**
Display the total sum (${preCalculatedResults.result.sum}) and count (${preCalculatedResults.result.count}).
`
		: ""
}

${
	preCalculatedResults.type === "standardDeviation"
		? `
**Instructions for Standard Deviation:**
Display standard deviation (${preCalculatedResults.result.standard_deviation}), mean (${preCalculatedResults.result.mean}), and variance (${preCalculatedResults.result.variance}).
`
		: ""
}

${
	preCalculatedResults.type === "minMax"
		? `
**Instructions for Min/Max:**
Display minimum (${preCalculatedResults.result.min}), maximum (${preCalculatedResults.result.max}), and range (${preCalculatedResults.result.range}).
`
		: ""
}

`
		: ""
}

### Your Task
1. **Understand the user's intent** from their message
2. ${
			preCalculatedResults
				? "**Use the pre-calculated results above** - they are accurate and complete"
				: "**Process the raw data** to answer the question"
		}
3. **Apply any filters** mentioned in the user message:
   - For "top N": show exactly N items
   - For thresholds: only include items meeting criteria
   - For categories: group appropriately
4. **Choose the best format**:
   - **Tables**: For comparisons, multiple attributes, calculated results
     - Use <thead> with <th> and <tbody> with <tr><td>
     - Make headers descriptive
   - **Lists**: For simple enumerations
   - **Paragraphs**: For descriptive content
5. **Structure your response**:
   - Introductory <p> sentence
   - Main content (table/list/paragraph)
   - <div class="summary"> with:
     * Exact counts (no vague terms)
     * 2-3 key insights
     * Statistics from pre-calculated results if available
6. **Format dates** in readable format

${
	api?.isSuitableForGraph
		? `
7. **After the summary**, add:
<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>
`
		: ""
}

### Output Format
- Output ONLY valid HTML
- No markdown, JSON, or code blocks
- End with: ###END###

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

		console.log("✅ Response generation complete");

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
