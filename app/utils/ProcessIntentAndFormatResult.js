const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");



/**
 * Uses AI to detect how many items were actually displayed in the HTML response
 * and returns only those items from the original dataset
 */
async function filterToDisplayedItems(userMessage, htmlResponse, originalData) {
    // Skip filtering for non-array data or small datasets
    if (!Array.isArray(originalData) || originalData.length <= 5) {
        return originalData;
    }

    try {
        // Count how many rows are in the HTML table or list items
        const tableRowCount = (htmlResponse.match(/<tr>/g) || []).length - 1; // -1 for header
        const listItemCount = (htmlResponse.match(/<li>/g) || []).length;
        
        const displayedCount = Math.max(tableRowCount, listItemCount);
        
        console.log(`🔍 HTML analysis: ${tableRowCount} table rows, ${listItemCount} list items`);

        // If we detected a count and it's less than the original data length
        if (displayedCount > 0 && displayedCount < originalData.length) {
            console.log(`✂️ Filtering: ${displayedCount} displayed out of ${originalData.length} total`);
            
            // Extract the names/identifiers from the HTML
            const nameFields = ['name', 'driverName', 'userName', 'title', 'label'];
            const sampleItem = originalData[0];
            const nameKey = nameFields.find(key => sampleItem[key]) || Object.keys(sampleItem)[0];
            
            // Find which items were actually displayed
            const displayedItems = originalData.filter(item => {
                const identifier = item[nameKey];
                return identifier && htmlResponse.includes(identifier);
            });
            
            if (displayedItems.length > 0) {
                console.log(`✅ Successfully filtered to ${displayedItems.length} items`);
                console.log(`   Items: ${displayedItems.map(i => i[nameKey]).join(', ')}`);
                return displayedItems;
            }
        }

        // Fallback: No filtering needed
        console.log(`ℹ️ No filtering applied - returning all ${originalData.length} items`);
        return originalData;

    } catch (error) {
        console.error("❌ Error filtering displayed items:", error.message);
        return originalData; // Return full dataset on error
    }
}

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

**Response Format (JSON only):**
{
  "needsCalculation": boolean,
  "calculationType": "average" | "sum" | "deviation" | "percentageDeviation" | "minMax" | "none",
  "fieldPath": "field.name" or null,
  "excludeZeros": boolean,
  "reasoning": "brief explanation of your choice"
}

**Calculation Types Explained:**

1. **"percentageDeviation"** - When user wants to see how items differ from the average:
   - Keywords: "deviation", "variance", "differ from average", "above/below average"
   - Common phrases: 
     * "total hours with deviation percentage"
     * "how much do drivers deviate from average"
     * "show variance from mean"
     * "percentage difference from average"
   - Use when: User wants BOTH the values AND how they compare to average

2. **"average"** - When user ONLY wants the mean value:
   - Keywords: "average", "mean" (without deviation/variance)
   - Common phrases:
     * "what is the average hours"
     * "calculate mean value"
     * "show me average"
   - Use when: User wants just the average, no comparison

3. **"sum"** - When user ONLY wants the total:
   - Keywords: "total", "sum", "add up" (without deviation/variance)
   - Common phrases:
     * "what is the total of all hours"
     * "sum of all values"
     * "add up all shifts"
   - Use when: User wants just the sum, no per-item breakdown

4. **"deviation"** - For standard deviation (statistical measure):
   - Keywords: "standard deviation", "std dev", "statistical variance"
   - Use when: User specifically asks for standard deviation

5. **"minMax"** - For finding extremes:
   - Keywords: "highest", "lowest", "maximum", "minimum", "top", "bottom"
   - Use when: User wants to find min/max values

6. **"none"** - No calculations needed:
   - User just wants to see/list/display data
   - No mathematical operations mentioned

**CRITICAL DECISION RULES:**

Rule 1: If user mentions "deviation", "variance", "differ", "compare to average" → Choose "percentageDeviation"
Rule 2: If user wants BOTH values AND comparison → Choose "percentageDeviation"
Rule 3: If user wants ONLY average (no comparison) → Choose "average"
Rule 4: If user wants ONLY total (no per-item details) → Choose "sum"
Rule 5: When in doubt between "sum" and "percentageDeviation", ask yourself: "Does the user want to see individual item comparisons?" If yes → "percentageDeviation"

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
					content: `Analyze this query and determine the calculation intent.

**User Message:** "${userMessage}"

**API Context:**
- API Name: ${apiDescription || "Unknown"}
- Data Type: ${Array.isArray(apiData) ? `Array with ${apiData.length} items` : "Object"}

**Data Sample (first 3 items):**
${JSON.stringify(dataSample, null, 2)}

**Data Structure Keys:**
${Array.isArray(apiData) && apiData.length > 0 ? Object.keys(apiData[0] || {}).join(", ") : "N/A"}

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

// ✅ Filter data to only what was displayed
console.log("📦 Original data size:", Array.isArray(actualData) ? actualData.length : "single object");
const dataToSave = await filterToDisplayedItems(userMessage, finalReply, actualData);
console.log("💾 Data to save:", Array.isArray(dataToSave) ? dataToSave.length : "single object");

// ✅ Save the session
await Session.updateOne(
    { _id: session._id },
    {
        $set: {
            lastResponseMessage: finalReply,
            lastSuccessUserMessage: userMessage,
            lastSuccessIntent: api?.name || null,
            lastSuccessApiResponse: dataToSave,  // ← Save filtered data
            lastSuccessParams: params,
            missingField: null,
        },
    }
);

console.log("✅ Response generation complete");

return {
    userReply: finalReply,
    actualData: dataToSave,  // ← Return filtered data
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