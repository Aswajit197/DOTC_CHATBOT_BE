const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
const Session = require("../model/session.model");
const apiListData = require("../../apiDetails");

// Admin Controller
const chat = {};

// chat.sendMessage = async (req, res) => {
// 	try {
// 		const { sessionId, message } = req.body;
// 		if (!sessionId || !message) return res.status(400).json({ error: "Missing session or message" });

// 		const session = await Session.findOne({ sessionId });
// 		if (!session) return res.status(400).json({ error: "Session not initialized" });

// 		// Save user message
// 		session.history.push({ sender: "user", message, timestamp: new Date() });
// 		await session.save();

// 		const intentResult = await getIntentFromOpenAI(message, session);

// 		// Handle error case with fallback
// 		if (intentResult.error === "No API matched" && intentResult.fallbackMessage) {
// 			session.history.push({
// 				sender: "bot",
// 				message: intentResult.fallbackMessage,
// 				timestamp: new Date(),
// 			});
// 			await session.save();
// 			return res.json({ response: intentResult.fallbackMessage });
// 		}

// 		if (intentResult.error === "Missing required fields" && intentResult.fallbackMessage) {
// 			session.history.push({
// 				sender: "bot",
// 				message: intentResult.fallbackMessage,
// 				timestamp: new Date(),
// 			});
// 			await session.save();
// 			return res.json({ response: intentResult.fallbackMessage });
// 		}

// 		// Handle generic error
// 		if (intentResult.error) {
// 			session.history.push({
// 				sender: "bot",
// 				message: intentResult.error,
// 				timestamp: new Date(),
// 			});
// 			await session.save();
// 			return res.json({ response: intentResult.error });
// 		}

// 		const { api, params, formattedReply } = intentResult;

// 		session.history.push({
// 			sender: "bot",
// 			message: formattedReply,
// 			context: {
// 				lastIntent: api?.name,
// 				lastParams: params,
// 			},
// 			timestamp: new Date(),
// 		});

// 		await session.save();
// 		return res.json({ response: formattedReply });
// 	} catch (err) {
// 		console.error("sendMessage error:", err);
// 		res.status(500).json({ error: "Internal server error" });
// 	}
// };


chat.sendMessage = async (req, res) => {
	try {
		const { sessionId, message } = req.body;
		if (!sessionId || !message) {
			return res.status(400).json({ error: "Missing session or message" });
		}

		const session = await Session.findOne({ sessionId });
		if (!session) return res.status(400).json({ error: "Session not initialized" });

		// Set SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.flushHeaders();

		// Save user message
		session.history.push({ sender: "user", message, timestamp: new Date() });
		await session.save();

		// Intent detection
		const intentResult = await getIntentFromOpenAI(message, session, {
			onStream: (chunk) => {
				// Push partial bot text to frontend
				res.write(`data: ${JSON.stringify({ type: "partial", text: chunk })}\n\n`);
			},
		});

		// Send final result
		res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.formattedReply })}\n\n`);
		res.end();

		// Save bot message in history
		session.history.push({
			sender: "bot",
			message: intentResult.formattedReply,
			context: {
				lastIntent: intentResult.api?.name,
				lastParams: intentResult.params,
			},
			timestamp: new Date(),
		});
		await session.save();
	} catch (err) {
		console.error("sendMessage error:", err);
		res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
		res.end();
	}
};

chat.createSession = async (req, res) => {
	try {
		let { sessionId, clientId } = req.body;

		if (!sessionId || !clientId) {
			return res.status(400).json({ error: "Either sessionId or clientId must be provided." });
		}

		// Check if session already exists
		const existingSession = await Session.findOne({ sessionId });
		if (existingSession) {
			return res.json({ message: "Session already exists", session: existingSession });
		}

		// Greeting message
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

		// Create new session with API list stored separately
		const session = await Session.create({
			sessionId,
			ClientId: clientId,
			StationId: clientId,
			history: [greetingMessage],
			apiDetailsHistory: apiListData 
		});

		res.json({ message: "Session created successfully", session });
	} catch (err) {
		console.error("Error creating chat session:", err);
		res.status(500).json({ err, error: "Chat session creation failed" });
	}
};


module.exports = chat;
