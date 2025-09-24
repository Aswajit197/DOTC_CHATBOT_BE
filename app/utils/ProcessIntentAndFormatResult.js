const { OpenAI } = require("openai");
const { summarizeLongResponseSync } = require("./responseSummarizer");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Utility function to get value from object using dot notation
 */
function getNestedValue(obj, path) {
    if (!path) return obj;
    return path.split(".").reduce((current, key) => {
        if (current === null || current === undefined) return undefined;
        return current[key];
    }, obj);
}

/**
 * Check if a field name should be excluded as metadata
 */
function isMetadataField(fieldName) {
    if (!fieldName) return false;

    const metadataPatterns = [
        /^id$/i, /.*_id$/i, /.*Id$/, /^uid$/i, /^uuid$/i, /^guid$/i,
        /timestamp/i, /created/i, /updated/i, /modified/i,
        /version/i, /revision/i, /build/i, /index/i, /position/i, /order/i,
        /status/i, /state/i, /type/i, /kind/i,
        /.*_key$/i, /.*Key$/, /.*_code$/i, /.*Code$/,
    ];

    return metadataPatterns.some((pattern) => pattern.test(fieldName));
}

/**
 * Extract numbers from any data structure
 */
function extractNumbers(data, fieldPath = null, excludeZeros = false) {
    const numbers = [];
    const shouldInclude = (value) => {
        if (typeof value !== "number" || isNaN(value)) return false;
        if (excludeZeros && value === 0) return false;
        return true;
    };

    if (fieldPath) {
        if (Array.isArray(data)) {
            data.forEach((item) => {
                const value = getNestedValue(item, fieldPath);
                if (typeof value === "object" && value !== null) {
                    Object.values(value).forEach((val) => {
                        if (shouldInclude(val)) numbers.push(val);
                    });
                } else if (shouldInclude(value)) {
                    numbers.push(value);
                }
            });
        } else {
            const value = getNestedValue(data, fieldPath);
            if (typeof value === "object" && value !== null) {
                Object.values(value).forEach((val) => {
                    if (shouldInclude(val)) numbers.push(val);
                });
            } else if (shouldInclude(value)) {
                numbers.push(value);
            }
        }
        return numbers;
    }

    function traverse(current, currentKey = null) {
        if (shouldInclude(current)) {
            numbers.push(current);
            return;
        }
        if (Array.isArray(current)) {
            current.forEach((item) => traverse(item));
        } else if (typeof current === "object" && current !== null) {
            Object.entries(current).forEach(([key, value]) => {
                if (!isMetadataField(key)) {
                    traverse(value, key);
                }
            });
        }
    }

    traverse(data);
    return numbers;
}
/**
 * Calculate average with zero exclusion option
 */
function calculateAverage({ data, field_path, exclude_zeros = false }) {
    try {
        const numbers = extractNumbers(data, field_path, exclude_zeros);
        if (numbers.length === 0) {
            return { error: "No valid numbers found" };
        }
        const sum = numbers.reduce((acc, num) => acc + num, 0);
        const average = sum / numbers.length;
        return {
            average: parseFloat(average.toFixed(2)),
            count: numbers.length,
            total_sum: parseFloat(sum.toFixed(2)),
        };
    } catch (error) {
        return { error: `Calculation error: ${error.message}` };
    }
}
// ... all your other calculation functions (calculateSum, calculateDeviation, etc.) remain here ...

/**
 * Detect if user message requires mathematical calculations
 */
function isMathematicalQuery(userMessage) {
    const mathKeywords = [ "average", "mean", "sum", "total", "calculate", "deviation", "variance", "percentage", "standard deviation", "std dev", "median", "mode", "statistics", "stats", "analysis" ];
    const message = userMessage.toLowerCase();
    return mathKeywords.some((keyword) => message.includes(keyword));
}

/**
 * Execute all relevant calculations based on user message
 */
function executeRelevantCalculations(userMessage, data) {
    const message = userMessage.toLowerCase();
    const calculations = {};

    if (message.includes("average") || message.includes("mean")) {
        calculations.average = calculateAverage({ data, exclude_zeros: true });
    }
    // ... more calculation checks ...
    return calculations;
}

/**
 * HYBRID APPROACH: Fast math + Complete AI response
 */
