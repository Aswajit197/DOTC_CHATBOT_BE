const getIntentFromOpenAI = require("../utils/getIntentFromOpenAi");
// Remove entityMatcher import - entity matching is now in summarizer
const { summarizeLongResponseSync, createDynamicDataSummary } = require("../utils/responseSummarizer");
const Session = require("../model/session.model");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Chat Controller
const chat = {};

// 🔹 Send Message Controller
chat.sendMessage = async (req, res) => {
    let isAborted = false;
    let internalAbortController = null;

    try {
        const { sessionId, message } = req.body;
        
        // Validate request
        if (!sessionId || !message) {
            return res.status(400).json({ error: "Missing session or message" });
        }

        const session = await Session.findById(sessionId);
        if (!session) {
            return res.status(400).json({ error: "Session not initialized" });
        }

        // Generate session name for first user message
        await generateSessionName(session, message);

        // Setup SSE headers
        setupSSEHeaders(res);

        // Initialize abort controller
        internalAbortController = new AbortController();
        setupAbortHandlers(req, res, internalAbortController, () => { isAborted = true; });

        // Save user message immediately
        await saveUserMessage(session, message);

        // Check if aborted before proceeding
        if (isAborted) {
            console.log("⚠️ Request aborted before processing intent");
            return;
        }

        // Detect intent with streaming
        let intentResult = await getIntentFromOpenAI(message, session, {
            onStream: (chunk) => handleStreamChunk(chunk, res, isAborted, internalAbortController),
            abortSignal: internalAbortController.signal,
        });

        // 🔹 REMOVED: Entity matching call - now handled automatically by summarizer
        // intentResult = enhanceIntentWithEntityMatching(intentResult, session, message);

        if (isAborted) {
            console.log("⚠️ Request aborted after intent processing");
            return;
        }

        // Process the intent result
        const { finalBotReply, finalDataType } = processIntentResult(intentResult, session);

        if (!isAborted && finalBotReply) {
            // Send final response to client
            sendFinalResponse(res, finalBotReply, finalDataType, intentResult);
            
            // Save bot response to session with context
            await saveBotResponse(session, finalBotReply, finalDataType, intentResult, message, sessionId);
            
            // Update session state
            updateSessionState(session, intentResult, message, finalBotReply);
        }

        await session.save();
        console.log("✅ Session state saved successfully.");

    } catch (err) {
        handleError(err, res);
    } finally {
        cleanupResponse(res);
    }
};

// 🔹 Helper Functions

/**
 * Generate session name for first user message
 */
async function generateSessionName(session, message) {
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
            console.log(generatedName, "name of message");
            
            if (generatedName) {
                session.sessionName = generatedName;
            }
        } catch (nameErr) {
            console.error("Session name generation failed:", nameErr);
        }
    }
}

/**
 * Setup SSE headers
 */
function setupSSEHeaders(res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });
    res.flushHeaders();
}

/**
 * Setup abort handlers for client disconnect
 */
function setupAbortHandlers(req, res, abortController, onAbort) {
    const abortInternalOperations = () => {
        if (!abortController.signal.aborted) {
            abortController.abort();
            console.log("🚫 Aborting internal operations due to client disconnect");
        }
    };

    req.on("close", () => {
        if (!res.finished) {
            onAbort();
            console.log("🚫 USER ABORTED THE API CALL - Request was cancelled by client");
            abortInternalOperations();
        }
    });

    req.on("aborted", () => {
        onAbort();
        console.log("🚫 USER ABORTED THE API CALL - Request was aborted");
        abortInternalOperations();
    });

    res.on("close", () => {
        if (!res.finished) {
            onAbort();
            console.log("🚫 USER ABORTED THE API CALL - Response connection closed");
            abortInternalOperations();
        }
    });
}

/**
 * Save user message to session history
 */
async function saveUserMessage(session, message) {
    session.history.push({ 
        sender: "user", 
        message, 
        timestamp: new Date() 
    });
    await session.save();
}

/**
 * Handle streaming chunks
 */
function handleStreamChunk(chunk, res, isAborted, abortController) {
    if (isAborted || abortController.signal.aborted) {
        console.log("⚠️ Stream aborted, stopping chunk processing");
        return;
    }
    
    if (chunk) {
        try {
            res.write(`data: ${JSON.stringify({ type: "partial", text: chunk })}\n\n`);
        } catch (writeError) {
            console.log("🚫 Failed to write chunk - likely user aborted:", writeError.message);
            throw new Error('Stream write failed');
        }
    }
}

