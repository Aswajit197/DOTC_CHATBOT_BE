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

		// 🔹 ULTRA SIMPLIFIED CONTEXT - Just IDs/Names
		contextData: {
			entityData: [String], // e.g., ["4637277dhdh37", "e3729wjw282"] or ["Alex", "John"]
			entityFieldName: { type: String }, // e.g., "driverId" or "driverName"
			entityIntent: { type: String }, // API name that generated this
			entityUserMessage: { type: String }, // Original user query
			entityCount: { type: Number }, // How many entities
			lastUpdated: { type: Date, default: Date.now },
		},

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

// 🔹 Simple method - No complex logic
sessionSchema.methods.updateContext = function (apiName, entityIds, entityFieldName, userMessage) {
	console.log("\n========================================");
	console.log("🔄 UPDATING CONTEXT");
	console.log("========================================");
	console.log("API Name:", apiName);
	console.log("Entity field:", entityFieldName);
	console.log("Entity IDs/Names:", entityIds?.slice(0, 5));
	console.log("Total count:", entityIds?.length);

	if (!entityIds || entityIds.length === 0) {
		console.log("⚠️ No entities to store");
		this.contextData = null;
		return;
	}

	this.contextData = {
		entityData: entityIds, // Just array of IDs or names
		entityFieldName: entityFieldName, // "driverId" or "driverName"
		entityIntent: apiName,
		entityUserMessage: userMessage,
		entityCount: entityIds.length,
		lastUpdated: new Date(),
	};

	console.log("✅ Context saved");
	console.log("========================================\n");
};

module.exports = mongoose.model("Session", sessionSchema);
