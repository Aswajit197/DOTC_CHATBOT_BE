// models/session.model.js
const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
	{
		ClientId: { type: String, required: true },
		StationId: { type: String },
		sessionId: { type: String, required: true, unique: true },
		history: [{ sender: String, message: String, context: {}, timestamp: Date }],
		createdAt: {
			type: Date,
			default: Date.now,
			expires: 60 * 60 * 24, // 24 hours = 86400 seconds
		},
	},
	{ timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
