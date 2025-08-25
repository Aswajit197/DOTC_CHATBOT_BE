const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
const Session = require("../model/session.model");
const apiListData = require("../../apiDetails");

// Admin Controller
const chat = {};

chat.sendMessage = async (req, res) => {
	try {
		const { sessionId, message } = req.body;
		if (!sessionId || !message) {
			return res.status(400).json({ error: "Missing session or message" });
		}

		const session = await Session.findOne({ sessionId });
		if (!session) return res.status(400).json({ error: "Session not initialized" });

		// SSE headers
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.flushHeaders();

		// Save user message
		session.history.push({ sender: "user", message, timestamp: new Date() });
		await session.save();

		// Detect intent & stream partials
		const intentResult = await getIntentFromOpenAI(message, session, {
			onStream: (chunk) => {
				if (chunk) {
					res.write(`data: ${JSON.stringify({ type: "partial", text: chunk })}\n\n`);
				}
			},
		});

		// console.log(intentResult,"intentResult")

		// --- Fallback handling before sending final ---
		if (intentResult.error === "No API matched" && intentResult.fallbackMessage) {
			session.history.push({
				sender: "bot",
				message: intentResult.fallbackMessage,
				timestamp: new Date(),
			});
			await session.save();
			res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.fallbackMessage })}\n\n`);
			return res.end();
		}

		if (intentResult.error === "Missing required fields" && intentResult.fallbackMessage) {
			session.history.push({
				sender: "bot",
				message: intentResult.fallbackMessage,
				timestamp: new Date(),
			});
			await session.save();
			res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.fallbackMessage })}\n\n`);
			return res.end();
		}

		if (intentResult.error) {
			session.history.push({
				sender: "bot",
				message: intentResult.error,
				timestamp: new Date(),
			});
			await session.save();
			res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.error })}\n\n`);
			return res.end();
		}

		if (intentResult.type === "visualization") {
			res.write(`data: ${JSON.stringify({ type: "visualization", data: intentResult.data })}\n\n`);
			res.end();
			return;
		}

		// Send final successful response
		// res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.formattedReply })}\n\n`);
		res.end();

		// Save bot message
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
				"Hi Jim! 👋 I'm your SchedAI assistant. Ask me anything related to your tasks, drivers, or station work and I’ll help you out!",
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
			apiDetailsHistory: apiListData,
		});

		res.json({ message: "Session created successfully", session });
	} catch (err) {
		console.error("Error creating chat session:", err);
		res.status(500).json({ err, error: "Chat session creation failed" });
	}
};

module.exports = chat;
