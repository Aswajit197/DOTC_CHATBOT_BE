const { OpenAI } = require("openai");
const Session = require("../model/session.model");
const apiListData = require("../../apiDetails");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * ✅ Lightweight semantic check for intent equality
 */
async function isSameIntent(userMessage, lastMessage, abortSignal) {
	if (!lastMessage) return false;
	if (abortSignal?.aborted) {
		console.log("🚫 isSameIntent aborted early");
		return false;
	}

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

	try {
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
			max_tokens: 5,
		
		});

		if (abortSignal?.aborted) {
			console.log("🚫 isSameIntent aborted after OpenAI call");
			return false;
		}

		const answer = completion.choices[0].message.content.trim().toUpperCase();
		return answer === "YES";
	} catch (err) {
		if (abortSignal?.aborted) {
			console.log("🚫 isSameIntent caught abort during OpenAI call");
			return false;
		}
		console.warn("isSameIntent failed:", err.message);
		return false;
	}
}

/**
 * Handles dependent refinements:
 * e.g., filtering, removing/adding columns, sorting, reformatting last response.
 */
async function refineResponseFromLastResponse(userMessage, session, { onStream, abortSignal } = {}) {
    console.log("Entered in refinement");

    if (abortSignal?.aborted) {
        console.log("🚫 refineResponseFromLastResponse: Aborted before processing");
        return { error: "Request aborted" };
    }

    try {
        const api = apiListData.find((api) => api.name === session.lastSuccessIntent);
        const isSuitableForGraph = api?.isSuitableForGraph || false;

        if (session.lastSuccessUserMessage && (await isSameIntent(userMessage, session.lastSuccessUserMessage, abortSignal))) {
            return {
                formattedReply: session.lastResponseMessage,
                type: "same intent",
            };
        }

        if (abortSignal?.aborted) {
            console.log("🚫 refineResponseFromLastResponse: Aborted before OpenAI refinement");
            return { error: "Request aborted" };
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
6. Additionally, generate a **MergedUserMessage** on a new line like this:
   MERGED_USER_MESSAGE: <the merged message here>
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

- **Add a final HTML summary block immediately before the optional follow-up visualization message**:
  <div class="summary"><p>...</p></div>
  (Include meaningful stats, counts, averages, min/max, etc. Avoid trivial facts.)

${
    isSuitableForGraph
        ? `- After the summary block (if it exists), evaluate if the refined data is suitable for visualization.
  - If yes, append:
    <p class="followup-message">Would you like me to turn this into a visualization, such as a graph or chart?</p>`
        : `- Do NOT add any follow-up visualization message.`
}

- Only output valid HTML, no markdown, no JSON.
- After finishing the reply, output:
###END###
`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            stream: true,
           
        });

        for await (const chunk of completion) {
            if (abortSignal?.aborted) {
                console.log("🚫 refineResponseFromLastResponse aborted mid-stream");
                return { error: "Request aborted" };
            }

            const delta = chunk.choices?.[0]?.delta?.content || "";
            if (!delta) continue;

            fullText += delta;

            // Extract merged message if present
            const mergedMatch = fullText.match(/MERGED_USER_MESSAGE:\s*([^\n]*)/);
            if (mergedMatch && !mergedMessage) {
                mergedMessage = mergedMatch[1].trim();
            }

            if (fullText.includes("###END###")) break;

            const cleaned = delta.replace(/###\s*END\s*###/gi, "").replace(/MERGED_USER_MESSAGE:.*$/m, "");
            if (cleaned && onStream) {
                const formatted = cleaned
                    .replace(/([a-z])([A-Z])/g, "$1 $2")
                    .replace(/(\d)([A-Za-z])/g, "$1 $2")
                    .replace(/([a-zA-Z])(\d)/g, "$1 $2");
                onStream(formatted);
            }
        }

        if (abortSignal?.aborted) {
            console.log("🚫 refineResponseFromLastResponse aborted before final reply");
            return { error: "Request aborted" };
        }

        const finalReply = fullText
            .replace(/MERGED_USER_MESSAGE:.*$/m, "")
            .replace(/###END###/g, "")
            .trim();

        return {
            formattedReply: finalReply,
            mergedUserMessage: mergedMessage,
            actualData: session.lastSuccessApiResponse // Pass through the data
        };

    } catch (err) {
        if (abortSignal?.aborted) {
            console.log("🚫 refineResponseFromLastResponse caught abort in catch");
            return { error: "Request aborted" };
        }
        console.error("refineResponseFromLastResponse error:", err);
        return { error: "Failed to refine Response data..." };
    }
}


module.exports = refineResponseFromLastResponse;
