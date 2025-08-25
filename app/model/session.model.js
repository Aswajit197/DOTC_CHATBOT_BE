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
		createdAt: {
			type: Date,
			default: Date.now,
			expires: 60 * 60 * 24, // 24 hours
		},
	},
	{ timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
