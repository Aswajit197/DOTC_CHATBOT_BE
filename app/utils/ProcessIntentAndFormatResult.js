const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

// Calculation Tool Functions
const calculationTools = {
	calculateSum: (fieldName, values) => ({
		operation: "sum",
		field: fieldName,
		total: values.reduce((sum, val) => sum + val, 0),
		count: values.length
	}),
	
	calculateAverage: (fieldName, values) => {
		if (!values.length) return { operation: "average", field: fieldName, average: 0, count: 0, min: null, max: null };
		const sum = values.reduce((acc, val) => acc + val, 0);
		return {
			operation: "average",
			field: fieldName,
			average: Math.round((sum / values.length) * 100) / 100,
			count: values.length,
			min: Math.min(...values),
			max: Math.max(...values)
		};
	},
	
	calculateMinMax: (fieldName, values) => ({
		operation: "min_max",
		field: fieldName,
		min: values.length ? Math.min(...values) : null,
		max: values.length ? Math.max(...values) : null,
		count: values.length
	}),
	
	calculateDeviation: (fieldName, values) => {
		if (!values.length) return { operation: "standard_deviation", field: fieldName, average: 0, standardDeviation: 0, count: 0 };
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

// OpenAI Tools Schema
const openAITools = Object.keys(calculationTools).map(name => ({
	type: "function",
	function: {
		name,
		description: `Calculate ${name.replace(/calculate/i, '').toLowerCase()} of numeric values`,
		parameters: {
			type: "object",
			properties: {
				fieldName: { type: "string", description: "Field name" },
				values: { type: "array", items: { type: "number" }, description: "Array of numbers" }
			},
			required: ["fieldName", "values"]
		}
	}
}));

/**
 * Process and truncate data to prevent token limits
 */
const truncateData = (data, maxLength = 30000) => {
	const dataString = JSON.stringify(data);
	if (dataString.length <= maxLength) return data;
	
	console.log("Truncating large data response");
	if (Array.isArray(data)) {
		return data.slice(0, Math.min(50, data.length));
	}
	try {
		return JSON.parse(dataString.substring(0, maxLength) + "}");
	} catch {
		return data;
	}
};

/**
 * Build conversation history from session
 */
const buildConversationHistory = (session) => {
	if (!session.lastSuccessUserMessage || !session.lastResponseMessage) return [];
	
	return [
		{ role: "user", content: session.lastSuccessUserMessage },
		{ role: "assistant", content: session.lastResponseMessage.substring(0, 500) + "..." }
	];
};

/**
 * Main function to process intent and format response
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
	let streamBuffer = "";
	let toolCalls = [];
	let functionResults = [];
	
	try {
		const processedData = truncateData(actualData);
		const conversationHistory = buildConversationHistory(session);

		const systemPrompt = `You're an assistant that processes API data and answers questions.

Your tasks:
1. Understand user intent and filter/transform API data as needed
2. Use calculation functions for mathematical operations
3. Format responses in clean HTML (tables, lists, or paragraphs)
4. For "top N per category" requests, create separate tables for each category
5. Apply numeric filters strictly when provided
6. Format dates into readable format

API: ${api.name} - ${api.description}
User Message: "${userMessage}"
Parameters: ${JSON.stringify(params, null, 2)}
Data (${Array.isArray(processedData) ? processedData.length + ' items' : 'object'}): ${JSON.stringify(processedData, null, 2)}

Output Instructions:
- Use HTML only: <table>, <ul>, <p> tags as appropriate
- Start with introductory <p>
- Include <div class="summary"> with exact counts and insights
- Format dates readable (e.g., "September 12, 2025")
- Keep response under 4000 characters
${api?.isSuitableForGraph ? '<p class="followup-message">Would you like me to turn this into a graph?</p>' : ''}

Output your HTML response only. Do NOT include ###END### or any markers.`;

		const messages = [
			{ role: "system", content: systemPrompt },
			...conversationHistory,
			{ role: "user", content: userMessage }
		];

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages,
			temperature: 0,
			tools: openAITools,
			tool_choice: "auto",
			stream: true,
			max_tokens: 3000,
		});

		for await (const chunk of completion) {
			const delta = chunk.choices?.[0]?.delta;
			
			// Handle tool calls
			if (delta?.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					const idx = toolCall.index;
					if (!toolCalls[idx]) {
						toolCalls[idx] = {
							id: toolCall.id || "",
							function: { name: "", arguments: "" }
						};
					}
					if (toolCall.function?.arguments) {
						toolCalls[idx].function.arguments += toolCall.function.arguments;
					}
					if (toolCall.function?.name) {
						toolCalls[idx].function.name = toolCall.function.name;
					}
				}
				continue;
			}
			
			// Handle content
			const content = delta?.content || "";
			if (!content) continue;

			fullText += content;
			streamBuffer += content;

			// Stream in chunks
			if (streamBuffer.length > 100 && onStream) {
				onStream(streamBuffer);
				streamBuffer = "";
			}
		}

		// Stream remaining buffer
		if (streamBuffer && onStream) {
			onStream(streamBuffer);
		}

		// Execute tool calls
		for (const toolCall of toolCalls) {
			if (!toolCall?.function?.name) continue;
			
			try {
				const args = JSON.parse(toolCall.function.arguments || "{}");
				if (args.fieldName && Array.isArray(args.values)) {
					const result = calculationTools[toolCall.function.name](args.fieldName, args.values);
					functionResults.push({ name: toolCall.function.name, result });
					
					if (onStream && result) {
						onStream(`<p class="calculation-result">Calculated ${result.operation} for ${result.field}: ${
							result.total ?? result.average ?? 'See details'
						}</p>`);
					}
				}
			} catch (err) {
				console.error(`Tool execution error: ${err.message}`);
			}
		}

		// Ensure we have content
		const finalReply = fullText.trim() || 
			`<p>Here's the data you requested:</p><pre>${JSON.stringify(processedData, null, 2).substring(0, 2000)}...</pre>`;

		// Update session
		await Session.updateOne(
			{ _id: session._id },
			{
				$set: {
					lastResponseMessage: finalReply,
					lastSuccessUserMessage: userMessage,
					lastSuccessIntent: api?.name,
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
		console.error("Processing error:", err.message);
		
		// Return fallback with available data
		const fallback = fullText.trim() || 
			`<p>I encountered an issue processing your request. Here's the raw data:</p><pre>${
				JSON.stringify(actualData, null, 2).substring(0, 1000)
			}...</pre>`;

		return {
			userReply: fallback,
			params,
			api,
			calculations: functionResults,
			error: err.message
		};
	}
};

module.exports = processIntentAndFormatResponse;