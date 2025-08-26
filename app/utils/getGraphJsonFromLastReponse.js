const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getGraphJsonFromLastResponse(userMessage, session, { onStream } = {}) {
	try {
		if (!session.lastResponseMessage) {
			return { error: "No previous response available for visualization." };
		}

		// System prompt to extract structured data
		const systemPrompt = `
You are an assistant that converts HTML table or list content into JSON array format.
- Input will be HTML that contains tabular or list data.
- Output must ONLY be valid JSON (no extra text).
- JSON must be an array of objects where keys are column/field names and values are row values.
- If the HTML contains lists, use field names like "item", "value", etc.
- try to convert values in integer format which can be converted like for 40 hours
- Do not explain anything, just return JSON.
`;

		const completion = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: session.lastResponseMessage },
			],
			temperature: 0,
		});

		let parsedJson;
		try {
			parsedJson = JSON.parse(completion.choices[0].message.content.trim());
		} catch (err) {
			console.error("Failed to parse JSON from OpenAI response:", err);
			return { error: "Could not extract JSON from previous response." };
		}

		console.log(parsedJson, "parsed json");

		// Return structured JSON for visualization
		return {
			type: "visualization",
			data: parsedJson,
			userReply: "Here’s the structured data ready for visualization.",
		};
	} catch (err) {
		console.error("getGraphJson handler error:", err);
		return { error: "Failed to generate graph data..." };
	}
}

module.exports = getGraphJsonFromLastResponse;
