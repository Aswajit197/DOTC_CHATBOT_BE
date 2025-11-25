const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const apiListData = require("../../apiDetails");

// 🔹 Extract lastFilterParams from session.history[*].context.lastFilterParams
function extractLastFilterParams(session) {
	console.log(session.history, "session");
	try {
		if (!session.history || !Array.isArray(session.history)) return null;

		// Find last entry where sender === "user"
		const lastBotItem = [...session.history].reverse().find((h) => h.sender === "bot");

		if (!lastBotItem?.context?.lastFilterParams) return null;

		return lastBotItem.context.lastFilterParams;
	} catch (err) {
		console.error("Failed to extract lastFilterParams:", err);
		return null;
	}
}

async function getGraphJsonFromLastResponse(userMessage, session, { onStream } = {}) {
	try {
		if (!session.lastResponseMessage) {
			return { error: "No previous response available for visualization." };
		}

		// 🔹 Step 1: Find example response bfrom apiListData based on lastSuccessIntent
		let exampleResponse = null;
		let graphType = "bar";
		if (session.lastSuccessIntent) {
			const matchedApi = apiListData.find((api) => api.name === session.lastSuccessIntent);

			if (matchedApi?.exampleResponse) {
				exampleResponse = matchedApi.exampleResponse;
			}
			if (matchedApi?.graphType) {
				graphType = matchedApi?.graphType;
			}
		}
		// 🔹 Step 2: Create system prompt
		let systemPrompt = `
You are an assistant that converts HTML table or list content into JSON array format.
- Input will be HTML that contains tabular or list data.
- Output must ONLY be valid JSON array(no extra text).
- JSON must be an array of objects where keys are column/field names and values are row values.
- Try to convert values into integer/number format if possible (e.g. "40 hours" → 40).
`;

		// If we found exampleResponse, guide the model with schema
		if (exampleResponse) {
			systemPrompt += `
Here is the sample JSON structure you MUST follow:
${JSON.stringify(exampleResponse, null, 2)}
Match the key names and structure exactly as shown in the example above.
`;
		}

		// 🔹 Step 3: Call OpenAI
		const completion = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: session.lastResponseMessage },
			],
			temperature: 0,
		});

		// 🔹 Step 4: Parse response safely
		let parsedJson;
		try {
			parsedJson = JSON.parse(completion.choices[0].message.content.trim());
		} catch (err) {
			console.error("Failed to parse JSON from OpenAI response:", err);
			return { error: "Could not extract JSON from previous response." };
		}
		// console.log(parsedJson, "parsed json");

		// ✅ Extracting from session.history[*].context.lastFilterParams
		const lastGraphFilterParams = extractLastFilterParams(session);

		return {
			type: "visualization",
			data: parsedJson,
			graphContents: {
				lastGraphPrompt: session.lastSuccessIntent,
				lastGraphResponse: session.lastResponseMessage,
				lastGraphParams: session.lastSuccessParams,
				lastGraphFilterParams,
				lastIntentType: "multi",
				widgetLastUserMessage: session.lastSuccessUserMessage,
				graphType,
			},
			userReply: "Here's the structured data ready for visualization.",
		};
	} catch (err) {
		console.error("getGraphJson handler error:", err);
		return { error: "Failed to generate graph data..." };
	}
}

module.exports = getGraphJsonFromLastResponse;
