const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const apiListData = require("../../apiDetails");
const Session = require("../model/session.model");
const { handleParamsForApi } = require("./handleParamsForApis");

async function handleMultiIntentApis(extracted, userMessage, session, { onStream, abortSignal }) {
	// 🔹 Exit early if aborted before starting
	if (abortSignal?.aborted) {
		console.log("🚫 handleMultiIntentApis: Already aborted at start");
		return { type: "multi_intent", error: "Request aborted early" };
	}
	const results = [];

	for (const apiInfo of extracted.apis) {
		// 🔹 Stop loop if aborted mid-way
		if (abortSignal?.aborted) {
			console.log("🚫 handleMultiIntentApis: Aborted during API loop");
			break;
		}
		const matchedApi = apiListData.find((api) => api.name === apiInfo.apiName);
		if (!matchedApi) {
			results.push({
				apiName: apiInfo.apiName,
				error: "API not found",
			});
			continue;
		}
		// Validate params
		let type = "multi_intent";
		const { params: finalParams, missingFields } = await handleParamsForApi(
			matchedApi,
			apiInfo.params || {},
			userMessage,
			session,
			{ onStream, abortSignal },
			type
		);

		if (abortSignal?.aborted) {
			console.log("🚫 handleMultiIntentApis: Aborted after param handling");
			break;
		}

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

	// 🔹 Before OpenAI call, check again
	if (abortSignal?.aborted) {
		console.log("🚫 handleMultiIntentApis: Aborted before OpenAI call");
		return { type: "multi_intent", results, error: "Request aborted before merge" };
	}

	// ✅ Now build prompt for OpenAI merge
	let fullText = "";
	try {
		const prompt = `
You're a smart assistant. The user asked:
"${userMessage}"

You have data from one or more APIs. Your tasks:

1. **Intent Check**  
   - Determine if the user's request requires a *merged response* (e.g., APIs share a common entity such as driverName, driverId, or another key).  
   - If YES → Only output a single unified merged result. Do **not** show any individual API data before merging.  
   - If NO → Present each API's data separately, one section after another, in the same message.  
   - If an API is used only as a filter (e.g., qualifications, status checks, min/max limits), its results must never be displayed separately. They should only constrain the merged output.

2. **Formatting Rules**  
   - Output must be **strictly valid HTML**.  
   - Never use Markdown (\`\`\`html, \`\`\`, etc.).  
   - Never repeat the same dataset in multiple formats.  
   - Use semantic tags:  
     • <table> for tabular data  
     • <ul> for list data  
     • <p> for descriptive text  
   - Each section must include:  
     • Exactly one <p> introduction sentence (tailored to the user’s request and API context)  
     • Exactly one structured block (<table>, <ul>, or <p>)  
     • One <div class="summary"><p>...</p></div> that must include:  
        - The exact total count of rows/entities in the table  
        - short additional meaningful insights (e.g., distribution of overtime preferences, highest/lowest values)  
     • Never use vague phrases like "several", "some", "a few". Always compute and display the precise number. 

3. **Merging Behavior**  
   - If APIs share a common entity (e.g., drivers/LMDPs), always merge them into a single table.  
   - Each row must represent one entity, with all relevant fields from all APIs combined into columns.  
   - **Never output raw lists of entities separately** (e.g., “Here are the drivers …”).  
   - Only show the merged table representation.  
   - Qualification or filter-type APIs act only as filters. They influence which entities appear in the table but should never   produce a standalone section or list.
   - Normalize entity keys (e.g., driverName, LMDPName) across APIs:
      • Match case-insensitively  
      • Ignore minor differences in spacing/capitalization  
      • If an entity appears in the filter list but is missing from another API, still include it in the merged table with "N/A" for the missing fields.

4. **Filters & Requirements**  
   - Apply all user-specified conditions (e.g., "only active drivers", "qualification = 3", "show overtime preference").  
   - Only include data relevant to these filters.  

5. **Multiple APIs**  
   - If unrelated: Present sequentially → finish one section completely before starting the next.  
   - If related: Merge results → create a single, cohesive table.  

6. **Strict Merge Enforcement**  
   - If the intent is a merged request, stream the response only **after merging all relevant API data**.  
   - Do not first output single-API results and then later merge them.  

7. **Ending**  
   - After the entire response, always append:
     ###END###

---

### API Results:
${results
	.map(
		(r) => `
Example Response: ${JSON.stringify(r.exampleResponse, null, 2)}
Raw Data: ${JSON.stringify(r?.rawData?.data, null, 2)}
`
	)
	.join("\n\n")}
---
`;

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: prompt }],
			temperature: 0.3,
			stream: true,
		});

		for await (const chunk of completion) {
			if (abortSignal?.aborted) {
				console.log("🚫 handleMultiIntentApis: Aborted during OpenAI streaming");
				break;
			}
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
		if (abortSignal?.aborted) {
			console.log("🚫 Multi-intent OpenAI merge aborted");
			return { type: "multi_intent", results, error: "Request aborted during merge" };
		}
		console.error("Multi-intent OpenAI merge failed:", err.message);
		return { type: "multi_intent", results, combinedReply: "Could not merge API results." };
	}
}

module.exports = { handleMultiIntentApis };
