const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Streams GPT's partial plain text response until "###JSON###",
 * then captures JSON silently and returns at the end.
 */
const processIntentAndFormatResponse = async ({ userMessage, api, exampleResponse, actualData, params = {}, onStream }) => {
	let fullText = "";
	let streamedText = "";
	let jsonPart = "";
	let inJsonSection = false;

	try {
		const prompt = `
You're a smart assistant. Your task is to:
1. Understand the user's intent from their message
2. Filter/transform the provided API data accordingly
3.When the ${userMessage} / user request includes a numeric threshold (e.g., "at least 800 hours"),maximum , minimum , average , sum , greater , less , average you MUST strictly filter the Raw API Data so that only items meeting that condition remain.
4.Never include items that fail the condition, even partially.
5. Generate a user-friendly response that directly answers the user's message

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
- First, write ONLY the clear, conversational reply userReply in plain text — exactly how you’d say it to a user.  
- Use bullet points for lists.
- Do not include any JSON or metadata in this part.
- Use bullet points for lists.
- Do not include any Markdown formatting (like **bold**, _italic_, code, etc).
- Output plain text only for this section.
- Perform this filtering before producing the JSON output.

- After finishing the plain text reply, output a new line with:
  ###JSON###
- Then output ONLY the JSON object in this format:
{
  "filteredResponse": { ...matching exampleResponse structure... },
  "userReply": "<same reply text as above>"
}
`;

		// Start streaming
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
				continue; // Do not send marker or anything after it
			}

			if (!inJsonSection) {
				// Prevent partial marker like "###" or "JSON" leaking
				const cleaned = delta
					.replace(/###\s*JSON\s*###/gi, "")
					.replace(/JSON/gi, "") // 👈 remove dangling JSON
					.replace(/#+/g, "")
					.trim();

				if (cleaned) {
					streamedText += cleaned;
					if (onStream) onStream(cleaned);
				}
			} else {
				// Capture JSON quietly
				jsonPart += delta;
			}
		}

		// Parse JSON part
		const parsed = JSON.parse(jsonPart.trim());
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
