// utils/contextOptimizer.js

/**
 * Builds optimized context for OpenAI prompts
 */
function buildOptimizedContext(session, userMessage) {
	// 🎯 Strategy 1: Only recent history (last 4-6 messages)
	const recentMessages = getRecentMessages(session.history, 6);
	
	// 🎯 Strategy 2: Compress long messages
	const compressedHistory = compressMessages(recentMessages);
	
	// 🎯 Strategy 3: Use last success fields efficiently
	const contextSummary = {
		lastIntent: session.lastSuccessIntent,
		lastUserMsg: session.lastSuccessUserMessage,
		// Don't include full API response - create summary instead
		lastResultSummary: createResponseSummary(
			session.lastSuccessApiResponse,
			session.lastSuccessIntent
		),
		lastParams: session.lastSuccessParams,
	};
	
	// 🎯 Strategy 4: Missing field context (if exists)
	const missingFieldContext = session.missingField?.missingFields?.length ? {
		waitingFor: session.missingField.missingFields,
		forApi: session.missingField.lastMissingApiIntent,
		currentParams: session.missingField.lastParams,
	} : null;
	
	return {
		recentHistory: compressedHistory,
		contextSummary,
		missingFieldContext,
	};
}

/**
 * Get only last N messages from history
 */
function getRecentMessages(history, count = 6) {
	if (!history || history.length === 0) return [];
	return history.slice(-count);
}

/**
 * Compress messages to reduce token usage
 */
function compressMessages(messages) {
	return messages.map(msg => {
		// Keep user messages short
		if (msg.sender === "user") {
			return {
				sender: "user",
				message: msg.message.length > 150 
					? msg.message.substring(0, 150) + "..." 
					: msg.message,
			};
		}
		
		// For bot messages, compress even more aggressively
		if (msg.sender === "bot") {
			// If it's a visualization, just note that
			if (msg.chatType === "visualization") {
				return {
					sender: "bot",
					message: "[Returned visualization]",
					type: "visualization",
				};
			}
			
			// For text responses, keep only first 200 chars
			return {
				sender: "bot",
				message: msg.message?.length > 200 
					? msg.message.substring(0, 200) + "..." 
					: msg.message,
			};
		}
		
		return msg;
	});
}

/**
 * Create compact summary of API response
 * Instead of sending full response data
 */
function createResponseSummary(apiResponse, apiName) {
	if (!apiResponse) return null;
	
	// For array responses
	if (Array.isArray(apiResponse)) {
		const count = apiResponse.length;
		
		// Get sample keys from first item
		const sampleKeys = apiResponse[0] 
			? Object.keys(apiResponse[0]).filter(k => 
				!['id', '_id', 'createdAt', 'updatedAt'].includes(k)
			).slice(0, 3)
			: [];
		
		return `${count} items with fields: ${sampleKeys.join(", ")}`;
	}
	
	// For calculation results
	if (apiResponse.average !== undefined) {
		return `avg: ${apiResponse.average}, count: ${apiResponse.count || 0}`;
	}
	
	if (apiResponse.sum !== undefined) {
		return `total: ${apiResponse.sum}, count: ${apiResponse.count || 0}`;
	}
	
	// Generic object
	const keyCount = Object.keys(apiResponse).length;
	return `${apiName || 'Response'} with ${keyCount} fields`;
}

/**
 * Format context for system prompt
 * Returns a compact string representation
 */
function formatContextForPrompt(context) {
	let prompt = "";
	
	// Recent conversation
	if (context.recentHistory.length > 0) {
		prompt += "Recent conversation:\n";
		context.recentHistory.forEach(msg => {
			prompt += `${msg.sender}: ${msg.message}${msg.type ? ` [${msg.type}]` : ''}\n`;
		});
		prompt += "\n";
	}
	
	// Last successful context
	if (context.contextSummary.lastIntent) {
		prompt += "Last successful interaction:\n";
		prompt += `- API used: ${context.contextSummary.lastIntent}\n`;
		if (context.contextSummary.lastResultSummary) {
			prompt += `- Result: ${context.contextSummary.lastResultSummary}\n`;
		}
		if (context.contextSummary.lastParams) {
			prompt += `- Params: ${JSON.stringify(context.contextSummary.lastParams)}\n`;
		}
		prompt += "\n";
	}
	
	// Missing field context
	if (context.missingFieldContext) {
		prompt += "⚠️ Waiting for missing fields:\n";
		prompt += `- Fields needed: ${context.missingFieldContext.waitingFor.join(", ")}\n`;
		prompt += `- For API: ${context.missingFieldContext.forApi}\n`;
		prompt += `- Current params: ${JSON.stringify(context.missingFieldContext.currentParams)}\n`;
		prompt += "\n";
	}
	
	return prompt;
}

/**
 * Check if current message is likely a refinement
 * Helps avoid unnecessary API calls
 */
function isLikelyRefinement(userMessage, session) {
	if (!session.lastSuccessIntent) return false;
	
	const refinementKeywords = [
		'show', 'display', 'only', 'just', 'exclude', 'remove',
		'filter', 'sort', 'top', 'bottom', 'first', 'last',
		'more', 'less', 'greater', 'higher', 'lower',
	];
	
	const messageLower = userMessage.toLowerCase();
	return refinementKeywords.some(keyword => messageLower.includes(keyword));
}

/**
 * Check if message is providing missing fields
 */
function isProvidingMissingFields(userMessage, session) {
	if (!session.missingField?.missingFields?.length) return false;
	
	// Simple heuristic: short message with numbers/names
	// after bot asked for missing fields
	const hasRecentBotQuestion = session.history.slice(-2).some(
		msg => msg.sender === "bot" && msg.message.includes("?")
	);
	
	return hasRecentBotQuestion && userMessage.length < 50;
}

module.exports = {
	buildOptimizedContext,
	formatContextForPrompt,
	createResponseSummary,
	isLikelyRefinement,
	isProvidingMissingFields,
	getRecentMessages,
	compressMessages,
};