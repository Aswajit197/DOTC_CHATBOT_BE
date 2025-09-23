/**
 * utils/tools.js
 * Calculation tools + tool definitions for OpenAI
 */

function calculateAverageAndDeviation({ data, field }) {
	console.log("🧮 Running calculateAverageAndDeviation...");
	if (!Array.isArray(data) || !field) return { error: "Invalid input" };

	const values = data.map((d) => Number(d[field]) || 0);
	if (!values.length) return { error: "No numeric values" };

	const avg = values.reduce((a, b) => a + b, 0) / values.length;

	const withDeviation = data.map((d) => {
		const val = Number(d[field]) || 0;
		const deviation = avg === 0 ? 0 : ((val - avg) / avg) * 100;
		return {
			...d,
			average: avg,
			deviationPercent: `${deviation.toFixed(2)}%`,
		};
	});

	console.log("✅ Avg:", avg);
	return { average: avg, results: withDeviation };
}

function filterByThreshold({ data, field, operator, value }) {
	console.log("🔍 Running filterByThreshold...");
	if (!Array.isArray(data)) return [];
	return data.filter((d) => {
		const val = Number(d[field]) || 0;
		let keep = false;
		switch (operator) {
			case ">":
				keep = val > value;
				break;
			case ">=":
				keep = val >= value;
				break;
			case "<":
				keep = val < value;
				break;
			case "<=":
				keep = val <= value;
				break;
			case "==":
				keep = val === value;
				break;
		}
		console.log(`  ${val} ${operator} ${value} → ${keep}`);
		return keep;
	});
}

function topNPerCategory({ data, categoryField, valueField, n }) {
	console.log("🏆 Running topNPerCategory...");
	if (!Array.isArray(data)) return {};
	const grouped = {};
	data.forEach((item) => {
		const cat = item[categoryField] || "Unknown";
		if (!grouped[cat]) grouped[cat] = [];
		grouped[cat].push(item);
	});

	for (const cat in grouped) {
		grouped[cat] = grouped[cat].sort((a, b) => (b[valueField] || 0) - (a[valueField] || 0)).slice(0, n);
		console.log(`  Category: ${cat}, Top ${n}:`, grouped[cat]);
	}

	return grouped;
}

/**
 * Tool schema definitions for OpenAI
 */
const toolDefinitions = [
	{
		type: "function",
		function: {
			name: "calculateAverageAndDeviation",
			description: "Calculate average and deviation for a numeric field",
			parameters: {
				type: "object",
				properties: {
					data: { type: "array", items: { type: "object" } },
					field: { type: "string" },
				},
				required: ["data", "field"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "filterByThreshold",
			description: "Filter data by numeric thresholds",
			parameters: {
				type: "object",
				properties: {
					data: { type: "array", items: { type: "object" } },
					field: { type: "string" },
					operator: { type: "string", enum: [">", ">=", "<", "<=", "=="] },
					value: { type: "number" },
				},
				required: ["data", "field", "operator", "value"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "topNPerCategory",
			description: "Return top N items per category, sorted by numeric value descending",
			parameters: {
				type: "object",
				properties: {
					data: { type: "array", items: { type: "object" } },
					categoryField: { type: "string" },
					valueField: { type: "string" },
					n: { type: "integer" },
				},
				required: ["data", "categoryField", "valueField", "n"],
			},
		},
	},
];

/**
 * Tool dispatcher (backend executes the called tool)
 */
function dispatchToolCall(name, args) {
	console.log(`🚀 Dispatching tool call: ${name}`);
	switch (name) {
		case "calculateAverageAndDeviation":
			return calculateAverageAndDeviation(args);
		case "filterByThreshold":
			return filterByThreshold(args);
		case "topNPerCategory":
			return topNPerCategory(args);
		default:
			console.error("❌ Unknown tool:", name);
			return { error: `Unknown tool: ${name}` };
	}
}

module.exports = {
	toolDefinitions,
	dispatchToolCall,
};
