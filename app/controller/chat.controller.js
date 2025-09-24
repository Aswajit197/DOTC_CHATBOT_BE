const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
const { summarizeLongResponseSync, createDynamicDataSummary } = require("../utils/responseSummarizer");
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

		// 🔹 Check if this is the first user message in the session
		const hasUserMessage = session?.history?.some((h) => h.sender === "user");
		// inside sendMessage controller -> first user message check
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

				console.log(generatedName, "name of messeage");
				if (generatedName) {
					session.sessionName = generatedName;
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

		// 🔹 Create AbortController for internal operations
		const internalAbortController = new AbortController();

		// 🔹 If client disconnects, abort internal operations
		const abortInternalOperations = () => {
			if (!internalAbortController.signal.aborted) {
				internalAbortController.abort();
				console.log("🚫 Aborting internal operations due to client disconnect");
			}
		};
		// 🔹 Detect client disconnect/abort
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

		// Optional: You can also listen to the response object
		res.on("close", () => {
			if (!res.finished) {
				isAborted = true;
				console.log("🚫 USER ABORTED THE API CALL - Response connection closed");
				abortInternalOperations();
			}
		});

		// 🔹 MODIFIED: Save user message to history immediately.
		session.history.push({ sender: "user", message, timestamp: new Date() });
		await session.save(); // 🔹 CRITICAL: Save immediately to preserve user message


		// 🔹 Check if aborted before proceeding
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
        
        // 🔹 NEW: Centralized Reply and State Management
		let finalBotReply = null;
		let finalDataType = "response";

		if (intentResult.error) {
			finalBotReply = intentResult.fallbackMessage || intentResult.error;
			if (intentResult.error === "Missing required fields") {
				session.missingField = {
					lastMissingFieldBotMessage: intentResult.fallbackMessage,
					lastMissingApiIntent: intentResult?.api?.name,
					lastParams: intentResult.params,
					missingFields: intentResult?.requires || [],
				};
			}
		} else if (intentResult.type === "visualization") {
			finalBotReply = intentResult.data;
			finalDataType = "visualization";
		
		} else {
			finalBotReply = intentResult.formattedReply || intentResult.combinedReply;
		}

		if (!isAborted && finalBotReply) {
    const finalPayload = {
        type: finalDataType === "visualization" ? "visualization" : "final",
        response: finalDataType !== "visualization" ? finalBotReply : null,
        data: finalDataType === "visualization" ? finalBotReply : null,
        graphContents: intentResult.graphContents,
    };

    res.write(`data: ${JSON.stringify(finalPayload)}\n\n`);

	  let messageToSave = finalBotReply;
    if (Array.isArray(messageToSave)) {
        messageToSave = JSON.stringify(messageToSave); // Convert array to string
    } else if (typeof messageToSave !== 'string') {
        messageToSave = String(messageToSave); // Convert any other type to string
    }

    if (finalDataType !== "visualization") {
    // For regular responses, summarize to save tokens
      const summarizedReply = intentResult.actualData 
        ? createDynamicDataSummary(intentResult.actualData, intentResult.api?.name, message)
        : summarizeLongResponseSync(messageToSave);
    session.history.push({
        sender: "bot",
        message: summarizedReply,
        timestamp: new Date(),
    });
} else {
    session.history.push({
        sender: "bot",
        message: messageToSave,
        chatType: "visualization", 
        graphContents: intentResult?.graphContents,
        timestamp: new Date(),
    });
}

    if (!intentResult.error) {
        // Handle merged user message for refinements
        if (intentResult.mergedUserMessage) {
            session.lastSuccessUserMessage = intentResult.mergedUserMessage;
        } else {
            session.lastSuccessUserMessage = message;
        }
        // Make sure this is a string, not an array
		session.lastResponseMessage = messageToSave;

// Also check history pushes - they must be strings

        session.lastSuccessIntent = intentResult?.api?.name || session.lastSuccessIntent;
        session.lastSuccessApiResponse = intentResult?.actualData || session.lastSuccessApiResponse;
        session.lastSuccessParams = intentResult?.params || session.lastSuccessParams;
        session.missingField = null;
    }
}
		

		await session.save();
		console.log("✅ Session state saved successfully.");

	} catch (err) {
		console.error("sendMessage error:", err);
		if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
        }
		res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
	} finally {
        if (!res.finished) {
            res.end();
        }
    }
};

// ... (Your other functions like stopMessage, createSession, etc., remain unchanged) ...

// 🆕 NEW: Add this to your routes - Stop endpoint
chat.stopMessage = async (req, res) => {
	try {
		const { sessionId } = req.body;
		console.log("🛑 STOP REQUEST RECEIVED for session:", sessionId);
		if (!sessionId) {
			return res.status(400).json({ error: "Missing sessionId" });
		}
		global.stoppedSessions = global.stoppedSessions || new Set();
		global.stoppedSessions.add(sessionId);
		console.log("✅ Session marked as stopped:", sessionId);
		console.log("📊 Currently stopped sessions:", Array.from(global.stoppedSessions));
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
		const greetingMessage = {
			sender: "bot",
			message: `Hi! 👋 I'm your SchedAI assistant. Ask me anything related to your tasks, drivers, or station work and I’ll help you out!`,
			context: {
				lastParams: { StationId: clientId, ClientId: clientId },
			},
			timestamp: new Date(),
		};
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