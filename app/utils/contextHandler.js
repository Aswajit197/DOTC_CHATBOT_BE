const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Detects if the user is referencing entities from previous queries
 * using pronouns like "they", "them", "their", "these", "those"
 */
async function detectContextualReference(userMessage, session) {
	// Quick pattern matching first (fast path)
	const referentialPatterns = [
		/\b(they|them|their|theirs|these|those)\b/i,
		/\b(the same|above|previous|last)\b/i,
		/^(give|show|list|get|find)\s+(me\s+)?(their|its|the)\b/i,
	];

	const hasReferentialWord = referentialPatterns.some((pattern) => pattern.test(userMessage));

	if (!hasReferentialWord || !session.contextData?.lastEntities?.length) {
		return {
			isContextual: false,
			contextualEntities: null,
		};
	}

	// Use AI to confirm contextual reference (only if patterns match)
	try {
		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{
					role: "system",
					content: `You analyze if a user message references entities from a previous query.

**Previous Query Context:**
- Entity Type: ${session.contextData.lastEntityType || "unknown"}
- Entity Count: ${session.contextData.lastEntityCount || 0}
- Last Intent: ${session.lastSuccessIntent || "none"}
- Sample Entities: ${session.contextData.lastEntities
						?.slice(0, 3)
						.map((e) => e.name)
						.join(", ")}

**Your Task:**
Determine if the current message refers to these previous entities using words like:
- Pronouns: "they", "them", "their"
- Demonstratives: "these", "those"
- References: "the same", "above", "previous", "last"

**Response Format (JSON only):**
{
  "isContextual": boolean,
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation"
}`,
				},
				{
					role: "user",
					content: `Current message: "${userMessage}"

Does this refer to the previous ${session.contextData.lastEntityCount} ${session.contextData.lastEntityType}?`,
				},
			],
			temperature: 0.1,
			response_format: { type: "json_object" },
		});

		const result = JSON.parse(response.choices[0].message.content);

		console.log("🔍 Contextual Reference Detection:", {
			isContextual: result.isContextual,
			confidence: result.confidence,
			entityType: session.contextData.lastEntityType,
			entityCount: session.contextData.lastEntityCount,
		});

		return {
			isContextual: result.isContextual && result.confidence !== "low",
			contextualEntities: result.isContextual ? session.contextData.lastEntities : null,
			confidence: result.confidence,
		};
	} catch (error) {
		console.error("❌ Context detection failed:", error.message);
		// Fallback: use pattern matching result
		return {
			isContextual: hasReferentialWord,
			contextualEntities: session.contextData.lastEntities,
			confidence: "low",
		};
	}
}

/**
 * Filters API response data based on contextual entities
 */
function filterByContext(apiResponse, contextualEntities, entityType) {
	if (!Array.isArray(apiResponse) || !contextualEntities?.length) {
		return apiResponse;
	}

	// Extract IDs and names from context
	const contextIds = new Set(contextualEntities.map((e) => e.id).filter((id) => id !== undefined && id !== null));
	const contextNames = new Set(contextualEntities.map((e) => e.name?.toLowerCase().trim()).filter(Boolean));

	console.log("🔍 Filtering with context:", {
		contextIds: Array.from(contextIds).slice(0, 5), // Show first 5 for brevity
		contextNames: Array.from(contextNames).slice(0, 5),
		contextIdsCount: contextIds.size,
		contextNamesCount: contextNames.size,
		entityType,
	});

	// Filter the response
	const filtered = apiResponse.filter((item) => {
		// 🔹 PRIORITY 1: Match by ID (most reliable)
		// Check all possible ID fields
		if (item.driverId !== undefined && contextIds.has(item.driverId)) return true;
		if (item.shiftId !== undefined && contextIds.has(item.shiftId)) return true;
		if (item.stationId !== undefined && contextIds.has(item.stationId)) return true;
		if (item.id !== undefined && contextIds.has(item.id)) return true;

		// 🔹 PRIORITY 2: Fallback to name matching (less reliable)
		const itemName = (item.driverName || item.name || item.description || item.title || "").toLowerCase().trim();

		if (itemName && contextNames.has(itemName)) return true;

		return false;
	});

	console.log(`✅ Filtered ${apiResponse.length} items → ${filtered.length} items`);

	// 🔹 If filtering resulted in 0 items, return original data (safety fallback)
	if (filtered.length === 0) {
		console.warn("⚠️ Context filtering returned 0 items - returning original data");
		return apiResponse;
	}

	return filtered;
}

module.exports = {
	detectContextualReference,
	filterByContext,
};
