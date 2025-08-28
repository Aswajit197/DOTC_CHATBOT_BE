const { OpenAI } = require("openai");
const Session = require("../model/session.model");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * ✅ Lightweight semantic check for intent equality
 */
async function isSameIntent(userMessage, lastMessage) {
	if (!lastMessage) return false;

	const prompt = `
You are an intent comparator.
Decide if these two user messages have the **same meaning or intent**:

Message A: "${lastMessage}"
Message B: "${userMessage}"

Rules:
- If they are semantically equivalent (even if worded differently), return "YES".
- If they request different refinements or focus on different fields, return "NO".
- Only respond with "YES" or "NO".
`;

	const completion = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		messages: [{ role: "user", content: prompt }],
		temperature: 0,
		max_tokens: 5,
	});

	const answer = completion.choices[0].message.content.trim().toUpperCase();
	return answer === "YES";
}

/**
 * Handles dependent refinements:
 * e.g., filtering, removing/adding columns, sorting, reformatting last response.
 */
async function refineResponseFromLastResponse(userMessage, session, { onStream } = {}) {
	try {
		if (!session.lastSuccessApiResponse) {
			return { error: "No previous API response available to refine." };
		}

		// ✅ Early exit if same intent
		if (session.lastSuccessUserMessage && (await isSameIntent(userMessage, session.lastSuccessUserMessage))) {
			console.log("entered Here for response")
			// return {
			// 	userReply: session.lastResponseMessage,
			// };
			return {
				formattedReply: session.lastResponseMessage,
				type:"same intent"
			};
		}

		let fullText = "";
		let mergedMessage = null;

		const prompt = `
You are a smart assistant. The user has already received an API result.
Now, they want to refine or modify that result.

Your job:
1. Understand the new user request.
2. Apply the refinement strictly on the **previous successful API data**.
3. Do not fetch or assume new data — only refine the given data.
4. Always follow the refinement exactly (e.g., remove fields, filter rows, sort, reformat).
5. Return user-friendly HTML with the refined result.
6. Additionally, generate a **MergedUserMessage**:
   - Start with the original user request.
   - Add or remove refinements progressively.
   - If the user removes multiple fields, combine them like: "excluding start date and end date".
   - If the user re-adds something they previously excluded, remove it from the exclusion list.
   - Always produce a single clean natural sentence, not parentheses or history notes.

---

### Previous Successful User Message:
"${session.lastSuccessUserMessage || "None"}"

### Current Refinement User Message:
"${userMessage}"

### Previous API Used:
${session.lastSuccessIntent || "Unknown"}

### Raw Previous API Data:
${JSON.stringify(session.lastSuccessApiResponse, null, 2)}

---

### Instructions for Formatting
- If refinement results in **tabular data**, return as <table>.
- If results in a **list**, return <ul>.
- If the result is descriptive/narrative, use <p>.
- Always start with an intro sentence (<p>).
- If the data contains date string send in proper user readable format.
- Always end with:
  <p class="followup-message">Would you like me to turn this into a visualization, such as a graph or chart?</p>
- Only output valid HTML, no markdown, no JSON.

After the HTML
Finally, output a new line with exactly:
###END###
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

			const mergedMatch = delta.match(/MERGED_USER_MESSAGE:\s*(.*)/);
			if (mergedMatch) {
				mergedMessage = mergedMatch[1].trim();
			}

			if (fullText.includes("###END###")) break;

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			if (cleaned && onStream) {
				const formatted = cleaned
					.replace(/([a-z])([A-Z])/g, "$1 $2")
					.replace(/(\d)([A-Za-z])/g, "$1 $2")
					.replace(/([a-zA-Z])(\d)/g, "$1 $2");
				onStream(formatted);
			}
		}

		const finalReply = fullText
			.replace(/MERGED_USER_MESSAGE:.*$/m, "")
			.replace(/###END###/g, "")
			.trim();

		await Session.updateOne(
			{ _id: session._id },
			{
				$set: {
					lastResponseMessage: finalReply,
					lastSuccessUserMessage: mergedMessage || userMessage,
					lastSuccessIntent: session.lastSuccessIntent || null,
					lastSuccessApiResponse: session.lastSuccessApiResponse,
				},
			}
		);

		return {
			userReply: finalReply,
		};
	} catch (err) {
		console.error("refineResponseFromLastResponse error:", err);
		return { error: "Failed to refine Response data..." };
	}
}

module.exports = refineResponseFromLastResponse;
