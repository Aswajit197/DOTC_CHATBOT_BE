
// async function formatResponseWithOpenAi(api, json) {
// 	console.log(api, json, "from format response with openai");
// 	const prompt = `
// You are a helpful assistant.

// Convert the following API response into a human-friendly message, based on what this API does:

// API: ${api.name}
// Description: ${api.description}
// JSON Response:
// ${JSON.stringify(json, null, 2)}

// Respond with only a user-friendly sentence.
// `;

// 	const completion = await openai.chat.completions.create({
// 		model: "gpt-4",
// 		messages: [{ role: "user", content: prompt }],
// 		temperature: 0.5,
// 	});

// 	// Return clean message
// 	return completion.choices[0].message.content.trim();
// }

// module.exports = formatResponseWithOpenAi;

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function formatResponseWithOpenAi(api, json, params = {}) {
	const prompt = `
You're a friendly assistant summarizing API results for end users.

API: ${api.name}
Description: ${api.description}
User Query Params: ${JSON.stringify(params, null, 2)}

API JSON Response:
${JSON.stringify(json, null, 2)}

Return a single friendly sentence or two that best explains the data for this user.
Avoid repeating all entries if the user only asked for specific ones (like max or a field).
`;

	const completion = await openai.chat.completions.create({
		model: "gpt-4",
		messages: [{ role: "user", content: prompt }],
		temperature: 0.5,
	});

	return completion.choices[0].message.content.trim();
}

module.exports = formatResponseWithOpenAi;