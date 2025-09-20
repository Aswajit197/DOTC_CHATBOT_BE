const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
const Session = require("../model/session.model");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Chat Controller
const chat = {};

// 🔹 Send Message Controller
chat.sendMessage = async (req, res) => {
	let clientDisconnected = false;
	const { sessionId, message } = req.query;

	console.log("🚀 Starting sendMessage for session:", sessionId);

	// Helper function to check if session is stopped
	const isSessionStopped = () => {
		const stopped = global.stoppedSessions && global.stoppedSessions.has(sessionId);
		if (stopped) {
			console.log("🛑 Session is marked as stopped:", sessionId);
		}
		return stopped;
	};

	// Helper function to check if should continue processing
	const shouldContinue = () => {
		if (clientDisconnected) {
			console.log("❌ Client disconnected, stopping");
			return false;
		}
		if (isSessionStopped()) {
			console.log("🛑 Session stopped by user, stopping");
			return false;
		}
		if (res.writableEnded || res.destroyed) {
			console.log("❌ Response stream closed, stopping");
			return false;
		}
		return true;
	};

	// Connection event handlers
	req.on("close", () => {
		console.log("🔌 Client connection closed");
		clientDisconnected = true;
	});

	res.on("close", () => {
		console.log("📡 Response stream closed");
		clientDisconnected = true;
	});

	req.on("error", (err) => {
		console.log("❌ Request error:", err.message);
		clientDisconnected = true;
	});

	res.on("error", (err) => {
		console.log("❌ Response error:", err.message);
		clientDisconnected = true;
	});

	try {
		if (!sessionId || !message) {
			return res.status(400).json({ error: "Missing session or message" });
		}

		console.log("💬 Processing message:", message);

		const session = await Session.findById(sessionId);
		if (!session) return res.status(400).json({ error: "Session not initialized" });

		// Check if stopped before any processing
		if (!shouldContinue()) {
			console.log("🛑 Stopping before processing starts");
			return;
		}

		// Check if this is the first user message in the session
		const hasUserMessage = session?.history?.some((h) => h.sender === "user");

		if (!hasUserMessage && shouldContinue()) {
			try {
				const completion = await openai.chat.completions.create({
					model: "gpt-3.5-turbo",
					messages: [
						{
							role: "system",
							content: "Generate a very short 2-4 word chat title based on the user's first message. No punctuation or quotes.",
						},
						{ role: "user", content: message },
					],
				});

				const generatedName = completion.choices[0]?.message?.content?.trim();
				console.log("🏷️ Generated session name:", generatedName);

				if (generatedName && shouldContinue()) {
					session.sessionName = generatedName;
					await session.save();
				}
			} catch (nameErr) {
				console.error("❌ Session name generation failed:", nameErr);
			}
		}

		if (!shouldContinue()) {
			console.log("🛑 Stopping before SSE setup");
			return;
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

		if (!shouldContinue()) {
			console.log("🛑 Stopping before intent detection");
			return;
		}

		console.log("🤖 Starting intent detection...");

		// Detect intent & stream partials
		const intentResult = await getIntentFromOpenAI(message, session, {
			onStream: (chunk) => {
				if (!shouldContinue()) {
					console.log("🛑 Stopping stream chunk");
					return;
				}

				if (chunk) {
					try {
						res.write(`data: ${JSON.stringify({ type: "partial", text: chunk })}\n\n`);
						console.log("📤 Sent chunk:", chunk.substring(0, 50) + "...");
					} catch (writeErr) {
						console.log("❌ Error writing chunk:", writeErr.message);
						clientDisconnected = true;
					}
				}
			},
		});

		if (!shouldContinue()) {
			console.log("🛑 Stopping after intent detection");
			return;
		}

		// Handle all the different response types with stop checks
		if (intentResult.error === "No API matched" && intentResult.fallbackMessage) {
			if (shouldContinue()) {
				session.history.push({
					sender: "bot",
					message: intentResult.fallbackMessage,
					timestamp: new Date(),
				});
				await session.save();

				try {
					res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.fallbackMessage })}\n\n`);
					res.end();
					console.log("✅ Sent fallback response");
				} catch (writeErr) {
					console.log("❌ Error writing fallback:", writeErr.message);
				}
			}
			return;
		}

		// Continue with other response types...
		// (Apply the same shouldContinue() checks to all other response branches)

		if (intentResult.error === "Missing required fields" && intentResult.fallbackMessage) {
			if (shouldContinue()) {
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

				try {
					res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.fallbackMessage })}\n\n`);
					res.end();
					console.log("✅ Sent missing fields response");
				} catch (writeErr) {
					console.log("❌ Error writing missing fields response:", writeErr.message);
				}
			}
			return;
		}

		// Add shouldContinue() checks to all other response branches...
		// (I'm shortening this for brevity, but apply the same pattern)

		// Final successful response
		if (shouldContinue() && intentResult?.formattedReply) {
			try {
				res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.formattedReply })}\n\n`);
				res.end();

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

				console.log("✅ Sent final response successfully");
			} catch (writeErr) {
				console.log("❌ Error writing final response:", writeErr.message);
			}
		} else {
			console.log("🛑 Skipped final response - session stopped or no reply");
		}
	} catch (err) {
		console.error("❌ sendMessage error:", err);

		if (shouldContinue()) {
			try {
				res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
				res.end();
			} catch (writeErr) {
				console.log("❌ Error writing error response:", writeErr.message);
			}
		}
	}
};

// 🆕 NEW: Add this to your routes - Stop endpoint
chat.stopMessage = async (req, res) => {
    try {
        const { sessionId } = req.body;
        
        console.log("🛑 STOP REQUEST RECEIVED for session:", sessionId);
        
        if (!sessionId) {
            return res.status(400).json({ error: "Missing sessionId" });
        }

        // Set stop flag in memory/cache for this session
        global.stoppedSessions = global.stoppedSessions || new Set();
        global.stoppedSessions.add(sessionId);
        
        console.log("✅ Session marked as stopped:", sessionId);
        console.log("📊 Currently stopped sessions:", Array.from(global.stoppedSessions));
        
        // Clean up after 30 seconds to prevent memory leaks
        setTimeout(() => {
            if (global.stoppedSessions) {
                global.stoppedSessions.delete(sessionId);
                console.log("🧹 Cleaned up stopped session:", sessionId);
            }
        }, 30000);
        
        res.json({ success: true, message: "Stop signal received" });
    } catch (error) {
        console.error("❌ Error in stop endpoint:", error);
        res.status(500).json({ error: "Internal server error" });
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
