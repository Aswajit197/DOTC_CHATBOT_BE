const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Streams GPT's partial plain text response until "###JSON###",
 * then captures JSON silently and returns at the end.
 */
const processIntentAndFormatResponse = async ({ userMessage, api, exampleResponse, actualData, params = {}, onStream }) => {
	let fullText = "";
	let jsonPart = "";
	let inJsonSection = false;

	// - if userMessage intent if for specific one driver id or LMDP ID try to send in list format .
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
- try to provide complete list always if user content  contains any filter action
- If the data is descriptive or narrative, use <p>...</p>.
- if the data contains date string send in proper user readable format
- Always start with a <p> introduction sentence before table or list.
- Do not include Markdown, plain text, or JSON in this section. Only valid HTML.

After finishing the HTML reply, output a new line with exactly:
###JSON###

Then output ONLY the JSON object in this format:
{
  "filteredResponse": { ...matching exampleResponse structure... },
  "userReply": "<same HTML reply as above>"
}
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

			// Detect JSON marker start
			if (!inJsonSection && fullText.includes("###JSON###")) {
				inJsonSection = true;
				continue; // skip marker itself
			}

			if (!inJsonSection) {
				const cleaned = delta.replace(/###\s*JSON\s*###/gi, "");
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
			} else {
				// Capture JSON quietly
				jsonPart += delta;
			}
		}

		// Parse JSON part
		const parsed = JSON.parse(jsonPart.trim());
		// console.log(parsed.filteredResponse, "parsed json");
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
			params,
			api,
		};
	}
};

module.exports = processIntentAndFormatResponse;
