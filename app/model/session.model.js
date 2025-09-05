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
				context: {},
				chatType: String,
				data: { type: mongoose.Schema.Types.Mixed },
				timestamp: Date,
			},
		],
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
			expires: 5 * 60 * 60 * 24, // 5* 24 hours
		},
	},
	{ timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
