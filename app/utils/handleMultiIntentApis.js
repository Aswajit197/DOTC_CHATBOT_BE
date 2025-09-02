const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const apiListData = require("../../apiDetails");
const Session = require("../model/session.model");
const { handleParamsForApi } = require("./handleParamsForApis");

async function handleMultiIntentApis(extracted, userMessage, session, onStream) {
	const results = [];

	for (const apiInfo of extracted.apis) {
		const matchedApi = apiListData.find((api) => api.name === apiInfo.apiName);
		if (!matchedApi) {
			results.push({
				apiName: apiInfo.apiName,
				error: "API not found",
			});
			continue;
		}

		// Validate params
		const { params: finalParams, missingFields } = await handleParamsForApi(
			matchedApi,
			apiInfo.params || {},
			userMessage,
			session,
			onStream
		);

		if (missingFields.length) {
			results.push({
				error: "Missing required fields",
				requires: missingFields,
				api: matchedApi,
				params: finalParams,
			});
			continue;
		}

		// Call multiHandler for raw data
		if (typeof matchedApi.multiHandler === "function") {
			try {
				const apiResponse = await matchedApi.multiHandler(finalParams);
				results.push({
					api: matchedApi,
					params: finalParams,
					rawData: apiResponse,
					exampleResponse: matchedApi.exampleResponse,
				});
			} catch (err) {
				console.error(`API multiHandler error for ${matchedApi.name}:`, err);
				results.push({
					api: matchedApi,
					error: "API multiHandler failed",
				});
			}
		} else {
			results.push({
				api: matchedApi,
				error: "multiHandler not implemented",
			});
		}
	}

	// ✅ Now build prompt for OpenAI merge
	let fullText = "";
	try {
const prompt = `
You're a smart assistant. The user asked:
"${userMessage}"

You have data from multiple APIs. Your tasks:
1. Check whether user message intent is for a merged response and  the APIs share a common entity (e.g., both return driver name, or both contain IDs/keys that can be matched).
   - If YES: Merge/combine these API results into a single cohesive response.
   - If NO: Present each API's data separately, one after another, in the same message.
2. When merging, join data into one table with all relevant merged columns.
3. When showing separately, give each API its own block:
   <p><strong>[API Name / Description]</strong></p>
   followed by its data in table, list, or paragraph (whichever fits best).
4. Respect any filters or requirements in the user message (e.g., "only active drivers", "show overtime preference").
5. Always produce structured HTML output.
6. IMPORTANT: Never wrap the HTML in Markdown code fences (\`\`\`html or \`\`\`). Only return plain HTML.

---

### API Results:
${results
	.map(
		(r) => `
API Name: ${r.api?.name}
Description: ${r.api?.description}
Query Params: ${JSON.stringify(r.params, null, 2)}
Example Response: ${JSON.stringify(r.exampleResponse, null, 2)}
Raw Data: ${JSON.stringify(r.rawData, null, 2)}
`
	)
	.join("\n\n")}
---

### Instructions
- For each API section:
  • Always begin with a short <p> introduction sentence.  
  • The intro should be meaningful and based on:
    - the user message
    - the API description
    - the type of data being shown
  • Example: "Here is the list of drivers and their overtime (OT) preferences:" or 
    "Here are the weekday priority factors as requested."
- If multiple APIs are unrelated (no common joinable fields), present them sequentially in the same reply: finish one section completely (intro + table/list + summary) before starting the next.
- If the APIs share a common entity, merge them into one table.
- Use <table> for tabular data, <ul> for list data, <p> for descriptive data.
- After each section, include <div class="summary"><p>...</p></div> with insights.
- Keep summaries concise (1–3 sentences) and avoid trivial facts.
- Output must be strictly valid HTML, no Markdown, no JSON, no plain text.
At the very end, output:
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

			if (fullText.includes("###END###")) break;

			const cleaned = delta.replace(/###\s*END\s*###/gi, "");
			if (cleaned && onStream) onStream(cleaned);
		}

		const finalReply = fullText.replace(/###END###/g, "").trim();

		await Session.updateOne(
			{ _id: session._id },
			{
				$set: {
					lastResponseMessage: finalReply,
					lastSuccessUserMessage: userMessage,
					lastSuccessIntent: "multi_intent",
					lastSuccessApiResponse: results.map((r) => r.rawData),
				},
			}
		);

		return { type: "multi_intent", results, combinedReply: finalReply };
	} catch (err) {
		console.log(err)
		console.error("Multi-intent OpenAI merge failed:", err.message);
		return { type: "multi_intent", results, combinedReply: "Could not merge API results." };
	}
}

module.exports = { handleMultiIntentApis };
