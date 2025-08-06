const mongoose = require("mongoose");

const chatMessageSchema = new mongoose.Schema({
	sessionId: String, // Connects to a user session
	userId: String, // Optional if you also track user
	role: String, // 'user' or 'assistant'
	message: String,
	timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
