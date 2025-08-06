const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const getResponseAccordingToUserIntent = async ({ userMessage, exampleResponse, actualData }) => {
	try {
		const prompt = `
You are an intelligent assistant. Based on the user's message, filter or transform the data accordingly.

User Message:
"${userMessage}"

Example Response Format:
${JSON.stringify(exampleResponse, null, 2)}

Actual Data:
${JSON.stringify(actualData, null, 2)}

Now return the processed response in the same format matching user's message intent.
`;

		const completion = await openai.chat.completions.create({
			model: "gpt-4",
			messages: [
				{ role: "system", content: "process and structure API response data based on user intent." },
				{ role: "user", content: prompt },
			],
			temperature: 0.2,
		});

		const responseText = completion.choices?.[0]?.message?.content;

		// Try to parse structured response
		const parsed = JSON.parse(responseText);
		return parsed;
	} catch (err) {
		console.error("Intent-based filter failed:", err.message);
		// fallback to raw data
		return actualData;
	}
};

module.exports = getResponseAccordingToUserIntent;
