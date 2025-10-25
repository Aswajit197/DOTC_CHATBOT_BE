const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
	{
		userId: { type: String, required: true },
		ClientId: { type: String, required: true },
		StationId: { type: String },
		sessionName: { type: String },
		history: [
			{
				sender: String,
				message: String,
				chatType: String,
				data: { type: mongoose.Schema.Types.Mixed },
				graphContents: {
					lastGraphPrompt: { type: String },
					lastGraphResponse: { type: String },
					lastGraphParams: { type: mongoose.Schema.Types.Mixed },
					lastIntentType: { type: String, enum: ["single", "multi"], default: "single" },
					graphType: { type: String, default: "bar" },
				},
				timestamp: Date,
			},
		],

		lastResponseMessage: { type: String },
		lastSuccessUserMessage: { type: String },
		lastSuccessIntent: { type: String },
		lastSuccessApiResponse: { type: mongoose.Schema.Types.Mixed },
		lastSuccessParams: { type: mongoose.Schema.Types.Mixed },

		// 🔹 ROLLING CONTEXT HISTORY - Last 5 queries
		contextHistory: [
			{
				entityData: [String], // e.g., [1482, 1488, 1497] or ["Alex", "John"]
				entityFieldName: { type: String }, // e.g., "driverId" or "driverName"
				entityType: { type: String }, // e.g., "drivers", "shifts", "days"
				entityIntent: { type: String }, // API name
				entityUserMessage: { type: String }, // Original query
				entityCount: { type: Number },
				timestamp: { type: Date, default: Date.now },
			},
		],

		missingField: {
			lastMissingFieldBotMessage: { type: String },
			lastMissingApiIntent: { type: String },
			lastParams: { type: mongoose.Schema.Types.Mixed },
			missingFields: [{ type: String }],
		},

		createdAt: {
			type: Date,
			default: Date.now,
			expires: 5 * 60 * 60 * 24,
		},
	},
	{ timestamps: true }
);

// 🔹 Add context to rolling history (keep last 5)
sessionSchema.methods.addToContextHistory = function (apiName, entityIds, entityFieldName, entityType, userMessage) {
	console.log("\n========================================");
	console.log("🔄 ADDING TO CONTEXT HISTORY");
	console.log("========================================");
	console.log("API Name:", apiName);
	console.log("Entity type:", entityType);
	console.log("Entity field:", entityFieldName);
	console.log("Entity count:", entityIds?.length);

	if (!entityIds || entityIds.length === 0) {
		console.log("⚠️ No entities to store");
		return;
	}

	const newContext = {
		entityData: entityIds,
		entityFieldName: entityFieldName,
		entityType: entityType,
		entityIntent: apiName,
		entityUserMessage: userMessage,
		entityCount: entityIds.length,
		timestamp: new Date(),
	};

	// Add to beginning of array
	this.contextHistory.unshift(newContext);

	// Keep only last 5 contexts
	if (this.contextHistory.length > 5) {
		this.contextHistory = this.contextHistory.slice(0, 5);
	}

	console.log("✅ Context added to history");
	console.log("Total contexts in history:", this.contextHistory.length);
	console.log("========================================\n");
};

// 🔹 Get most recent context
sessionSchema.methods.getMostRecentContext = function () {
	return this.contextHistory && this.contextHistory.length > 0 ? this.contextHistory[0] : null;
};

// 🔹 Get context by entity type (e.g., "drivers", "shifts")
sessionSchema.methods.getContextByType = function (entityType) {
	if (!this.contextHistory || this.contextHistory.length === 0) return null;
	return this.contextHistory.find((ctx) => ctx.entityType === entityType) || null;
};

// 🔹 Get all contexts as formatted string for AI
sessionSchema.methods.getContextSummary = function () {
	if (!this.contextHistory || this.contextHistory.length === 0) {
		return "No previous context available.";
	}

	return this.contextHistory
		.map((ctx, idx) => {
			return `
${idx + 1}. ${ctx.entityIntent} (${ctx.entityType})
   - User asked: "${ctx.entityUserMessage}"
   - Returned: ${ctx.entityCount} items
   - Field: ${ctx.entityFieldName}
   - Sample values: ${ctx.entityData.slice(0, 5).join(", ")}${ctx.entityData.length > 5 ? "..." : ""}
   - Timestamp: ${new Date(ctx.timestamp).toLocaleString()}`;
		})
		.join("\n");
};

// 🔹 Clear old contexts (optional - for cleanup)
sessionSchema.methods.clearOldContexts = function (olderThanMinutes = 30) {
	if (!this.contextHistory || this.contextHistory.length === 0) return;

	const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);
	this.contextHistory = this.contextHistory.filter((ctx) => new Date(ctx.timestamp) > cutoffTime);
};

module.exports = mongoose.model("Session", sessionSchema);
