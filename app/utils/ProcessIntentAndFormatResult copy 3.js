const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");
const { toolDefinitions, dispatchToolCall } = require("./tools");

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

	try {
		const prompt = `
You're a smart assistant designed to process structured API data intelligently and answer the user's message.

Follow these rules:
- If math/statistics (average, deviation, top N, filtering) is required → call the provided tools.
- Do not attempt manual math, always delegate to tools.
- Format final answer only after tool results are returned.

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
Decide the HTML output format dynamically (table, list, or paragraph). Always begin with a <p> intro.
Always include a <div class="summary"> with totals/insights.
After all output, write:
###END###
`;

		console.log("🔹 Sending initial prompt to OpenAI...");

		// first request (tool-enabled, non-streaming so we can catch tool calls)
		let initial = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: prompt }],
			tools: toolDefinitions,
			tool_choice: "auto",
			stream: false,
		});

		const assistantMsg = initial.choices?.[0]?.message;
		const toolCalls = assistantMsg?.tool_calls;

		let messages = [{ role: "user", content: prompt }, assistantMsg];

		if (toolCalls && toolCalls.length > 0) {
			console.log("🛠 Tool calls detected:", toolCalls);

			for (const tc of toolCalls) {
				try {
					console.log(`⚡ Executing tool: ${tc.function.name}`);
					const args = JSON.parse(tc.function.arguments || "{}");
					console.log("📥 Tool args:", args);

					const result = dispatchToolCall(tc.function.name, args);
					console.log("📤 Tool result:", result);

					messages.push({
						role: "tool",
						tool_call_id: tc.id,
						content: JSON.stringify(result),
					});
				} catch (err) {
					console.error("❌ Tool execution error:", err);
				}
			}
		} else {
			console.log("✅ No tool calls, proceeding directly to streaming.");
		}

		// final streaming call
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages,
			temperature: 0,
			stream: true,
		});

		// stream handling
		for await (const chunk of completion) {
			const delta = chunk.choices?.[0]?.delta?.content || "";
			if (!delta) continue;

			fullText += delta;
			if (fullText.includes("###END###")) break;

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			if (cleaned && onStream) onStream(cleaned);
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();

		console.log("✅ Final reply generated.");

		// save session
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

		return { userReply: finalReply, params, api };
	} catch (err) {
		console.error("❌ processIntentAndFormatResponse error:", err.message);
		return {
			userReply: "Here's the available data. (Intent-based personalization failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
