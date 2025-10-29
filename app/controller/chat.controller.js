const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
const Session = require("../model/session.model");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Chat Controller
const chat = {};

// 🔹 Send Message Controller
chat.sendMessage = async (req, res) => {
	let isAborted = false;
	try {
		const { sessionId, message } = req.body;
		if (!sessionId || !message) {
			return res.status(400).json({ error: "Missing session or message" });
		}

		const session = await Session.findById(sessionId);
		if (!session) return res.status(400).json({ error: "Session not initialized" });

		// Check if this is the first user message in the session
		const hasUserMessage = session?.history?.some((h) => h.sender === "user");

		if (!hasUserMessage) {
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

		// Create AbortController for internal operations
		const internalAbortController = new AbortController();

		const abortInternalOperations = () => {
			if (!internalAbortController.signal.aborted) {
				internalAbortController.abort();
				console.log("🚫 Aborting internal operations due to client disconnect");
			}
		};

		// Detect client disconnect/abort
		req.on("close", () => {
			if (!res.finished) {
				isAborted = true;
				console.log("🚫 USER ABORTED THE API CALL - Request was cancelled by client");
				abortInternalOperations();
			}
		});

		req.on("aborted", () => {
			isAborted = true;
			console.log("🚫 USER ABORTED THE API CALL - Request was aborted");
			abortInternalOperations();
		});

		res.on("close", () => {
			if (!res.finished) {
				isAborted = true;
				console.log("🚫 USER ABORTED THE API CALL - Response connection closed");
				abortInternalOperations();
			}
		});

		// Save user message
		session.history.push({ sender: "user", message, timestamp: new Date() });
		await session.save();

		if (isAborted) {
			console.log("⚠️ Request aborted before processing intent");
			return;
		}

		// Detect intent & stream partials
		const intentResult = await getIntentFromOpenAI(message, session, {
			onStream: (chunk) => {
				if (isAborted || internalAbortController.signal.aborted) {
					console.log("⚠️ Stream aborted, stopping chunk processing");
					return;
				}

				if (chunk) {
					try {
						res.write(`data: ${JSON.stringify({ type: "partial", text: chunk })}\n\n`);
					} catch (writeError) {
						console.log("🚫 Failed to write chunk - likely user aborted:", writeError.message);
						isAborted = true;
						abortInternalOperations();
					}
				}
			},
			abortSignal: internalAbortController.signal,
		});

		if (isAborted) {
			console.log("⚠️ Request aborted after intent processing");
			return;
		}

		// Handle fallbacks and errors
		if (intentResult.error === "No API matched" && intentResult.fallbackMessage) {
			if (!isAborted) {
				session.history.push({
					sender: "bot",
					message: intentResult.fallbackMessage,
					timestamp: new Date(),
				});
				await session.save();
				try {
					res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.fallbackMessage })}\n\n`);
					return res.end();
				} catch (writeError) {
					console.log("🚫 Failed to write fallback response - user aborted:", writeError.message);
					return;
				}
			}
		}

		if (intentResult.error === "Missing required fields" && intentResult.fallbackMessage) {
			if (!isAborted) {
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
					return res.end();
				} catch (writeError) {
					console.log("🚫 Failed to write missing fields response - user aborted:", writeError.message);
					return;
				}
			}
		}

		if (intentResult.error) {
			if (!isAborted) {
				session.history.push({
					sender: "bot",
					message: intentResult.error,
					timestamp: new Date(),
				});
				await session.save();
				try {
					res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.error })}\n\n`);
					return res.end();
				} catch (writeError) {
					console.log("🚫 Failed to write error response - user aborted:", writeError.message);
					return;
				}
			}
		}

		if (intentResult.type === "visualization") {
			if (!isAborted) {
				session.history.push({
					sender: "bot",
					data: intentResult?.data,
					chatType: "visualization",
					graphContents: intentResult?.graphContents,
					timestamp: new Date(),
				});
				await session.save();
				try {
					res.write(
						`data: ${JSON.stringify({
							type: "visualization",
							data: intentResult.data,
							chatType: "visualization",
							graphContents: intentResult?.graphContents,
						})}\n\n`
					);
					res.end();
					return;
				} catch (writeError) {
					console.log("🚫 Failed to write visualization response - user aborted:", writeError.message);
					return;
				}
			}
		}

		if (intentResult.type === "same intent") {
			if (!isAborted) {
				session.history.push({
					sender: "bot",
					message: intentResult?.formattedReply,
					timestamp: new Date(),
				});
				await session.save();
				try {
					res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.formattedReply })}\n\n`);
					res.end();
					return;
				} catch (writeError) {
					console.log("🚫 Failed to write same intent response - user aborted:", writeError.message);
					return;
				}
			}
		}

		if (intentResult.type === "multi_intent") {
			if (!isAborted) {
				session.history.push({
					sender: "bot",
					message: intentResult?.combinedReply,
					timestamp: new Date(),
				});
				await session.save();
				try {
					res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.combinedReply })}\n\n`);
					res.end();
					return;
				} catch (writeError) {
					console.log("🚫 Failed to write multi intent response - user aborted:", writeError.message);
					return;
				}
			}
		}

		// ✅ Send final successful response
		if (!isAborted) {
			try {
				res.write(`data: ${JSON.stringify({ type: "final", response: intentResult.formattedReply })}\n\n`);
				res.end();

				// 🔹 Save bot message with enhanced context
				const botHistoryEntry = {
					sender: "bot",
					message: intentResult.formattedReply,
					context: {
						lastIntent: intentResult?.api?.name,
						lastParams: intentResult?.params,
						wasContextual: !!intentResult?.contextEntities, // 🔹 Track if it was contextual
					},
					timestamp: new Date(),
				};

				session.history.push(botHistoryEntry);
				await session.save();

				console.log("✅ Response sent and context saved successfully");
			} catch (writeError) {
				console.log("🚫 Failed to write final response - user aborted:", writeError.message);
				return;
			}
		}
	} catch (err) {
		console.error("sendMessage error:", err);
		if (!isAborted) {
			try {
				res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
				res.end();
			} catch (writeError) {
				console.log("🚫 Failed to write error - connection likely closed");
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

// 🔹 Fetch Sessions by userId and ClientId
chat.getSessionsByUserId = async (req, res) => {
	try {
		const { userId, ClientId } = req.params;

		if (!userId || !ClientId) {
			return res.status(400).json({ error: "userId and ClientId are required" });
		}

		const sessions = await Session.find({ userId, ClientId }).sort({ createdAt: -1 });

		if (!sessions.length) {
			return res.status(200).json({ data: [], message: "No sessions found for this user and client" });
		}

		res.status(200).json({ data: sessions, message: "Sessions fetched successfully." });
	} catch (err) {
		console.error("Error fetching sessions:", err);
		res.status(500).json({ err, error: "Failed to fetch sessions" });
	}
};

module.exports = chat;
