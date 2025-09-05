const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
const Session = require("../model/session.model");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Chat Controller
const chat = {};

// 🔹 Send Message Controller
chat.sendMessage = async (req, res) => {
	try {
		const { sessionId, message } = req.body;
		if (!sessionId || !message) {
			return res.status(400).json({ error: "Missing session or message" });
		}

		const session = await Session.findById(sessionId);
		if (!session) return res.status(400).json({ error: "Session not initialized" });

		// 🔹 Check if this is the first user message in the session
		const hasUserMessage = session?.history?.some((h) => h.sender === "user");
		console.log(hasUserMessage, "hasUserMessage");
		// inside sendMessage controller -> first user message check
		if (!hasUserMessage) {
			try {
				const completion = await openai.chat.completions.create({
					model: "gpt-3.5-turbo", //
					messages: [
						{
							role: "system",
							content: "Generate a very short 2-4 word chat title based on the user's first message. No punctuation or quotes.",
						},
						{ role: "user", content: message },
					],
				});

				const generatedName = completion.choices[0]?.message?.content?.trim();

				console.log(generatedName, "name of messeage");
				if (generatedName) {
					session.sessionName = generatedName;
					await session.save();
				}
			} catch (nameErr) {
				console.error("Session name generation failed:", nameErr);
			}
		}

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

		// Handle fallbacks and errors
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
			// 🔹 Save missing field context
			session.missingField = {
				lastMissingFieldBotMessage: intentResult.fallbackMessage,
				lastMissingApiIntent: intentResult?.api?.name,
				lastParams: intentResult.params,
				missingFields: intentResult?.requires || [],
			};
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
			console.log(intentResult);
			session.history.push({
				sender: "bot",
				data: intentResult?.data,
				chatType: "visualization",
				timestamp: new Date(),
			});
			await session.save();
			res.write(`data: ${JSON.stringify({ type: "visualization", data: intentResult.data })}\n\n`);
			res.end();
			return;
		}

		if (intentResult.type === "same intent") {
			session.history.push({
				sender: "bot",
				message: intentResult?.formattedReply,
				timestamp: new Date(),
			});
			await session.save();
			res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.formattedReply })}\n\n`);
			res.end();
			return;
		}
		if (intentResult.type === "multi_intent") {
			session.history.push({
				sender: "bot",
				message: intentResult?.combinedReply,
				timestamp: new Date(),
			});
			await session.save();
			res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.combinedReply })}\n\n`);
			res.end();
			return;
		}

		// ✅ Send final successful response
		res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.formattedReply })}\n\n`);
		res.end();

		// Save bot message
		session.history.push({
			sender: "bot",
			message: intentResult.formattedReply,
			context: {
				lastIntent: intentResult?.api?.name,
				lastParams: intentResult?.params,
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

// 🔹 Create Session Controller
chat.createSession = async (req, res) => {
	try {
		let { clientId, userId } = req.body;

		if (!clientId || !userId) {
			return res.status(400).json({ error: "clientId, and userId are required." });
		}
		// Greeting message
		const greetingMessage = {
			sender: "bot",
			message: `Hi! 👋 I'm your SchedAI assistant. Ask me anything related to your tasks, drivers, or station work and I’ll help you out!`,
			context: {
				lastParams: { StationId: clientId, ClientId: clientId },
			},
			timestamp: new Date(),
		};

		// Create new session
		const session = await Session.create({
			ClientId: clientId,
			StationId: clientId,
			userId,
			sessionName: "New Chat",
			history: [greetingMessage],
		});

		res.json({ message: "Session created successfully", session });
	} catch (err) {
		console.error("Error creating chat session:", err);
		res.status(500).json({ err, error: "Chat session creation failed" });
	}
};

// 🔹 Fetch Sessions by userId
chat.getSessionsByUserId = async (req, res) => {
	try {
		const { userId } = req.params;
		if (!userId) {
			return res.status(400).json({ error: "userId is required" });
		}

		const sessions = await Session.find({ userId }).sort({ createdAt: -1 });
		if (!sessions.length) {
			return res.status(200).json({ data: [], message: "No sessions found for this user" });
		}

		res.status(200).json({ data: sessions, message: "Sessions Fetched Successfully..." });
	} catch (err) {
		console.error("Error fetching chats:", err);
		res.status(500).json({ err, error: "Failed to fetch chats" });
	}
};

module.exports = chat;
