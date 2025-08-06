const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function formatResponseWithOpenAi(api, userMessage, json, params = {}) {
	const prompt = `
You're a helpful assistant generating friendly replies to user questions, based on API responses.

### Goal
Respond **directly** to the user's message. Your reply should sound natural and conversational — like you're **answering a question**, not explaining an API.

### Instructions
- Be **brief**, **clear**, and **relevant** to the user's original message.
- Use a **friendly, conversational tone**, not robotic.
- Don't mention APIs, JSON, or technical details.
- If a filter is applied (like only drivers working 40 hours), reflect that in your reply.
- If most data is similar (e.g. many drivers with 30 hours), summarize it and list only the outliers.
- If data varies widely, group or summarize meaningfully.
- Mention **what the user wanted** (inferred from \`userMessage\`), and give a useful answer using the API result.

### Example
If the user said: "Show me drivers who worked 40 hours this week", and it should give the list of drivers with details as per json .

### Input:
API Name: ${api.name}
API Description: ${api.description}

User Message: ${userMessage}

Query Parameters: ${JSON.stringify(params, null, 2)}

Raw API Data:
${JSON.stringify(json, null, 2)}

### Output:
Reply to the user based on their message and the data above.
`;

	const completion = await openai.chat.completions.create({
		model: "gpt-4",
		messages: [{ role: "user", content: prompt }],
		temperature: 0.5,
	});

	return completion.choices[0].message.content.trim();
}

module.exports = formatResponseWithOpenAi;
