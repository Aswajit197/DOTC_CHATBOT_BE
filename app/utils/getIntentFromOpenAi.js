const { OpenAI } = require("openai");
const apiListData = require("../../apiDetails");
const { searchAPIs } = require("./searchEmbeddings");
const getGraphJsonFromLastResponse = require("./getGraphJsonFromLastReponse");
const refineResponseFromLastResponse = require("./refineResponseFromLastResponse");
const { handleParamsForApi } = require("./handleParamsForApis");
const { handleMultiIntentApis } = require("./handleMultiIntentApis");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔹 NEW: Helper to find DriverId from driver name
function findDriverIdByName(driverName, lmdpLists) {
	console.log("\n========================================");
	console.log("🔍 FINDING DRIVER ID BY NAME");
	console.log("========================================");
	console.log("Search Name:", driverName);

	// 🔹 Validation: Check all inputs
	if (!driverName) {
		console.warn("⚠️ Driver name is empty/null/undefined");
		return null;
	}

	if (!lmdpLists || !Array.isArray(lmdpLists)) {
		console.warn("⚠️ lmdpLists is not an array or is undefined");
		return null;
	}

	if (lmdpLists.length === 0) {
		console.warn("⚠️ lmdpLists is empty");
		return null;
	}

	// Trim and lowercase for case-insensitive matching
	const searchName = driverName.trim().toLowerCase();
	console.log("📍 Normalized search name:", searchName);

	// 🔹 Filter out drivers with missing names
	const validDrivers = lmdpLists.filter((driver) => {
		const isValid = driver.driverName && typeof driver.driverName === "string";
		if (!isValid) {
			console.warn(`⚠️ Skipping driver with invalid name: ${JSON.stringify(driver)}`);
		}
		return isValid;
	});

	console.log(`📊 Valid drivers after filtering: ${validDrivers.length}/${lmdpLists.length}`);

	if (validDrivers.length === 0) {
		console.error("❌ No valid drivers found in list");
		return null;
	}

	// 🔹 Match 1: Direct full name match
	console.log("\n🔄 Attempt 1: Direct full name match...");
	const directMatch = validDrivers.find((driver) => driver.driverName.toLowerCase() === searchName);
	if (directMatch) {
		console.log(`✅ MATCH FOUND (Direct): "${directMatch.driverName}" → ID: ${directMatch.driverId}`);
		console.log("========================================\n");
		return directMatch.driverId;
	}
	console.log("❌ No direct match found");

	// 🔹 Match 2: Partial match (e.g., "jordan" matches "Jordan Valecia")
	console.log("\n🔄 Attempt 2: Partial match...");
	const partialMatch = validDrivers.find((driver) => {
		const driverNameLower = driver.driverName.toLowerCase();
		const matches = driverNameLower.includes(searchName);
		if (matches) {
			console.log(`  ✓ "${driverNameLower}" includes "${searchName}"`);
		}
		return matches;
	});
	if (partialMatch) {
		console.log(`✅ MATCH FOUND (Partial): "${partialMatch.driverName}" → ID: ${partialMatch.driverId}`);
		console.log("========================================\n");
		return partialMatch.driverId;
	}
	console.log("❌ No partial match found");

	// 🔹 Match 3: Match individual words (e.g., "jordan valecia" matches "Jordan Valecia")
	console.log("\n🔄 Attempt 3: Word-by-word match...");
	const nameWords = searchName.split(" ").filter((w) => w.length > 0);
	console.log("Search words:", nameWords);

	const wordMatch = validDrivers.find((driver) => {
		const driverWords = driver.driverName.toLowerCase().split(" ");
		console.log(`  Checking "${driver.driverName}" (words: ${driverWords})`);

		const isMatch = nameWords.some((word) => {
			const wordMatches = driverWords.some((dword) => {
				const matches = dword.includes(word) || word.includes(dword);
				if (matches) {
					console.log(`    ✓ "${word}" ↔ "${dword}"`);
				}
				return matches;
			});
			return wordMatches;
		});

		return isMatch;
	});

	if (wordMatch) {
		console.log(`✅ MATCH FOUND (Word-by-word): "${wordMatch.driverName}" → ID: ${wordMatch.driverId}`);
		console.log("========================================\n");
		return wordMatch.driverId;
	}
	console.log("❌ No word match found");

	// 🔹 No match found
	console.error(`\n❌ NO DRIVER FOUND for: "${driverName}"`);
	console.log("Available drivers:");
	validDrivers.forEach((driver) => {
		console.log(`  - "${driver.driverName}" (ID: ${driver.driverId})`);
	});
	console.log("========================================\n");

	return null;
}


