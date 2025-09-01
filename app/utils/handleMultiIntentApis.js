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
1. Merge/combine these API results into a single cohesive response.
2. If APIs share a common entity (e.g. drivers list + their OT preference), join them into one table.
3. Respect any filters or requirements in the user message (e.g., "only active drivers", "show overtime preference").
4. Always produce structured HTML output.

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
- If the user intent indicates tabular comparison (like merging multiple driver attributes), output as <table> with all relevant merged columns.
- If data fits a list better, use <ul>.
- Always start with a <p> introduction.
- After the main data, add <div class="summary"><p>...</p></div> with insights:
   • total counts  
   • distribution of values  
   • highlights of most/least common  
   • averages if numeric  
- Do not restate trivial facts. Keep summary 1–3 sentences.

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
		console.error("Multi-intent OpenAI merge failed:", err.message);
		return { type: "multi_intent", results, combinedReply: "Could not merge API results." };
	}
}

module.exports = { handleMultiIntentApis };
