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

		// Last successful bot response, API response etc...
		lastResponseMessage: { type: String },
		lastSuccessUserMessage: { type: String },
		lastSuccessIntent: { type: String },
		lastSuccessApiResponse: { type: mongoose.Schema.Types.Mixed },
		lastSuccessParams: { type: mongoose.Schema.Types.Mixed },

		// 🔹 NEW: Context tracking for referential queries
		contextData: {
			// Entities from the last query (drivers, items, etc.)
			lastEntities: [
				{
					type: { type: String }, // e.g., "driver", "shift", "station"
					id: mongoose.Schema.Types.Mixed, // driver ID, shift ID, etc.
					name: String, // display name
					data: { type: mongoose.Schema.Types.Mixed }, // full entity data if needed
				},
			],
			// Track what was being discussed
			lastEntityType: { type: String }, // "drivers", "shifts", "stations"
			lastEntityCount: { type: Number }, // how many entities were in the result
			// Intent chain for multi-step queries
			intentChain: [
				{
					intent: String,
					timestamp: Date,
					entityType: String,
				},
			],
			lastUpdated: { type: Date, default: Date.now },
		},

		// Missing field context
		missingField: {
			lastMissingFieldBotMessage: { type: String },
			lastMissingApiIntent: { type: String },
			lastParams: { type: mongoose.Schema.Types.Mixed },
			missingFields: [{ type: String }],
		},

		createdAt: {
			type: Date,
			default: Date.now,
			expires: 5 * 60 * 60 * 24, // 5 * 24 hours
		},
	},
	{ timestamps: true }
);

// Helper method to update context after successful query
sessionSchema.methods.updateContext = function (apiName, apiResponse, entityType = null) {
	// Auto-detect entity type from API name if not provided
	if (!entityType) {
		if (apiName.toLowerCase().includes("driver")) entityType = "drivers";
		else if (apiName.toLowerCase().includes("shift")) entityType = "shifts";
		else if (apiName.toLowerCase().includes("station")) entityType = "stations";
	}

	// Extract entities from response
	const entities = [];
	if (Array.isArray(apiResponse)) {
		apiResponse.forEach((item) => {
			// 🔹 CRITICAL: Always prioritize actual ID fields over names
			const entityId = item.driverId || item.shiftId || item.stationId || item.id;
			const entityName = item.driverName || item.name || item.description || item.title;

			// Only add if we have a valid ID
			if (entityId !== undefined && entityId !== null) {
				entities.push({
					type: entityType,
					id: entityId, // ✅ This must be the numeric/unique ID
					name: entityName, // This is for display only
					data: item,
				});
			}
		});
	}

	this.contextData = {
		lastEntities: entities,
		lastEntityType: entityType,
		lastEntityCount: entities.length,
		intentChain: [
			...(this.contextData?.intentChain || []).slice(-4), // Keep last 5 intents
			{
				intent: apiName,
				timestamp: new Date(),
				entityType,
			},
		],
		lastUpdated: new Date(),
	};
};

// Helper method to get contextual entity IDs
sessionSchema.methods.getContextualEntityIds = function () {
	return this.contextData?.lastEntities?.map((e) => e.id) || [];
};

// Helper method to get contextual entity names
sessionSchema.methods.getContextualEntityNames = function () {
	return this.contextData?.lastEntities?.map((e) => e.name) || [];
};

module.exports = mongoose.model("Session", sessionSchema);
