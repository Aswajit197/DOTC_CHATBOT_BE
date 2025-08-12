const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const processIntentAndFormatResponse = async ({ userMessage, api, exampleResponse, actualData, params = {} }) => {

	try {
		const prompt = `
You're a smart assistant. Your task is to:
1. Understand the user's intent from their message
2. Filter/transform the provided API data accordingly
3. Generate a user-friendly response that directly answers the user's message

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
- First, understand what the user is asking (e.g. highest, exact match, filters like "more than 40 hours", "minimum", etc.)
- Apply the necessary filters/transformation on the data
- Then, generate a clear, conversational reply summarizing the result
- Be clear and informative without being technical. If values are involved (like scores or hours), include them naturally in the sentence.
- If the user asks for a list, return the full list in a readable format (use bullet points or new lines per item)
- Do NOT summarize the data unless explicitly asked to
- Avoid using terms like "API", "JSON", or technical jargon
- If there’s no match, reply nicely and say that no results were found

---

### Output Format (in JSON):
{
  "filteredResponse": { ...filtered and transformed data matching exampleResponse structure... },
  "userReply": "<natural sounding answer to the user's message>"
}
`;
		const completion = await openai.chat.completions.create({
			model: "gpt-4",
			messages: [{ role: "user", content: prompt }],
			temperature: 0.3,
		});

		const responseText = completion.choices?.[0]?.message?.content?.trim();

		const parsed = JSON.parse(responseText);

		// Validate response structure
		if (!parsed.filteredResponse || !parsed.userReply) {
			throw new Error("Incomplete structured response from GPT");
		}

		parsed.params = params;
		parsed.api = api;

		return parsed;
	} catch (err) {
		console.error("processIntentAndFormatResponse error:", err.message);
		return {
			filteredResponse: actualData,
			userReply: "Here's the available data. (Intent-based personalization failed.)",
		};
	}
};

module.exports = processIntentAndFormatResponse;