const processIntentAndFormatResponse = async ({
    userMessage,
    api,
    exampleResponse,
    actualData,
    params = {},
    session,
    onStream,
}) => {
    let fullText = "";
    console.log("🚀 Starting HYBRID processIntentAndFormatResponse");

    try {
        const isMathQuery = isMathematicalQuery(userMessage);
        let preCalculatedResults = null;
        if (isMathQuery) {
            preCalculatedResults = executeRelevantCalculations(userMessage, actualData);
        }


         const cleanHistory = (session.history || [])
    .map(turn => {
        if (turn.sender === 'user') {
            return { role: 'user', content: turn.message.substring(0, 100) };
        }
        if (turn.sender === 'bot') {
            if (turn.message) {
                const summarized = summarizeLongResponseSync(turn.message);
                return { role: 'assistant', content: summarized };
            }
            if (turn.chatType === 'visualization') {
                return { role: 'assistant', content: '[Chart displayed]' };
            }
        }
        return null;
    })
    .filter(Boolean)
    .slice(-4);

    console.log("=== PROCESS INTENT HISTORY DEBUG ===");
console.log("Clean history turns:", cleanHistory.length);
cleanHistory.forEach((turn, index) => {
    console.log(`[${index}] ${turn.role}: ${turn.content.substring(0, 80)}...`);
});
console.log("=== END HISTORY DEBUG ===");
        const currentTurnContext = `
You're a smart assistant designed to process structured API data intelligently and answer the user's message.
Your tasks:
1. Understand the user's intent from their message.
2. Use the provided pre-calculated mathematical results when available (these are 100% accurate).
3. Filter, transform, or aggregate the provided API data as needed to directly answer the user's request.
4. Format dates into user-friendly readable formats.
5. Always provide complete, comprehensive responses.

### API Info
Name: ${api.name}
Description: ${api.description}

### User Message
"${userMessage}"

${ preCalculatedResults ? `
### Pre-Calculated Mathematical Results (USE THESE - They are 100% accurate):
${JSON.stringify(preCalculatedResults, null, 2)}` : ""}

### Raw API Data
${JSON.stringify(actualData, null, 2)}

---
### Output Instructions
Create a comprehensive HTML response that:
- Uses PRE-CALCULATED RESULTS when available.
- Formats data appropriately: <table> for tabular data, <ul> for lists, <p> for descriptions.
- Always starts with an introduction <p> sentence.
- Ends with a <div class="summary"> containing total counts and key insights.
${api?.isSuitableForGraph ? `<p class="followup-message">Would you like me to turn this into a graph or chart for easier analysis?</p>`: ""}
- Output only valid HTML.
- End with exactly: ###END###
`;

        const messages = [
            {
                role: "system",
                content: "You are a data analysis assistant. You will receive a detailed instruction block to format a response based on provided data and conversation history.",
            },
            // Include full conversation history
            ...cleanHistory,
            { role: "user", content: currentTurnContext },
        ];
             
        // 🔹 ADD THIS DEBUG LOG BEFORE OPENAI CALL:
console.log("=== OPENAI MESSAGES DEBUG ===");
console.log("Total messages sent to OpenAI:", messages.length);
messages.forEach((msg, index) => {
    console.log(`--- Message ${index} [${msg.role}] ---`);
    console.log(msg.content.substring(0, 200) + (msg.content.length > 200 ? '...' : ''));
    console.log(`Length: ${msg.content.length} chars`);
});
console.log("=== END OPENAI MESSAGES DEBUG ===");

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
            temperature: 0,
            stream: true,
        });

        for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta?.content || "";
            if (!delta) continue;
            fullText += delta;
            if (fullText.includes("###END###")) break;
            const cleaned = delta.replace(/###\s*END\s*###/gi, "");
            if (cleaned && onStream) onStream(cleaned);
        }
        const finalReply = fullText.replace(/###END###/g, "").trim();

        // ❗️ REMOVED: All database update logic (`Session.updateOne`) is now handled in chat.controller.js.

        console.log(`✅ HYBRID response formatting completed.`);
        return {
            userReply: finalReply,
            // Pass the raw data back so the controller can save it to the session memory.
            actualData: actualData, 
            params,
            api,
        };
    } catch (err) {
        console.error("❌ processIntentAndFormatResponse error:", err);
        return {
            userReply: "I'm sorry, I had trouble formatting the data.",
            params,
            api,
        };
    }
};

module.exports = processIntentAndFormatResponse;