const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

// Calculation Tool Functions
const calculationTools = {
	calculateSum: function(fieldName, values) {
		const total = values.reduce((sum, val) => sum + val, 0);
		return {
			operation: "sum",
			field: fieldName,
			total: total,
			count: values.length
		};
	},
	
	calculateAverage: function(fieldName, values) {
		if (values.length === 0) {
			return {
				operation: "average",
				field: fieldName,
				average: 0,
				count: 0,
				min: null,
				max: null
			};
		}
		const sum = values.reduce((acc, val) => acc + val, 0);
		const average = Math.round((sum / values.length) * 100) / 100;
		return {
			operation: "average",
			field: fieldName,
			average: average,
			count: values.length,
			min: Math.min(...values),
			max: Math.max(...values)
		};
	},
	
	calculateMinMax: function(fieldName, values) {
		if (values.length === 0) {
			return {
				operation: "min_max",
				field: fieldName,
				min: null,
				max: null,
				count: 0
			};
		}
		return {
			operation: "min_max",
			field: fieldName,
			min: Math.min(...values),
			max: Math.max(...values),
			count: values.length
		};
	},
	
	calculateDeviation: function(fieldName, values) {
		if (values.length === 0) {
			return {
				operation: "standard_deviation",
				field: fieldName,
				average: 0,
				standardDeviation: 0,
				count: 0
			};
		}
		const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
		const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
		return {
			operation: "standard_deviation",
			field: fieldName,
			average: Math.round(avg * 100) / 100,
			standardDeviation: Math.round(Math.sqrt(variance) * 100) / 100,
			count: values.length
		};
	}
};

