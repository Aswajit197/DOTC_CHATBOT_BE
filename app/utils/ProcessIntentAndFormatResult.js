const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

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

	//i want to show the followup message only if api?.isSuitableForGraph  if true

	try {
		const prompt = `
You're a smart assistant. Your task is to:
1. Understand the user's intent from their message.
2. Filter/transform the provided API data accordingly.
3. When the user request ("${userMessage}") includes a numeric threshold 
   (e.g., "at least 800 hours", maximum, minimum, average, sum, greater, less), 
   you MUST strictly filter the Raw API Data so that only items meeting that condition remain.
4. Never include items that fail the condition, even partially.
5. Generate a user-friendly response that directly answers the user's message.

---

### API Info
Name: ${api.name}
Description: ${api.description}

### User Message:
"${userMessage}"

### Query Parameters:
${JSON.stringify(params, null, 2)}

### Example Response Format:
${JSON.stringify(exampleResponse, null, 2)}

### Raw API Data:
${JSON.stringify(actualData, null, 2)}

---

### Instructions
Decide the HTML output format dynamically based on intent and API description:

- If the **user message** explicitly asks for "table", "tabular" or if the **API description** indicates tabular data, then format the reply as an HTML <table> with <thead>, <tbody>, <tr>, <th>, <td>.
- If the data is best represented as a **list**, use <ul><li>...</li></ul>.
- If userMessage intent is for specific one driver id or LMDP ID try to send in list format.
- Try to provide complete list/table always if user content contains any filter action.
- If the data is descriptive or narrative, use <p>...</p>.
- If the data contains date string send in proper user readable format.
- Always start with a <p> introduction sentence before table or list.

${
	api?.isSuitableForGraph
		? `- After the table or list, always add:
  <p class="followup-message">Would you like me to turn this into a visualization, such as a graph or chart?</p>`
		: `- Do NOT add any follow-up visualization message.`
}

- Do not include Markdown, plain text, or JSON in this section. Only valid HTML.

After finishing the HTML reply, output a new line with exactly:
###END###
`;

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: prompt }],
			temperature: 0.3,
			stream: true,
		});

		for await (const chunk of completion) {
			const delta = chunk.choices?.[0]?.delta?.content || "";
			if (!delta) continue;

			fullText += delta;

			// Stop when END marker appears
			if (fullText.includes("###END###")) break;

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			if (cleaned) {
				const formatted = cleaned
					// Add missing space between lowercase → UPPERCASE
					.replace(/([a-z])([A-Z])/g, "$1 $2")
					// Add space between number + letters (702hours → 702 hours)
					.replace(/(\d)([A-Za-z])/g, "$1 $2")
					// Add space between letters + number (hours702 → hours 702)
					.replace(/([a-zA-Z])(\d)/g, "$1 $2");

				if (onStream) onStream(formatted);
			}
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();

		// ✅ Save the last reply in session
		await Session.updateOne(
			{ _id: session._id },
			{
				$set: {
					lastResponseMessage: finalReply,
					lastSuccessUserMessage: userMessage,
					lastSuccessIntent: api?.name || null,
					lastSuccessApiResponse: actualData,
				},
			}
		);

		return {
			userReply: fullText.replace(/###END###/g, "").trim(),
			params,
			api,
		};
	} catch (err) {
		console.log(err);
		console.error("processIntentAndFormatResponse error:", err.message);
		return {
			userReply: "Here's the available data. (Intent-based personalization failed.)",
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
