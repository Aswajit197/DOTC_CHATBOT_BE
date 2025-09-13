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
	// console.log(actualData, "entered in process intent");
	try {
		const prompt = `
You're a smart assistant designed to process structured API data intelligently and answer the user's message.

Your tasks:
1. Understand the user's intent from their message.
2. Filter, transform, or aggregate the provided API data as needed to directly answer the user's request.
3. If the user asks for "top N items per category" (e.g., "top 10 drivers per shift type"), do the following:
   - Treat each category in the data (like "Parcel Van", "Step Van", etc.) as a separate group.
   - For each category, select up to N items sorted by the highest relevant metric (e.g., total shift hours).
   - Always display each category, even if no matching items are found. In that case, display a table with a row stating "No drivers found" or similar message.
   - Display each category in its own HTML table, starting with a clear introductory sentence.
4. If the user provides numeric thresholds (e.g., "at least 800 hours", "more than 50 deliveries"), strictly filter the data so that only items satisfying those thresholds remain.
5. Never include items that partially match the condition.
6. If no explicit top-N or filter is present, display all data in the most meaningful way (table, list, or paragraph).
7. check the response if its more likely a table format or list format or paragraph always try to give better format as per response
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
- Always include a <div class="summary"> block summarizing:
    - Exact total counts per category or in total.
    - 1-2 additional meaningful computed insights (e.g., highest working hours and by whom).
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

			// Stop when END marker appears
			if (fullText.includes("###END###")) break;

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			// console.log(cleaned, "cleaned....");
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
					lastSuccessParams: params,
					missingField: null,
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
