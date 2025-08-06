const formatResponseWithOpenAi = require("../utils/formatReponseWithOpenAi");
const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
const Session = require("../model/session.model");

// Admin Controller
const chat = {};

chat.sendMessage = async (req, res) => {
	try {
		const { sessionId, message } = req.body;
		if (!sessionId || !message) return res.status(400).json({ error: "Missing session or message" });

		const session = await Session.findOne({ sessionId });
		if (!session) return res.status(400).json({ error: "Session not initialized" });

		// Save user message
		session.history.push({ sender: "user", message, timestamp: new Date() });
		await session.save();

		const intentResult = await getIntentFromOpenAI(message, session);

		// Handle error case with fallback
		if (intentResult.error === "No API matched" && intentResult.fallbackMessage) {
			session.history.push({
				sender: "bot",
				message: intentResult.fallbackMessage,
				timestamp: new Date(),
			});
			await session.save();
			return res.json({ response: intentResult.fallbackMessage });
		}

		// Handle generic error
		if (intentResult.error) {
			session.history.push({
				sender: "bot",
				message: intentResult.error,
				timestamp: new Date(),
			});
			await session.save();
			return res.json({ response: intentResult.error });
		}

		const { api, params, userMessage, apiResponse } = intentResult;
		// Format and send normal API response
		const reply = await formatResponseWithOpenAi(api, userMessage, apiResponse, params);

		session.history.push({
			sender: "bot",
			message: reply,
			context: {
				lastIntent: intentResult.api?.name,
				lastParams: intentResult.params,
			},
			timestamp: new Date(),
		});

		await session.save();

		return res.json({ response: reply });
	} catch (err) {
		console.error("sendMessage error:", err);
		res.status(500).json({ error: "Internal server error" });
	}
};

chat.createSession = async (req, res) => {
	try {
		let { sessionId, clientId } = req.body;

		// If either sessionId or clientId is missing, but the other is present, use it for both
		if (!sessionId && clientId) sessionId = clientId;
		if (!clientId && sessionId) clientId = sessionId;

		// If both are missing, return error
		if (!sessionId || !clientId) {
			return res.status(400).json({ error: "Either sessionId or clientId must be provided." });
		}

		// Check if session already exists
		const existingSession = await Session.findOne({ sessionId });
		if (existingSession) {
			return res.json({ message: "Session already exists", session: existingSession });
		}

		// Initial bot greeting message
		const greetingMessage = {
			sender: "bot",
			message:
				"Hi there! 👋 I'm your assistant. Ask me anything related to your tasks, drivers, or station work and I’ll help you out!",
			context: {
				lastParams: {
					sessionId,
					StationId: clientId,
					ClientId: clientId,
				},
			},
			timestamp: new Date(),
		};

		// Create new session
		const session = await Session.create({
			sessionId,
			clientId,
			history: [greetingMessage],
		});

		res.json({ message: "Session created successfully", session });
	} catch (err) {
		console.error("Error creating chat session:", err);
		res.status(500).json({ error: "Chat session creation failed" });
	}
};

module.exports = chat;