/**
 * Process intent result and determine final response
 */
function processIntentResult(intentResult, session) {
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

    return { finalBotReply, finalDataType };
}

/**
 * Send final response to client
 */
function sendFinalResponse(res, finalBotReply, finalDataType, intentResult) {
    const finalPayload = {
        type: finalDataType === "visualization" ? "visualization" : "final",
        response: finalDataType !== "visualization" ? finalBotReply : null,
        data: finalDataType === "visualization" ? finalBotReply : null,
        graphContents: intentResult.graphContents,
    };

    res.write(`data: ${JSON.stringify(finalPayload)}\n\n`);
}

/**
 * Save bot response to session history with context
 */
async function saveBotResponse(session, finalBotReply, finalDataType, intentResult, userMessage, sessionId) {
    let messageToSave = finalBotReply;
    
    // Ensure message is a string
    if (Array.isArray(messageToSave)) {
        messageToSave = JSON.stringify(messageToSave);
    } else if (typeof messageToSave !== 'string') {
        messageToSave = String(messageToSave);
    }

    if (finalDataType !== "visualization") {
        // 🔹 UPDATED: Pass sessionId to createDynamicDataSummary for entity context caching
        const summarizedResult = intentResult.actualData 
            ? createDynamicDataSummary(intentResult.actualData, intentResult.api?.name, userMessage, sessionId)
            : { summary: summarizeLongResponseSync(messageToSave), context: null };

        // Extract summary and context
        let summarizedReply;
        let contextData = null;

        if (typeof summarizedResult === 'object' && summarizedResult.summary) {
            summarizedReply = summarizedResult.summary;
            contextData = summarizedResult.context; // Entity context is automatically extracted here
        } else {
            summarizedReply = summarizedResult;
        }

        // Save to history with context
        const botMessage = {
            sender: "bot",
            message: summarizedReply,
            context: contextData, // Entity context saved automatically
            timestamp: new Date(),
        };

        session.history.push(botMessage);

        // Log context for debugging
        if (contextData) {
            console.log('🔹 Saved entity context:', {
                entityType: contextData.entityType,
                entityCount: contextData.entityNames?.length,
                apiName: contextData.apiName
            });
        }
    } else {
        session.history.push({
            sender: "bot",
            message: messageToSave,
            chatType: "visualization",
            graphContents: intentResult?.graphContents,
            timestamp: new Date(),
        });
    }
}

/**
 * Update session state after successful response
 */
function updateSessionState(session, intentResult, userMessage, finalBotReply) {
    if (!intentResult.error) {
        // Handle merged user message
        session.lastSuccessUserMessage = intentResult.mergedUserMessage || userMessage;
        
        // Ensure lastResponseMessage is a string
        let messageToSave = finalBotReply;
        if (Array.isArray(messageToSave)) {
            messageToSave = JSON.stringify(messageToSave);
        } else if (typeof messageToSave !== 'string') {
            messageToSave = String(messageToSave);
        }
        
        session.lastResponseMessage = messageToSave;
        session.lastSuccessIntent = intentResult?.api?.name || session.lastSuccessIntent;
        session.lastSuccessApiResponse = intentResult?.actualData || session.lastSuccessApiResponse;
        session.lastSuccessParams = intentResult?.params || session.lastSuccessParams;
        session.missingField = null;
    }
}

/**
 * Handle errors gracefully
 */
function handleError(err, res) {
    console.error("sendMessage error:", err);
    
    if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
    }
    
    res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
}

/**
 * Cleanup response
 */
function cleanupResponse(res) {
    if (!res.finished) {
        res.end();
    }
}

// 🔹 Stop Message Controller
chat.stopMessage = async (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: "Missing sessionId" });
        }

        console.log("🛑 STOP REQUEST RECEIVED for session:", sessionId);
        
        global.stoppedSessions = global.stoppedSessions || new Set();
        global.stoppedSessions.add(sessionId);
        
        console.log("✅ Session marked as stopped:", sessionId);
        console.log("📊 Currently stopped sessions:", Array.from(global.stoppedSessions));

        // Auto-cleanup after 30 seconds
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
            return res.status(400).json({ error: "clientId and userId are required." });
        }

        const greetingMessage = {
            sender: "bot",
            message: `Hi! 👋 I'm your SchedAI assistant. Ask me anything related to your tasks, drivers, or station work and I'll help you out!`,
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