// 🔹 NEW: Helper to check if API requires driver/lmdp identification
function doesApiRequireDriverId(matchedApi) {
	if (!matchedApi) return false;
	const driverRelatedFields = ["DriverId", "driverId", "LMDPId"];
	return matchedApi.requiredFields?.some((field) => driverRelatedFields.some((drf) => drf.toLowerCase() === field.toLowerCase()));
}


// 🔹 NEW: Helper to extract driver names from user message using OpenAI
async function extractDriverNamesFromMessage(userMessage) {
	console.log("\n========================================");
	console.log("🔍 DRIVER NAME EXTRACTION STARTING");
	console.log("========================================");
	console.log("Input Message:", userMessage);
	console.log("Message Length:", userMessage.length);

	try {
		const prompt = `
Extract person names (driver names) from this message. Return ONLY valid names, not common words or acronyms.

Message: "${userMessage}"

Return a JSON array of names found:
["Name1", "Name2"]

If no names found, return empty array: []

Examples:
- "Give me hours for jordan valecia" → ["jordan valecia"]
- "Show me preferences for alex and john" → ["alex", "john"]
- "What about anthony semidey's schedule" → ["anthony semidey"]
- "List all drivers" → []
- "Show API details" → []

IMPORTANT: Return ONLY the JSON array in this exact format: ["name1", "name2"]
Do NOT include any explanations, code blocks, or extra text.
`;

		console.log("\n📝 Prompt sent to OpenAI:");
		console.log(prompt);

		console.log("\n⏳ Calling gpt-3.5-turbo for name extraction...");
		const completion = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
			max_tokens: 100,
		});

		const rawResponse = completion.choices[0].message.content;
		console.log("\n✅ Raw OpenAI Response:");
		console.log("Response:", rawResponse);
		console.log("Response Type:", typeof rawResponse);
		console.log("Response Length:", rawResponse.length);

		const trimmedResponse = rawResponse.trim();
		console.log("\n📍 After trim:", trimmedResponse);

		// 🔹 NEW: Handle markdown code blocks
		let cleanResponse = trimmedResponse;
		if (trimmedResponse.includes("```json")) {
			console.log("⚠️ Response contains ```json block, extracting content...");
			cleanResponse = trimmedResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
		} else if (trimmedResponse.includes("```")) {
			console.log("⚠️ Response contains ``` block, extracting content...");
			cleanResponse = trimmedResponse.replace(/```\n?/g, "").trim();
		}

		console.log("📍 After cleanup:", cleanResponse);

		// 🔹 NEW: Validate JSON before parsing
		if (!cleanResponse.startsWith("[")) {
			console.warn("⚠️ Response does not start with '[', checking for JSON content...");
			const jsonMatch = cleanResponse.match(/\[.*\]/s);
			if (jsonMatch) {
				cleanResponse = jsonMatch[0];
				console.log("📍 Extracted JSON array:", cleanResponse);
			} else {
				console.error("❌ No JSON array found in response");
				return [];
			}
		}

		console.log("\n🔄 Attempting to parse JSON...");
		let names;
		try {
			names = JSON.parse(cleanResponse);
			console.log("✅ Successfully parsed JSON");
		} catch (parseErr) {
			console.error("❌ JSON parse failed:", parseErr.message);
			console.error("Attempted to parse:", cleanResponse);
			return [];
		}

		console.log("📦 Parsed names:", names);
		console.log("Is Array:", Array.isArray(names));
		console.log("Array Length:", Array.isArray(names) ? names.length : "N/A");

		if (!Array.isArray(names)) {
			console.warn("⚠️ Response is not an array, converting...");
			names = Array.isArray(names) ? names : [];
		}

		// 🔹 NEW: Validate each name
		const validNames = names.filter((name) => {
			const isValid = typeof name === "string" && name.trim().length > 0;
			console.log(`  - "${name}" → Valid: ${isValid}`);
			return isValid;
		});

		console.log("\n✅ FINAL EXTRACTED NAMES:", validNames);
		console.log("========================================\n");

		return validNames;
	} catch (err) {
		console.error("\n❌ CRITICAL ERROR in name extraction:");
		console.error("Error Type:", err.name);
		console.error("Error Message:", err.message);
		console.error("Error Stack:", err.stack);
		console.log("========================================\n");
		return [];
	}
}


// 🔹function for driver name matching
async function getIntentFromOpenAI(userMessage, session, { onStream, abortSignal } = {}) {
	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Already aborted, exiting early");
		return { error: "Request aborted" };
	}

	const topApis = await searchAPIs(userMessage);

	// 🔹 Build context information for the prompt
	const hasContext = session.contextHistory?.length > 0;
	const contextInfo = hasContext
		? `

### 🎯 ROLLING CONTEXT HISTORY (IMPORTANT!)
The user has a conversation history with previous queries:

${session.getContextSummary()}

**CRITICAL CONTEXTUAL REFERENCE RULES:**
A query is ONLY contextual_followup if it meets ALL these conditions:
1. Context history EXISTS (not empty)
2. Uses explicit reference words like: "they", "them", "their", "these", "those", "the same", "above", "previous", "last", "that", "it"
3. The reference word MUST directly refer to entities from previous results
4. The query CANNOT work standalone without previous context

**Examples of TRUE contextual_followup:**
- Previous: "Give me 10 drivers"
  Current: "Give me their weekly working hours" ✅ (uses "their" referring to those 10 drivers)
- Previous: "give me details for alex and john"
  Current: "What are their weekly preference hours?" ✅ (uses "their")
- Previous: "List all drivers"
  Current: "Show me hours for the above drivers" ✅ (uses "above")
- Previous: "Get driver details"
  Current: "Give me weekly hours for previous drivers" ✅ (uses "previous")

**Examples of FALSE contextual_followup (independent queries):**
- Previous: "Give me 10 drivers"
  Current: "Give me drivers time off requests" ❌ (no reference word, asks for ALL drivers)
- Previous: "Show me drivers"
  Current: "Get all driver schedules" ❌ (no reference word, independent query)
- Previous: "List drivers"
  Current: "Show driver overtime preferences" ❌ (no reference to previous results)
- Current: "Give me hours for drivers" ❌ (generic query, no specific reference)

**Key distinction:**
- "Give me their hours" → contextual (refers to specific previous entities)
- "Give me driver hours" → independent (general query for all drivers)
`
		: `
### ⚠️ NO CONTEXT AVAILABLE
There is NO conversation history. Therefore:
- This query CANNOT be contextual_followup
- Treat as independent query regardless of pronouns used
`;

	// 🔹 NO LMDP LIST IN PROMPT: Driver name extraction is now handled post-processing by OpenAI
	// This saves tokens and keeps prompt clean

	const systemPrompt = `
You are an assistant that maps user queries to API operations.

Available APIs:
${topApis
	.map(
		(api, i) =>
			`${i + 1}. ${api.name}: ${api.description}
	 Required fields: ${api.requiredFields && api.requiredFields.length ? api.requiredFields.join(", ") : "None"}`
	)
	.join("\n")}

Session context:
- Last successful user message: ${session.lastSuccessUserMessage || "None"}
- Last successful API intent: ${session.lastSuccessIntent || "None"}
- Last missing field bot message: ${session?.missingField?.lastMissingFieldBotMessage || "None"}
- Last missing API intent: ${session?.missingField?.lastMissingApiIntent || "None"}
- Last known missing fields: ${session?.missingField?.missingFields?.join(", ") || "None"}
- Last known params: ${JSON.stringify(session?.missingField?.lastParams || "")}
${contextInfo}

Current user message:
"${userMessage}"

Instructions:
- Decide the intent type: **independent**, **contextual_followup**, **dependent**, **multi_intent**, **missing field resolution**, or **visualization follow-up**.

### 🚨 CRITICAL PARAMETER EXTRACTION RULES:

**PARAMETER NULLIFICATION RULE:**
- If a parameter CANNOT be resolved/extracted from the user message, set it to **null** (NOT empty object {})
- Only include resolved parameters in the params object
- Unresolved parameters should be null

❌ DO NOT auto-fill or assume ANY parameters (except for driver name matching below)
❌ DO NOT default ClientId, StationId, or any other field
❌ DO NOT extract parameters from context unless explicitly referenced
❌ DO NOT invent values based on previous queries
❌ DO NOT use empty objects {} for unresolved parameters - use null instead

✅ ONLY extract if the user literally says it: "driver 1234", "station 5", "client 2"
✅ Leave params empty {} if nothing is explicitly mentioned
✅ Set unresolved required fields to null
✅ Missing field handling is done separately - your job is ONLY extraction
✅ IF API REQUIRES DriverId AND user mentions a driver BY NAME → set DriverId to null (post-processing will handle name matching)

**Examples:**
- "Give me 15 drivers" → params: {} (no specific IDs mentioned)
- "Show driver 1234" → params: { DriverId: 1234 }
- "List drivers for station 5" → params: { StationId: 5 }
- "Give me day preference for Jordan Valecia" → params: { DriverId: null } (name will be matched post-processing)
- "Show hours for john smith" → params: { DriverId: null } (name will be matched post-processing)
- "Get overtime for driver 123" → params: { DriverId: 123 } (explicit numeric ID)
- "Give me their hours" → params: {} (context-based, no explicit params)
- API needs ClientId but not provided → { ClientId: null }
- API needs DriverId but name not provided → { DriverId: null }

### 1. Contextual Follow-up (HIGHEST PRIORITY - CHECK CAREFULLY!)
**⚠️ CRITICAL: Only classify as contextual_followup if ALL conditions are met:**

**REQUIRED CONDITIONS (ALL MUST BE TRUE):**
1. ✅ Context history EXISTS (session has previous queries)
2. ✅ Message contains explicit reference words:
   - Pronouns: "they", "them", "their", "theirs"
   - Demonstratives: "these", "those", "that"
   - References: "the same", "above", "previous", "last", "it"
3. ✅ The reference word DIRECTLY refers to entities from previous results
4. ✅ Query CANNOT stand alone without previous context

**If ANY condition fails → classify as independent, NOT contextual_followup**

**⚠️ COMMON FALSE POSITIVES TO AVOID:**
❌ "Give me drivers time off requests" → independent (no reference word)
❌ "Show all driver schedules" → independent (generic, not referring to previous)
❌ "Get driver overtime preferences" → independent (general query)
❌ "List driver hours" → independent (no specific reference)

**✅ TRUE CONTEXTUAL EXAMPLES:**
✅ "Give me their hours" (refers to specific previous drivers)
✅ "Show me details for those drivers" (uses "those")
✅ "What about the previous drivers?" (uses "previous")
✅ "Get hours for above drivers" (uses "above")

**If contextual_followup:**
→ Return JSON in this format:
{
  "apiName": "<exact API name that provides the requested data>",
  "params": {},
  "dependent": false,
  "type": "contextual_followup",
  "contextualReference": true
}

### 2. Independent (Single Intent)
If Independent (Fresh query with no reference to previous results OR no context exists):
   * Identify the most appropriate API from the Available APIs list.
   * Extract parameters ONLY if EXPLICITLY mentioned in the message.
   * Set unresolved parameters to null (NOT empty objects)
   * DO NOT assume or auto-fill ANY values.
   * If API requires DriverId but user mentions a driver BY NAME → set DriverId to null (post-processing will extract and match the name)

**⚠️ SINGLE API WITH CALCULATIONS/AGGREGATIONS:**
If the query asks for data from ONE API with additional processing (filtering, calculations, averages, specific items):
- "show OT preference for driver X and calculate average" → **SINGLE INTENT** (one API, post-process)
- "get driver hours and calculate total" → **SINGLE INTENT** (one API, post-process)
- "list drivers and show count" → **SINGLE INTENT** (one API, post-process)
- "give me OT preference for one driver and average of all drivers" → **SINGLE INTENT** (one API, post-process)

**Common patterns for independent queries:**
- "Give me X drivers"
- "Show driver Y"
- "List all drivers with Z"
- "Get driver schedules"
- Any query without reference words (their/those/previous/etc.)

→ Return JSON:
{
  "apiName": "<exact API name from above>",
  "params": { /* ONLY explicitly mentioned params, unresolved = null */ },
  "dependent": false,
  "type": "independent"
}

### 3. Multi-Intent Case
If the user message clearly requires **TWO OR MORE COMPLETELY DIFFERENT APIs** that fetch different types of data:

**✅ TRUE Multi-Intent Examples:**
- "list all drivers AND their shift details" → (DriverList API + ShiftDetails API)
- "show drivers AND their time off requests" → (DriverList API + TimeOffRequests API)
- "get driver info AND their overtime history" → (DriverInfo API + OvertimeHistory API)

**❌ NOT Multi-Intent (Single API with post-processing):**
- "show OT preference for one driver and calculate average" → SINGLE API (get all OT preferences, then process)
- "list drivers and show their count" → SINGLE API (get drivers, count is post-processing)
- "get driver hours and calculate total" → SINGLE API (get hours, sum is post-processing)

**Key Rule:** 
- Use multi_intent ONLY if you need to call DIFFERENT APIs for DIFFERENT data types
- If ONE API provides all the data needed (even if user wants calculations/filtering), use **independent**

→ Return JSON (ONLY for true multi-intent):
{
  "apis": [
	{ "apiName": "<exact API name from above>", "params": { /* unresolved = null */ } },
	{ "apiName": "<another DIFFERENT API name>", "params": { /* unresolved = null */ } }
  ],
  "dependent": false,
  "type": "multi_intent"
}

**CRITICAL:** If only **one API** provides all the necessary data, treat as **single independent intent**, NOT multi_intent.


### 4. Visualization Follow-up
If the user message is a short confirmation (examples: "yes", "yeah", "sure", "ok", "give me a chart", "show me a graph")
AND the prior assistant message ended with a graph/chart offer:

→ Return JSON:
{
  "apiName": null,
  "params": {},
  "dependent": true,
  "type": "visualization_request"
}

### 5. Dependent (General Refinements)
If the user message modifies the LAST response (not referencing previous entities, but refining output):
- Filtering: "only show approved", "exclude declined"
- Reformatting: "show as table", "sort by name"
- Adjusting display: "remove StartDate column"

→ Return JSON:
{
  "apiName": "<exact API name from above>",
  "params": {},
  "dependent": true,
  "type": "refinement_request"
}

### 6. Missing Field Resolution
If the previous bot response asked for missing fields AND the current message provides those values:

→ Return JSON:
{
  "apiName": "<exact API name from session.lastMissingApiIntent>",
  "params": { /* merge session.missingField.lastParams with new values, unresolved = null */ },
  "dependent": false,
  "type": "handle_missing_field"
}

### 7. Casual / Not Related
If casual, small talk, or not related to any API:
{
  "apiName": null,
  "params": {},
  "dependent": false
}

**CRITICAL DECISION TREE:**
1. ⚠️ Check if context history exists → if NO, skip to step 3
2. ⚠️ Check for EXPLICIT contextual reference words (their/those/previous/last/above) AND refers to previous entities → contextual_followup
3. Check for visualization request → visualization_request
4. Check for missing field resolution → handle_missing_field
5. Check for refinement of last response → refinement_request
6. ⚠️ Check if query needs MULTIPLE DIFFERENT APIs for DIFFERENT data → multi_intent
7. Otherwise → independent (including single API with calculations/aggregations)

**REMEMBER:**
- Without context history → ALWAYS independent
- Without explicit reference words → ALWAYS independent
- Generic queries like "give me driver X" → ALWAYS independent
- Only use contextual_followup when user explicitly refers to previous results

**KEY DISTINCTIONS:**
- "Show X and Y from the SAME API" → independent (single data source)
- "Show X from API1 and Y from API2" → multi_intent (different data sources)
- Presence of "and" does NOT automatically mean multi_intent!

Important:
- DO NOT explain your reasoning.
- DO NOT add comments or extra text.
- Output valid JSON only.
- Be STRICT about contextual_followup classification!
- Be STRICT about multi_intent vs independent with processing!
- **ALWAYS set unresolved parameters to null, NEVER use empty objects {}**
`;

	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Aborted before OpenAI completion call");
		return { error: "Request aborted" };
	}

	let completion;
	try {
		completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
			temperature: 0,
		});
	} catch (error) {
		if (error.name === "AbortError" || abortSignal?.aborted) {
			console.log("🚫 OpenAI completion call was aborted");
			return { error: "Request aborted" };
		}
		throw error;
	}

	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Aborted after OpenAI completion");
		return { error: "Request aborted" };
	}

	let extracted;
	console.log(extracted, "extracted in getIntentFrom Open AI Function");
	try {
		extracted = JSON.parse(completion.choices[0].message.content.trim());
	} catch (err) {
		console.error("Failed to parse OpenAI response:", err);
		return { error: "OpenAI parsing failed" };
	}

	// 🔹 POST-PROCESSING VALIDATION: Enforce contextual rules
	if (extracted.type === "contextual_followup") {
		if (!hasContext) {
			console.log("⚠️ OVERRIDE: No context history exists, changing to independent");
			extracted.type = "independent";
			extracted.contextualReference = false;
		} else {
			// Check for explicit reference words
			const referenceWords = /\b(they|them|their|theirs|these|those|that|above|previous|last|the same|it)\b/i;
			if (!referenceWords.test(userMessage)) {
				console.log("⚠️ OVERRIDE: No reference words found, changing to independent");
				extracted.type = "independent";
				extracted.contextualReference = false;
			}
		}
	}

	// 🔹 NEW: Post-processing for driver name matching
	const matchedApi = apiListData.find((api) => api.name === extracted.apiName);
	if (
		matchedApi &&
		doesApiRequireDriverId(matchedApi) &&
		session.lmdpLists?.length > 0 &&
		extracted.params &&
		extracted.params.DriverId === null
	) {
		console.log("\n🔍 Attempting to match driver name from message...");
		const driverNames = await extractDriverNamesFromMessage(userMessage);
		console.log("Extracted potential names:", driverNames);

		if (driverNames.length > 0) {
			// Try to find driver ID by name
			const driverId = findDriverIdByName(driverNames[0], session.lmdpLists);
			if (driverId) {
				extracted.params.DriverId = driverId;
				console.log(`✅ Matched driver: "${driverNames[0]}" → DriverId: ${driverId}`);
			} else {
				console.log(`⚠️ No driver match found for: "${driverNames[0]}"`);
			}
		}
	}

	console.log("\n========================================");
	console.log("🎯 INTENT EXTRACTION RESULT");
	console.log("========================================");
	console.log("Type:", extracted.type);
	console.log("API:", extracted.apiName);
	console.log("Params:", JSON.stringify(extracted.params));
	console.log("Contextual:", extracted.contextualReference || false);
	console.log("Has Context:", hasContext);
	console.log("========================================\n");

	let params = extracted.params || {};

	if (abortSignal?.aborted) {
		console.log("🚫 getIntentFromOpenAI: Aborted before processing");
		return { error: "Request aborted" };
	}

	// 🔹 Handle contextual followup
	if (extracted.type === "contextual_followup" && extracted.contextualReference) {
		console.log("\n🎯 CONTEXTUAL FOLLOW-UP DETECTED");
		console.log("Will use rolling context history for filtering");

		if (!matchedApi) {
			return { error: "No API matched for contextual followup" };
		}

		// Proceed with matched API and param handling
		const {
			params: finalParams,
			missingFields,
			formattedReply,
		} = await handleParamsForApi(matchedApi, params, userMessage, session, { onStream, abortSignal });

		params = finalParams;

		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		if (formattedReply) {
			return {
				api: matchedApi,
				params,
				formattedReply,
			};
		}

		if (missingFields.length) {
			const fallbackHelpPrompt = `
You are a helpful assistant for a Driver Management platform.
The user said: "${userMessage}"
You are about to call the API: "${matchedApi.name}".
This API requires the following fields: ${matchedApi.requiredFields.join(", ")}.

Already provided/handled fields should NOT be asked again.
The only missing fields are: ${missingFields.join(", ")}.

Your task:
- Politely ask ONLY for the missing fields.
- Respond in plain text, friendly tone.
`;

			let fallbackResponse;
			try {
				fallbackResponse = await openai.chat.completions.create({
					model: "gpt-3.5-turbo",
					messages: [{ role: "system", content: fallbackHelpPrompt }],
					temperature: 0.7,
				});
			} catch (error) {
				if (error.name === "AbortError" || abortSignal?.aborted) {
					return { error: "Request aborted" };
				}
				throw error;
			}

			const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

			return {
				error: "Missing required fields",
				requires: missingFields,
				params,
				api: matchedApi,
				fallbackMessage,
			};
		}

		// Call API with isContextual flag
		try {
			console.log(matchedApi.name, "matched api (contextual)");

			const apiResponse = await matchedApi.handler(
				params,
				userMessage,
				session,
				onStream,
				abortSignal,
				true // 🔹 isContextual = true
			);

			if (abortSignal?.aborted) {
				return { error: "Request aborted" };
			}

			return {
				api: matchedApi,
				params,
				formattedReply: apiResponse?.userReply,
				filterParams: apiResponse?.filterParams,
			};
		} catch (err) {
			if (err.name === "AbortError" || abortSignal?.aborted) {
				return { error: "Request aborted" };
			}
			console.error("API handler error:", err);
			return { error: "API execution failed" };
		}
	}

	// Handle multi-intent
	if (extracted?.type === "multi_intent") {
		console.log("Entering In multi intent....");
		return await handleMultiIntentApis(extracted, userMessage, session, { onStream, abortSignal });
	}

	// Handle dependent cases
	if (extracted.dependent) {
		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		if (extracted.type === "visualization_request") {
			return await getGraphJsonFromLastResponse(userMessage, session, { onStream, abortSignal });
		} else if (extracted.type === "refinement_request") {
			if (session.lastSuccessApiResponse && session.lastSuccessIntent === matchedApi?.name) {
				return await refineResponseFromLastResponse(userMessage, session, { onStream, abortSignal });
			} else {
				extracted.dependent = false;
				extracted.type = null;
			}
		} else {
			extracted.dependent = false;
			extracted.type = null;
		}
	}

	// Fallback case: No matching API
	if (!matchedApi || extracted.apiName === null) {
		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		const fallbackPrompt = `
The user sent this message: "${userMessage}"

You're a helpful assistant for a LMDP and DELIVERY MANAGEMENT PLATFORM.

1. If this is a casual message (greeting/small talk), respond politely and naturally.
2. If it's related to drivers/platform, explain what you can help with.

DO NOT make up any new APIs. Just respond in a helpful and conversational tone.
Respond ONLY with plain text.
`;

		let fallbackResponse;
		try {
			fallbackResponse = await openai.chat.completions.create({
				model: "gpt-3.5-turbo",
				messages: [{ role: "system", content: fallbackPrompt }],
				temperature: 0.7,
			});
		} catch (error) {
			if (error.name === "AbortError" || abortSignal?.aborted) {
				return { error: "Request aborted" };
			}
			throw error;
		}

		const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

		return {
			error: "No API matched",
			fallbackMessage,
		};
	}

	if (abortSignal?.aborted) {
		return { error: "Request aborted" };
	}

	// Proceed with matched API and param handling
	const {
		params: finalParams,
		missingFields,
		formattedReply,
	} = await handleParamsForApi(matchedApi, params, userMessage, session, { onStream, abortSignal });

	params = finalParams;

	if (abortSignal?.aborted) {
		return { error: "Request aborted" };
	}

	if (formattedReply) {
		return {
			api: matchedApi,
			params,
			formattedReply,
		};
	}

	if (missingFields.length) {
		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		const fallbackHelpPrompt = `
You are a helpful assistant for a Driver Management platform.
The user said: "${userMessage}"
You are about to call the API: "${matchedApi.name}".
This API requires the following fields: ${matchedApi.requiredFields.join(", ")}.

Already provided/handled fields should NOT be asked again.
The only missing fields are: ${missingFields.join(", ")}.

Your task:
- Politely ask ONLY for the missing fields.
- Respond in plain text, friendly tone.
`;

		let fallbackResponse;
		try {
			fallbackResponse = await openai.chat.completions.create({
				model: "gpt-3.5-turbo",
				messages: [{ role: "system", content: fallbackHelpPrompt }],
				temperature: 0.7,
			});
		} catch (error) {
			if (error.name === "AbortError" || abortSignal?.aborted) {
				return { error: "Request aborted" };
			}
			throw error;
		}

		const fallbackMessage = fallbackResponse.choices[0].message.content.trim();

		return {
			error: "Missing required fields",
			requires: missingFields,
			params,
			api: matchedApi,
			fallbackMessage,
		};
	}

	if (abortSignal?.aborted) {
		return { error: "Request aborted" };
	}

	// All fields ready → call API
	try {
		console.log(matchedApi.name, "matched api");
		const apiResponse = await matchedApi.handler(
			params,
			userMessage,
			session,
			onStream,
			abortSignal,
			false // 🔹 isContextual = false (independent query)
		);

		if (abortSignal?.aborted) {
			return { error: "Request aborted" };
		}

		return {
			api: matchedApi,
			params,
			formattedReply: apiResponse?.userReply,
			userMessage,
			filterParams: apiResponse?.filterParams,
		};
	} catch (err) {
		if (err.name === "AbortError" || abortSignal?.aborted) {
			return { error: "Request aborted" };
		}
		console.error("API handler error:", err);
		return { error: "API execution failed" };
	}
}

module.exports = getIntentFromOpenAI;
