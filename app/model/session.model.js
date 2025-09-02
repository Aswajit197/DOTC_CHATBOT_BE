const mongoose = require("mongoose");

const apiDetailsSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		description: { type: String, required: true },
		requiredFields: [{ type: String }],
		exampleResponse: { type: mongoose.Schema.Types.Mixed },
	},
	{ _id: false }
);

const sessionSchema = new mongoose.Schema(
	{
		ClientId: { type: String, required: true },
		StationId: { type: String },
		sessionId: { type: String, required: true, unique: true },
		history: [
			{
				sender: String,
				message: String,
				context: {},
				timestamp: Date,
			},
		],
		apiDetailsHistory: [apiDetailsSchema],
		lastResponseMessage: { type: String },
		lastSuccessUserMessage: { type: String },
		lastSuccessIntent: { type: String },
		lastSuccessApiResponse: { type: mongoose.Schema.Types.Mixed },

		// 🔹 to persist missing field context
		missingField: {
			lastMissingFieldBotMessage: { type: String },
			lastMissingApiIntent: { type: String },
			lastParams: { type: mongoose.Schema.Types.Mixed }, // <--- allow object storage
			missingFields: [{ type: String }],
		},
		createdAt: {
			type: Date,
			default: Date.now,
			expires: 60 * 60 * 24, // 24 hours
		},
	},
	{ timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
