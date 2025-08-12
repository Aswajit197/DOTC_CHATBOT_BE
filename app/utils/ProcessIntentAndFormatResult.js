// const { OpenAI } = require("openai");
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// /**
//  * Processes a user message, applies API filtering, and streams GPT's reply in real-time.
//  */
// const processIntentAndFormatResponse = async ({
// 	userMessage,
// 	api,
// 	exampleResponse,
// 	actualData,
// 	params = {},
// 	onStream,
// }) => {
// 	let streamedText = "";
// 	let fullText = "";
// 	let jsonPart = "";

// 	try {
// 		const prompt = `
// You're a smart assistant. Your task is to:
// 1. Understand the user's intent from their message
// 2. Filter/transform the provided API data accordingly
// 3. Generate a user-friendly response that directly answers the user's message

// ---

// ### API Info
// Name: ${api.name}
// Description: ${api.description}

// ### User Message:
// "${userMessage}"

// ### Query Parameters:
// ${JSON.stringify(params, null, 2)}

// ### Example Response Format:
// ${JSON.stringify(exampleResponse, null, 2)}

// ### Raw API Data:
// ${JSON.stringify(actualData, null, 2)}

// ---

// ### Instructions
// - First, write ONLY the clear, conversational reply userReply in plain text — exactly how you’d say it to a user.
// - Use bullet points for lists, like:
//   Here is the list of drivers with their hours:
//   - Driver ID: 5519, Hours: 40
//   - Driver ID: 5520, Hours: 40
// - Do not include any JSON or metadata in this part.
// - After finishing the plain text reply, output a new line with:
//   ###JSON###
// - Then output ONLY the JSON object in this format:
// {
//   "filteredResponse": { ...matching exampleResponse structure... },
//   "userReply": "<same reply text as above>"
// }
// `;

// 		// Start streaming
// 		const completion = await openai.chat.completions.create({
// 			model: "gpt-4o-mini",
// 			messages: [{ role: "user", content: prompt }],
// 			temperature: 0.3,
// 			stream: true,
// 		});

// 		let inJsonSection = false;

// 		for await (const chunk of completion) {
// 			const delta = chunk.choices?.[0]?.delta?.content || "";
// 			fullText += delta;

// 			// Detect start of JSON section
// 			if (!inJsonSection && fullText.includes("###JSON###")) {
// 				inJsonSection = true;
// 				continue;
// 			}

// 			if (!inJsonSection) {
// 				streamedText += delta;
// 				if (onStream && delta.trim()) {
// 					onStream(delta);
// 				}
// 			} else {
// 				jsonPart += delta;
// 			}
// 		}

// 		// Parse JSON
// 		const parsed = JSON.parse(jsonPart.trim());
// 		if (!parsed.filteredResponse || !parsed.userReply) {
// 			throw new Error("Incomplete structured response from GPT");
// 		}

// 		parsed.params = params;
// 		parsed.api = api;

// 		return parsed;
// 	} catch (err) {
// 		console.error("processIntentAndFormatResponse error:", err.message);
// 		return {
// 			filteredResponse: actualData,
// 			userReply: "Here's the available data. (Intent-based personalization failed.)",
// 			params,
// 			api,
// 		};
// 	}
// };

// module.exports = processIntentAndFormatResponse;

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Processes a user message, applies API filtering, and streams GPT's reply in real-time.
 * Stops sending partial chunks once the JSON section begins.
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
- First, write ONLY the clear, conversational reply userReply in plain text — exactly how you’d say it to a user.  
- Use bullet points for lists, like:
  Here is the list of drivers with their hours:
  - Driver ID: 5519, Hours: 40
  - Driver ID: 5520, Hours: 40
- Do not include any JSON or metadata in this part.
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

			// Detect start of JSON section
			if (!inJsonSection && fullText.includes("###JSON###")) {
				inJsonSection = true;
				continue; // Don't send this marker to frontend
			}

			if (!inJsonSection) {
				// Only stream before JSON starts
				streamedText += delta;
				if (onStream && delta.trim()) {
					onStream(delta);
				}
			} else {
				// Capture JSON part silently
				jsonPart += delta;
			}
		}

		// Parse and validate JSON part
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