// OpenAI Tools Schema Definitions (Updated to new format)
const openAITools = [
	{
		type: "function",
		function: {
			name: "calculateSum",
			description: "Calculate the sum of numeric values",
			parameters: {
				type: "object",
				properties: {
					fieldName: { type: "string", description: "Name of the field being summed" },
					values: { type: "array", items: { type: "number" }, description: "Array of numbers to sum" }
				},
				required: ["fieldName", "values"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "calculateAverage",
			description: "Calculate average, min, and max of numeric values",
			parameters: {
				type: "object",
				properties: {
					fieldName: { type: "string", description: "Name of the field being analyzed" },
					values: { type: "array", items: { type: "number" }, description: "Array of numbers to analyze" }
				},
				required: ["fieldName", "values"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "calculateMinMax",
			description: "Find minimum and maximum values",
			parameters: {
				type: "object",
				properties: {
					fieldName: { type: "string", description: "Name of the field being analyzed" },
					values: { type: "array", items: { type: "number" }, description: "Array of numbers to analyze" }
				},
				required: ["fieldName", "values"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "calculateDeviation",
			description: "Calculate standard deviation for statistical analysis",
			parameters: {
				type: "object",
				properties: {
					fieldName: { type: "string", description: "Name of the field being analyzed" },
					values: { type: "array", items: { type: "number" }, description: "Array of numbers to analyze" }
				},
				required: ["fieldName", "values"]
			}
		}
	}
];

/**
 * Builds conversation history from session
 */
const buildConversationHistory = (session) => {
	const history = [];
	
	// Add previous successful interaction if exists
	if (session.lastSuccessUserMessage && session.lastResponseMessage) {
		history.push({
			role: "user",
			content: session.lastSuccessUserMessage
		});
		history.push({
			role: "assistant",
			content: `Previous response: ${session.lastResponseMessage.substring(0, 500)}...` // Truncate for context
		});
	}
	
	return history;
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
	let hasEnded = false;
	
	try {
		// Build conversation history
		const conversationHistory = buildConversationHistory(session);
		
		// Truncate actualData if it's too large to prevent token limit issues
		let processedData = actualData;
		const dataString = JSON.stringify(actualData);
		if (dataString.length > 50000) { // Limit to ~50KB
			console.log("Truncating large data response");
			if (Array.isArray(actualData)) {
				processedData = actualData.slice(0, Math.min(100, actualData.length));
			} else {
				processedData = JSON.parse(dataString.substring(0, 50000) + "}");
			}
		}

		const systemPrompt = `
You're a smart assistant designed to process structured API data intelligently and answer the user's message.
You have access to calculation functions that you can use to perform mathematical operations on the data.

Your tasks:
1. Understand the user's intent from their message and conversation history.
2. Filter, transform, or aggregate the provided API data as needed to directly answer the user's request.
3. Use the calculation functions (calculateSum, calculateAverage, calculateMinMax, calculateDeviation) when mathematical analysis is needed.
4. If the user asks for "top N items per category" (e.g., "top 10 drivers per shift type"), do the following:
   - Treat each category in the data (like "Parcel Van", "Step Van", etc.) as a separate group.
   - For each category, select up to N items sorted by the highest relevant metric (e.g., total shift hours).
   - Always display each category, even if no matching items are found. In that case, display a table with a row stating "No drivers found" or similar message.
   - Display each category in its own HTML table, starting with a clear introductory sentence.
5. If the user provides numeric thresholds (e.g., "at least 800 hours", "more than 50 deliveries"), strictly filter the data so that only items satisfying those thresholds remain.
6. Never include items that partially match the condition.
7. If no explicit top-N or filter is present, display all data in the most meaningful way (table, list, or paragraph).
8. Check the response if its more likely a table format or list format or paragraph always try to give better format as per response.
9. Properly format any date strings into user-friendly readable formats.
10. Consider conversation history to provide contextual responses.
11. IMPORTANT: Keep your response concise and focused. Avoid very long responses that might cause streaming issues.

---

### API Info
Name: ${api.name}
Description: ${api.description}

### Current User Message
"${userMessage}"

### Query Parameters
${JSON.stringify(params, null, 2)}

### Example Response Format
${JSON.stringify(exampleResponse, null, 2)}

### Raw API Data (${Array.isArray(processedData) ? processedData.length + ' items' : 'object'})
${JSON.stringify(processedData, null, 2)}

---

### Output Instructions
Decide the HTML output format dynamically based on intent and API description:

- If the **user message** explicitly asks for "table", "tabular" or if the **API description** indicates tabular data, then format the reply as an HTML <table> with <thead>, <tbody>, <tr>, <th>, <td>.
- If the data is best represented as a **list**, use <ul><li>...</li></ul>.
- If userMessage intent is for specific one driver id or LMDP ID try to send in list format.
- Try to provide complete list/table always if user message don't contains any filter action.
- If the data contains date string send in proper user readable format.
- Always start with a <p> introduction sentence before table or list.
- For top-N per category requests, provide multiple separate HTML <table> sections—one for each category (e.g., shift type).
   - If a category has no matching items, include a single-row table with the message "No drivers found for this shift type."
- Always include a <div class="summary"> block summarizing:
    - Exact total counts per category or in total.
    - 1-2 additional meaningful computed insights (e.g., highest working hours and by whom).
    - Use calculation results when presenting statistical data.
    - Do not use vague terms like "several" or "some".
- Format dates into readable forms (e.g., "September 12, 2025").
- IMPORTANT: Keep your response under 5000 characters to avoid streaming issues.

${
	api?.isSuitableForGraph
		? `<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>`
		: ``
}

- Do not include Markdown, JSON, or plain text—only valid HTML.
- After the HTML reply, summary, and optional follow-up message, output exactly:
###END###
`;

		// Build messages array with history
		const messages = [
			{ role: "system", content: systemPrompt },
			...conversationHistory,
			{ role: "user", content: userMessage }
		];

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: messages,
			temperature: 0,
			tools: openAITools,
			tool_choice: "auto",
			stream: true,
			max_tokens: 4000, // Limit response size
		});

		let toolCalls = [];
		let streamBuffer = "";

		for await (const chunk of completion) {
			// Check if stream was aborted
			if (hasEnded) {
				console.log("Stream already ended, breaking...");
				break;
			}

			const delta = chunk.choices?.[0]?.delta;
			
			// Handle tool calls (new format)
			if (delta?.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					const index = toolCall.index;
					
					// Initialize tool call if new
					if (!toolCalls[index]) {
						toolCalls[index] = {
							id: toolCall.id || "",
							type: toolCall.type || "function",
							function: {
								name: toolCall.function?.name || "",
								arguments: toolCall.function?.arguments || ""
							}
						};
					} else {
						// Accumulate function arguments
						if (toolCall.function?.arguments) {
							toolCalls[index].function.arguments += toolCall.function.arguments;
						}
						if (toolCall.function?.name) {
							toolCalls[index].function.name = toolCall.function.name;
						}
						if (toolCall.id) {
							toolCalls[index].id = toolCall.id;
						}
					}
				}
				continue; // Skip content processing for tool calls
			}
			
			// Handle regular content
			const content = delta?.content || "";
			if (!content) continue;

			fullText += content;
			streamBuffer += content;

			// Check for end marker
			if (fullText.includes("###END###")) {
				hasEnded = true;
				// Remove the end marker and any content after it
				const endIndex = fullText.indexOf("###END###");
				fullText = fullText.substring(0, endIndex);
				break;
			}

			// Stream content in chunks to avoid overwhelming the client
			if (streamBuffer.length > 100) {
				const cleaned = streamBuffer.replace(/###\s*END\s*###/gi, "");
				if (cleaned && onStream) {
					const formatted = cleaned
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.replace(/(\d)([A-Za-z])/g, "$1 $2")
						.replace(/([a-zA-Z])(\d)/g, "$1 $2");

					onStream(formatted);
				}
				streamBuffer = "";
			}
		}

		// Stream any remaining buffer
		if (streamBuffer && onStream) {
			const cleaned = streamBuffer.replace(/###\s*END\s*###/gi, "");
			if (cleaned) {
				const formatted = cleaned
					.replace(/([a-z])([A-Z])/g, "$1 $2")
					.replace(/(\d)([A-Za-z])/g, "$1 $2")
					.replace(/([a-zA-Z])(\d)/g, "$1 $2");

				onStream(formatted);
			}
		}

		// Execute tool calls if any
		let functionResults = [];
		for (const toolCall of toolCalls) {
			if (!toolCall || !toolCall.function) continue;
			
			try {
				// Validate and parse arguments
				let args;
				const argsString = toolCall.function.arguments.trim();
				
				if (!argsString) {
					console.warn(`Empty arguments for tool call ${toolCall.function.name}`);
					continue;
				}

				// Try to fix common JSON issues before parsing
				let cleanedArgs = argsString
					.replace(/,\s*}/g, '}')     // Remove trailing commas
					.replace(/,\s*]/g, ']')     // Remove trailing commas in arrays
					.replace(/\n/g, '')         // Remove newlines
					.replace(/\t/g, '');        // Remove tabs

				try {
					args = JSON.parse(cleanedArgs);
				} catch (parseErr) {
					console.error(`JSON parse error for ${toolCall.function.name}:`, parseErr);
					console.error("Raw arguments:", argsString);
					console.error("Cleaned arguments:", cleanedArgs);
					
					// Try to extract values manually as fallback
					const fieldNameMatch = cleanedArgs.match(/"fieldName"\s*:\s*"([^"]*)"/) || 
										 cleanedArgs.match(/'fieldName'\s*:\s*'([^']*)'/) ||
										 cleanedArgs.match(/fieldName\s*:\s*"([^"]*)"/);
					const valuesMatch = cleanedArgs.match(/"values"\s*:\s*(\[[^\]]*\])/) || 
									   cleanedArgs.match(/'values'\s*:\s*(\[[^\]]*\])/) ||
									   cleanedArgs.match(/values\s*:\s*(\[[^\]]*\])/);
					
					if (fieldNameMatch && valuesMatch) {
						try {
							const fieldName = fieldNameMatch[1];
							const values = JSON.parse(valuesMatch[1]);
							args = { fieldName, values };
							console.log(`Recovered arguments for ${toolCall.function.name}:`, args);
						} catch (recoveryErr) {
							console.error("Failed to recover arguments:", recoveryErr);
							continue;
						}
					} else {
						console.error("Could not recover arguments from malformed JSON");
						continue;
					}
				}

				// Validate required fields
				if (!args.fieldName || !Array.isArray(args.values)) {
					console.error(`Invalid arguments for ${toolCall.function.name}:`, args);
					continue;
				}

				// Execute the calculation
				const result = calculationTools[toolCall.function.name](args.fieldName, args.values);
				functionResults.push({
					name: toolCall.function.name,
					result: result
				});
				
				// Stream calculation results
				if (onStream && result) {
					const calcMessage = `<p class="calculation-result">Calculated ${result.operation} for ${result.field}: ${
						result.total !== undefined ? result.total : 
						result.average !== undefined ? result.average : 
						'See details'
					}</p>`;
					onStream(calcMessage);
				}
			} catch (err) {
				console.error(`Tool call execution error for ${toolCall.function.name}:`, err);
				// Continue processing other tool calls even if one fails
			}
		}

		const finalReply = fullText.trim();

		// Validate that we have a proper response
		if (!finalReply) {
			throw new Error("Empty response received from OpenAI");
		}

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
					lastCalculationResults: functionResults,
					missingField: null,
				},
			}
		);

		return {
			userReply: finalReply,
			params,
			api,
			calculations: functionResults,
		};

	} catch (err) {
		console.error("processIntentAndFormatResponse error:", err);
		
		// If we have partial content, try to return it
		if (fullText && fullText.trim()) {
			console.log("Returning partial response due to error");
			return {
				userReply: fullText.trim(),
				params,
				api,
				calculations: [],
				error: err.message
			};
		}

		// Fallback response
		return {
			userReply: "<p>I encountered an issue processing your request. Here's the available data:</p><pre>" + 
					JSON.stringify(actualData, null, 2).substring(0, 1000) + "...</pre>",
			params,
			api,
			calculations: [],
			error: err.message
		};
	}
};

module.exports = processIntentAndFormatResponse;