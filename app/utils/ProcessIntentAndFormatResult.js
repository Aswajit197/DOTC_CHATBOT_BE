const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

// Define calculation tools
const calculationTools = [
	{
		type: "function",
		function: {
			name: "calculate_average",
			description: "Calculate the average (mean) of a numeric array",
			parameters: {
				type: "object",
				properties: {
					values: {
						type: "array",
						items: { type: "number" },
						description: "Array of numeric values to calculate average from",
					},
					fieldName: {
						type: "string",
						description: "Name of the field being averaged (for context)",
					},
				},
				required: ["values"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "calculate_statistics",
			description: "Calculate comprehensive statistics including mean, median, mode, standard deviation, min, max",
			parameters: {
				type: "object",
				properties: {
					values: {
						type: "array",
						items: { type: "number" },
						description: "Array of numeric values",
					},
					fieldName: {
						type: "string",
						description: "Name of the field being analyzed",
					},
				},
				required: ["values"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "filter_and_aggregate",
			description: "Filter data based on conditions and perform aggregations",
			parameters: {
				type: "object",
				properties: {
					data: {
						type: "array",
						items: {
							type: "object",
						},
						description: "Array of data objects to filter and aggregate",
					},
					filterField: {
						type: "string",
						description: "Field to filter on",
					},
					filterOperator: {
						type: "string",
						enum: [">=", "<=", ">", "<", "=", "!="],
						description: "Comparison operator",
					},
					filterValue: {
						type: "number",
						description: "Value to compare against",
					},
					aggregateField: {
						type: "string",
						description: "Field to aggregate",
					},
					aggregateOperation: {
						type: "string",
						enum: ["sum", "average", "count", "min", "max"],
						description: "Type of aggregation to perform",
					},
				},
				required: ["data", "aggregateField", "aggregateOperation"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "group_and_calculate",
			description: "Group data by a field and calculate statistics for each group",
			parameters: {
				type: "object",
				properties: {
					data: {
						type: "array",
						items: {
							type: "object",
						},
						description: "Array of data objects",
					},
					groupByField: {
						type: "string",
						description: "Field to group by",
					},
					calculateField: {
						type: "string",
						description: "Field to calculate statistics on",
					},
					operation: {
						type: "string",
						enum: ["sum", "average", "count", "min", "max", "statistics"],
						description: "Type of calculation to perform",
					},
				},
				required: ["data", "groupByField", "calculateField", "operation"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "find_top_n",
			description: "Find top N items based on a numeric field, optionally grouped by category",
			parameters: {
				type: "object",
				properties: {
					data: {
						type: "array",
						items: {
							type: "object",
						},
						description: "Array of data objects",
					},
					sortField: {
						type: "string",
						description: "Field to sort by",
					},
					n: {
						type: "number",
						description: "Number of top items to return",
					},
					groupByField: {
						type: "string",
						description: "Optional field to group by before finding top N in each group",
					},
					ascending: {
						type: "boolean",
						default: false,
						description: "Sort in ascending order (default: descending for top items)",
					},
				},
				required: ["data", "sortField", "n"],
			},
		},
	},
];

// Tool execution functions
const executeCalculationTool = (toolCall, toolArgs) => {
	const { name } = toolCall.function;
	console.log(`🔧 Executing tool: ${name}`);
	console.log(`📋 Tool args:`, JSON.stringify(toolArgs, null, 2));

	switch (name) {
		case "calculate_average":
			console.log("📊 Calculating average...");
			const avg = toolArgs.values.reduce((sum, val) => sum + val, 0) / toolArgs.values.length;
			const avgResult = {
				average: parseFloat(avg.toFixed(2)),
				count: toolArgs.values.length,
				fieldName: toolArgs.fieldName,
			};
			console.log("✅ Average calculation result:", avgResult);
			return avgResult;

		case "calculate_statistics":
			console.log("📊 Calculating comprehensive statistics...");
			const values = [...toolArgs.values].sort((a, b) => a - b);
			const sum = values.reduce((s, v) => s + v, 0);
			const mean = sum / values.length;
			const median =
				values.length % 2 === 0
					? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
					: values[Math.floor(values.length / 2)];

			// Calculate standard deviation
			const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
			const stdDev = Math.sqrt(variance);

			// Find mode
			const frequency = {};
			values.forEach((val) => (frequency[val] = (frequency[val] || 0) + 1));
			const mode = Object.keys(frequency).reduce((a, b) => (frequency[a] > frequency[b] ? a : b));

			const statsResult = {
				count: values.length,
				sum: parseFloat(sum.toFixed(2)),
				mean: parseFloat(mean.toFixed(2)),
				median: parseFloat(median.toFixed(2)),
				mode: parseFloat(mode),
				min: values[0],
				max: values[values.length - 1],
				standardDeviation: parseFloat(stdDev.toFixed(2)),
				variance: parseFloat(variance.toFixed(2)),
				fieldName: toolArgs.fieldName,
			};
			console.log("✅ Statistics calculation result:", statsResult);
			return statsResult;

		case "filter_and_aggregate":
			console.log("🔍 Filtering and aggregating data...");
			let filteredData = toolArgs.data;

			// Apply filter if specified
			if (toolArgs.filterField && toolArgs.filterOperator && toolArgs.filterValue !== undefined) {
				console.log(`🔍 Applying filter: ${toolArgs.filterField} ${toolArgs.filterOperator} ${toolArgs.filterValue}`);
				filteredData = toolArgs.data.filter((item) => {
					const fieldValue = item[toolArgs.filterField];
					switch (toolArgs.filterOperator) {
						case ">=":
							return fieldValue >= toolArgs.filterValue;
						case "<=":
							return fieldValue <= toolArgs.filterValue;
						case ">":
							return fieldValue > toolArgs.filterValue;
						case "<":
							return fieldValue < toolArgs.filterValue;
						case "=":
							return fieldValue === toolArgs.filterValue;
						case "!=":
							return fieldValue !== toolArgs.filterValue;
						default:
							return true;
					}
				});
				console.log(`🔍 Filtered data count: ${filteredData.length}/${toolArgs.data.length}`);
			}

			// Perform aggregation
			const aggregateValues = filteredData
				.map((item) => item[toolArgs.aggregateField])
				.filter((val) => val !== undefined && val !== null);
			console.log(`📊 Aggregating ${aggregateValues.length} values for field: ${toolArgs.aggregateField}`);

			let result = { filteredCount: filteredData.length, totalCount: toolArgs.data.length };

			switch (toolArgs.aggregateOperation) {
				case "sum":
					result.sum = aggregateValues.reduce((sum, val) => sum + val, 0);
					break;
				case "average":
					result.average =
						aggregateValues.length > 0
							? parseFloat((aggregateValues.reduce((sum, val) => sum + val, 0) / aggregateValues.length).toFixed(2))
							: 0;
					break;
				case "count":
					result.count = aggregateValues.length;
					break;
				case "min":
					result.min = aggregateValues.length > 0 ? Math.min(...aggregateValues) : null;
					break;
				case "max":
					result.max = aggregateValues.length > 0 ? Math.max(...aggregateValues) : null;
					break;
			}

			console.log("✅ Filter and aggregate result:", result);
			return result;

		case "group_and_calculate":
			console.log("👥 Grouping and calculating data...");
			const groups = {};

			// Group data
			toolArgs.data.forEach((item) => {
				const groupKey = item[toolArgs.groupByField];
				if (!groups[groupKey]) groups[groupKey] = [];
				groups[groupKey].push(item);
			});

			console.log(`👥 Created ${Object.keys(groups).length} groups`);

			// Calculate for each group
			const results = {};
			Object.keys(groups).forEach((groupKey) => {
				console.log(`📊 Processing group: ${groupKey} (${groups[groupKey].length} items)`);
				const groupData = groups[groupKey];
				const values = groupData.map((item) => item[toolArgs.calculateField]).filter((val) => val !== undefined && val !== null);

				if (values.length === 0) {
					results[groupKey] = { count: 0, value: null };
					return;
				}

				switch (toolArgs.operation) {
					case "sum":
						results[groupKey] = { count: values.length, sum: values.reduce((sum, val) => sum + val, 0) };
						break;
					case "average":
						results[groupKey] = {
							count: values.length,
							average: parseFloat((values.reduce((sum, val) => sum + val, 0) / values.length).toFixed(2)),
						};
						break;
					case "count":
						results[groupKey] = { count: values.length };
						break;
					case "min":
						results[groupKey] = { count: values.length, min: Math.min(...values) };
						break;
					case "max":
						results[groupKey] = { count: values.length, max: Math.max(...values) };
						break;
					case "statistics":
						const sortedValues = [...values].sort((a, b) => a - b);
						const groupSum = values.reduce((s, v) => s + v, 0);
						const groupMean = groupSum / values.length;
						const groupMedian =
							sortedValues.length % 2 === 0
								? (sortedValues[sortedValues.length / 2 - 1] + sortedValues[sortedValues.length / 2]) / 2
								: sortedValues[Math.floor(sortedValues.length / 2)];

						results[groupKey] = {
							count: values.length,
							sum: parseFloat(groupSum.toFixed(2)),
							average: parseFloat(groupMean.toFixed(2)),
							median: parseFloat(groupMedian.toFixed(2)),
							min: sortedValues[0],
							max: sortedValues[sortedValues.length - 1],
						};
						break;
				}
			});

			console.log("✅ Group and calculate result:", results);
			return results;

		case "find_top_n":
			console.log(`🔝 Finding top ${toolArgs.n} items...`);
			let processedData = [...toolArgs.data];

			if (toolArgs.groupByField) {
				console.log(`👥 Grouping by field: ${toolArgs.groupByField}`);
				// Group and find top N in each group
				const groups = {};
				processedData.forEach((item) => {
					const groupKey = item[toolArgs.groupByField];
					if (!groups[groupKey]) groups[groupKey] = [];
					groups[groupKey].push(item);
				});

				console.log(`👥 Created ${Object.keys(groups).length} groups`);

				const results = {};
				Object.keys(groups).forEach((groupKey) => {
					console.log(`🔝 Finding top ${toolArgs.n} in group: ${groupKey}`);
					const sortedGroup = groups[groupKey].sort((a, b) => {
						const aVal = a[toolArgs.sortField];
						const bVal = b[toolArgs.sortField];
						return toolArgs.ascending ? aVal - bVal : bVal - aVal;
					});
					results[groupKey] = sortedGroup.slice(0, toolArgs.n);
				});

				console.log(
					"✅ Top N by group result:",
					Object.keys(results).map((k) => `${k}: ${results[k].length} items`)
				);
				return results;
			} else {
				console.log(`🔝 Finding top ${toolArgs.n} overall`);
				// Find top N overall
				const sorted = processedData.sort((a, b) => {
					const aVal = a[toolArgs.sortField];
					const bVal = b[toolArgs.sortField];
					return toolArgs.ascending ? aVal - bVal : bVal - aVal;
				});

				const result = sorted.slice(0, toolArgs.n);
				console.log(`✅ Top N overall result: ${result.length} items`);
				return result;
			}

		default:
			console.error(`❌ Unknown tool function: ${name}`);
			return { error: "Unknown tool function" };
	}
};

/**
 * Streams GPT's partial plain text response until "###END###",
 * and returns the full HTML reply at the end.
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
	console.log("🔄 Starting processIntentAndFormatResponse");
	console.log("📝 User message:", userMessage);
	console.log("🔧 API:", api?.name);
	console.log("📊 Data length:", Array.isArray(actualData) ? actualData.length : typeof actualData);

	try {
		const prompt = `
You're a smart assistant designed to process structured API data intelligently and answer the user's message.

Your tasks:
1. Understand the user's intent from their message.
2. Use the available calculation tools when the user asks for mathematical operations like:
   - Averages, means, medians
   - Standard deviations, statistics
   - Top N items per category
   - Filtering with numeric conditions
   - Grouping and aggregating data
3. Filter, transform, or aggregate the provided API data as needed to directly answer the user's request.
4. If the user asks for "top N items per category", use the find_top_n tool with groupByField.
5. If the user provides numeric thresholds, use the filter_and_aggregate tool.
6. For statistical analysis, use the calculate_statistics tool.
7. Always display results in a user-friendly format.
8. Properly format any date strings into user-friendly readable formats.

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
Use calculation tools when appropriate, then format the response as HTML:

- Use tools for any mathematical calculations rather than doing them manually
- Format results as HTML tables, lists, or paragraphs as appropriate
- Always start with a <p> introduction sentence
- Include a <div class="summary"> block with exact counts and insights
- Format dates into readable forms
- Use valid HTML only (no Markdown or JSON)

${
	api?.isSuitableForGraph
		? `<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>`
		: ``
}

After the HTML reply, output exactly:
###END###
`;

		const messages = [{ role: "user", content: prompt }];

		console.log("🤖 Creating OpenAI completion with tools");
		console.log("🛠️ Number of tools available:", calculationTools.length);

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages,
			temperature: 0,
			stream: true,
			tools: calculationTools,
		});

		console.log("✅ OpenAI completion created, starting to process chunks");

		let toolCalls = [];
		let currentToolCall = null;
		let chunkCount = 0;

		console.log("🔄 Starting to process streaming chunks...");

		for await (const chunk of completion) {
			chunkCount++;
			if (chunkCount % 10 === 0) {
				console.log(`📦 Processed ${chunkCount} chunks so far`);
			}

			const choice = chunk.choices?.[0];
			if (!choice) {
				console.log("⚠️ No choice in chunk, continuing...");
				continue;
			}

			// Handle tool calls
			if (choice.delta?.tool_calls) {
				console.log("🛠️ Tool calls detected in chunk");
				console.log("🔧 Tool calls delta:", JSON.stringify(choice.delta.tool_calls, null, 2));

				for (const toolCallDelta of choice.delta.tool_calls) {
					if (toolCallDelta.index !== undefined) {
						// Initialize or update tool call
						if (!toolCalls[toolCallDelta.index]) {
							toolCalls[toolCallDelta.index] = {
								id: toolCallDelta.id || "",
								type: "function",
								function: { name: "", arguments: "" },
							};
							console.log(`🆕 Initialized new tool call at index ${toolCallDelta.index}`);
						}

						const toolCall = toolCalls[toolCallDelta.index];

						if (toolCallDelta.function?.name) {
							toolCall.function.name += toolCallDelta.function.name;
							console.log(`📝 Updated tool name: ${toolCall.function.name}`);
						}
						if (toolCallDelta.function?.arguments) {
							toolCall.function.arguments += toolCallDelta.function.arguments;
							console.log(`📝 Updated tool arguments length: ${toolCall.function.arguments.length}`);
						}
						if (toolCallDelta.id) {
							toolCall.id += toolCallDelta.id;
						}
					}
				}
			}

			// Handle regular content
			const delta = choice.delta?.content || "";
			if (delta) {
				console.log(`📝 Content delta received: "${delta.substring(0, 50)}${delta.length > 50 ? "..." : ""}"`);
				fullText += delta;

				// Stop when END marker appears
				if (fullText.includes("###END###")) {
					console.log("🏁 END marker detected, stopping stream");
					break;
				}

				const cleaned = delta.replace(/###\s*END\s*###/gi, "");
				if (cleaned) {
					const formatted = cleaned
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.replace(/(\d)([A-Za-z])/g, "$1 $2")
						.replace(/([a-zA-Z])(\d)/g, "$1 $2");
					if (onStream) onStream(formatted);
				}
			}

			// Check if we need to execute tools
			if (choice.finish_reason === "tool_calls" && toolCalls.length > 0) {
				console.log("🛠️ Tool calls finished, executing tools");
				console.log("📋 Tool calls to execute:", toolCalls.length);
				console.log("🔧 Tool calls details:", JSON.stringify(toolCalls, null, 2));

				// Execute all tool calls
				const toolResults = [];

				for (let i = 0; i < toolCalls.length; i++) {
					const toolCall = toolCalls[i];
					console.log(`🔧 Executing tool ${i + 1}/${toolCalls.length}: ${toolCall.function.name}`);

					try {
						console.log(`📋 Tool arguments: ${toolCall.function.arguments}`);
						const toolArgs = JSON.parse(toolCall.function.arguments);
						console.log(`✅ Parsed tool arguments successfully`);

						const result = executeCalculationTool(toolCall, toolArgs);
						console.log(`✅ Tool execution result:`, JSON.stringify(result, null, 2));

						toolResults.push({
							tool_call_id: toolCall.id,
							role: "tool",
							content: JSON.stringify(result),
						});
					} catch (error) {
						console.error(`❌ Tool execution error for ${toolCall.function.name}:`, error);
						toolResults.push({
							tool_call_id: toolCall.id,
							role: "tool",
							content: JSON.stringify({ error: "Tool execution failed: " + error.message }),
						});
					}
				}

				console.log("📤 Adding tool results to conversation");
				// Add tool results to conversation and continue
				messages.push({
					role: "assistant",
					tool_calls: toolCalls,
				});
				messages.push(...toolResults);

				console.log("🔄 Starting followup completion with tool results");
				// Continue the conversation with tool results
				const followupCompletion = await openai.chat.completions.create({
					model: "gpt-4o-mini",
					messages,
					temperature: 0,
					stream: true,
				});

				console.log("✅ Followup completion created, processing chunks...");
				let followupChunkCount = 0;

				for await (const followupChunk of followupCompletion) {
					followupChunkCount++;
					if (followupChunkCount % 10 === 0) {
						console.log(`📦 Processed ${followupChunkCount} followup chunks`);
					}

					const followupDelta = followupChunk.choices?.[0]?.delta?.content || "";
					if (!followupDelta) continue;

					console.log(`📝 Followup content: "${followupDelta.substring(0, 50)}${followupDelta.length > 50 ? "..." : ""}"`);
					fullText += followupDelta;

					if (fullText.includes("###END###")) {
						console.log("🏁 END marker detected in followup, stopping");
						break;
					}

					const cleaned = followupDelta.replace(/###\s*END\s*###/gi, "");
					if (cleaned) {
						const formatted = cleaned
							.replace(/([a-z])([A-Z])/g, "$1 $2")
							.replace(/(\d)([A-Za-z])/g, "$1 $2")
							.replace(/([a-zA-Z])(\d)/g, "$1 $2");
						if (onStream) onStream(formatted);
					}
				}
				console.log("✅ Followup completion finished");
				break;
			}
		}

		console.log("📊 Stream processing completed");
		console.log(`📝 Total chunks processed: ${chunkCount}`);
		console.log(`📏 Full text length: ${fullText.length}`);
		console.log(`🛠️ Tool calls executed: ${toolCalls.length}`);

		const finalReply = fullText.replace(/###END###/g, "").trim();
		console.log("✨ Final reply prepared, saving to session");

		// Save the last reply in session
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

		console.log("✅ Session updated successfully");
		console.log("🎯 Returning response");

		return {
			userReply: finalReply,
			params,
			api,
		};
	} catch (err) {
		console.error("❌ processIntentAndFormatResponse error:", err.message);
		console.error("❌ Error stack:", err.stack);
		return {
			userReply: "Here's the available data. (Intent-based personalization failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
