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

