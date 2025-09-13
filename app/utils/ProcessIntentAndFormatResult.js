const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

function calculateSum(fieldName, values) {
    console.log("🔢 Calculating sum for:", fieldName, "values:", values.length);
    const total = values.reduce((sum, val) => sum + val, 0);
    const result = {
        operation: "sum",
        field: fieldName,
        total: total,
        count: values.length
    };
    return result;
}

function calculateAverage(fieldName, values) {
    console.log("📊 Calculating average for:", fieldName);
    if (values.length === 0) {
        return {
            operation: "average",
            field: fieldName,
            average: 0,
            count: 0,
            min: null,
            max: null
        };
    }
    
    const sum = values.reduce((acc, val) => acc + val, 0);
    const average = Math.round((sum / values.length) * 100) / 100;
    
    const result = {
        operation: "average",
        field: fieldName,
        average: average,
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values)
    };
    return result;
}

function calculateMinMax(fieldName, values) {
    if (values.length === 0) return { field: fieldName, min: null, max: null };
    const result = {
        operation: "min_max",
        field: fieldName,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length
    };
    return result;
}

function calculateDeviation(fieldName, values) {
    if (values.length === 0) return { field: fieldName, deviation: 0 };
    if (values.length === 1) {
        return {
            operation: "standard_deviation",
            field: fieldName,
            average: values[0],
            standardDeviation: 0,
            variance: 0,
            count: 1,
            type: "single_value"
        };
    }
    
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    
    const sampleVariance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / (values.length - 1);
    const sampleStdDev = Math.sqrt(sampleVariance);
    
   
    const populationVariance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const populationStdDev = Math.sqrt(populationVariance);
    
    const result = {
        operation: "standard_deviation",
        field: fieldName,
        average: Math.round(avg * 100) / 100,
        sampleStandardDeviation: Math.round(sampleStdDev * 100) / 100,
        populationStandardDeviation: Math.round(populationStdDev * 100) / 100,
        sampleVariance: Math.round(sampleVariance * 100) / 100,
        populationVariance: Math.round(populationVariance * 100) / 100,
        count: values.length,
        type: values.length > 30 ? "large_sample" : "small_sample"
    };
    
    return result;
}

const processIntentAndFormatResponse = async ({
    userMessage,
    api,
    exampleResponse,
    actualData,
    params = {},
    session,
    onStream,
}) => {
    console.log("🚀 Processing intent for:", userMessage);
    
    let fullText = "";
    
    try {
        const tools = [
            {
                type: "function",
                function: {
                    name: "calculateSum",
                    description: "Calculate sum of numeric values from data fields",
                    parameters: {
                        type: "object",
                        properties: {
                            fieldName: { 
                                type: "string", 
                                description: "Name of the field being calculated" 
                            },
                            values: { 
                                type: "array", 
                                items: { type: "number" },
                                description: "Array of numeric values to sum"
                            }
                        },
                        required: ["fieldName", "values"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "calculateAverage",
                    description: "Calculate average, min, max of numeric values",
                    parameters: {
                        type: "object",
                        properties: {
                            fieldName: { 
                                type: "string", 
                                description: "Name of the field being calculated" 
                            },
                            values: { 
                                type: "array", 
                                items: { type: "number" },
                                description: "Array of numeric values to average"
                            }
                        },
                        required: ["fieldName", "values"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "calculateMinMax",
                    description: "Find minimum and maximum values in a dataset",
                    parameters: {
                        type: "object",
                        properties: {
                            fieldName: { 
                                type: "string", 
                                description: "Name of the field being analyzed" 
                            },
                            values: { 
                                type: "array", 
                                items: { type: "number" },
                                description: "Array of numeric values to analyze"
                            }
                        },
                        required: ["fieldName", "values"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "calculateDeviation",
                    description: "Calculate standard deviation and variance of numeric values",
                    parameters: {
                        type: "object",
                        properties: {
                            fieldName: { 
                                type: "string", 
                                description: "Name of the field being analyzed" 
                            },
                            values: { 
                                type: "array", 
                                items: { type: "number" },
                                description: "Array of numeric values for statistical analysis"
                            }
                        },
                        required: ["fieldName", "values"]
                    }
                }
            }
        ];

        // Get conversation history from session for context
        let conversationHistory = [];
        if (session.conversationHistory && session.conversationHistory.length > 0) {
            // Get last 5 messages for context (adjust as needed)
            const recentHistory = session.conversationHistory.slice(-10);
            conversationHistory = recentHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        }

        const systemPrompt = `You are a smart data analysis assistant with conversation context. Your task is to:

1. **Context Awareness**: Use the conversation history to understand the user's ongoing needs and maintain context.
2. **Intent Understanding**: Analyze the current user message in context of previous interactions.
3. **Data Processing**: Filter/transform the provided API data according to user requirements.
4. **Numeric Analysis**: When users request calculations (sum, average, min, max, standard deviation), use the provided function tools.
5. **Filtering**: When numeric thresholds are mentioned (e.g., "at least 800 hours", "maximum", "minimum"), strictly filter data to only include items meeting those conditions.
6. **Response Format**: Generate user-friendly HTML responses that directly answer the user's question.

---

### Conversation History:
${conversationHistory.length > 0 ? JSON.stringify(conversationHistory, null, 2) : "No previous conversation"}

### Current API Context:
Name: ${api?.name || 'Unknown API'}
Description: ${api?.description || 'No description available'}

### Current User Message:
"${userMessage}"

### Query Parameters:
${JSON.stringify(params, null, 2)}

### Example Response Format:
${JSON.stringify(exampleResponse, null, 2)}

### Current API Data:
${JSON.stringify(actualData, null, 2)}

---

### Response Guidelines:

**Format Selection:**
- Use HTML <table> for tabular data or when user asks for "table"/"tabular" format
- Use <ul><li> for lists or multiple items
- Use <p> for descriptive/narrative content
- Always start with an introductory <p> sentence
- Format dates in user-readable format
- Provide complete data unless user specifies filters

**Required Elements:**
1. **Summary Block**: Add before any follow-up message:
   <div class="summary"><p>Total: [EXACT_COUNT] items. [Additional insights]</p></div>
   - Always use exact numbers, never "several", "some", or "a few"
   - Include 1-2 meaningful insights about the data

${
    api?.isSuitableForGraph
        ? `2. **Visualization Offer**: If data is numeric/comparative/trend-related, add:
   <p class="followup-message">Would you like me to turn this into a visualization, such as a graph or chart?</p>
   - Do NOT add for single values or purely descriptive responses`
        : `2. **No Visualization Offers**: Do not suggest visualizations for this API`
}

**Output Format**: HTML only (no Markdown, plain text, or JSON)
**End Marker**: Conclude with exactly: ###END###`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: userMessage }
        ];
        
        console.log("📤 Making OpenAI call with context:", conversationHistory.length, "previous messages");
        
        let completion;
        try {
            completion = await Promise.race([
                openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages,
                    temperature: 0.1,
                    tools,
                    tool_choice: "auto",
                    stream: true,
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('OpenAI timeout')), 30000)
                )
            ]);
        } catch (timeoutOrError) {
            console.error("❌ OpenAI call failed, trying fallback:", timeoutOrError.message);
            
            // Fallback without tools
            completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages,
                temperature: 0.1,
                stream: true,
            });
        }

        let currentToolCalls = [];
        let assistantMessage = "";
        let needsToolExecution = false;

        // Process main stream
        for await (const chunk of completion) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            
            // Handle tool calls
            if (delta?.tool_calls) {
                console.log("🔧 Processing", delta.tool_calls.length, "tool calls");
                for (const toolCall of delta.tool_calls) {
                    if (!currentToolCalls[toolCall.index]) {
                        currentToolCalls[toolCall.index] = {
                            id: toolCall.id,
                            type: 'function',
                            function: { name: toolCall.function?.name || '', arguments: '' }
                        };
                    }
                    
                    if (toolCall.function?.arguments) {
                        currentToolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                    }
                }
                needsToolExecution = true;
                continue;
            }
            
            // Handle content
            const content = delta?.content || "";
            if (content) {
                fullText += content;
                assistantMessage += content;
                
                if (fullText.includes("###END###")) {
                    break;
                }
                
                const cleaned = content.replace(/###\s*END\s*###/gi, "");
                if (cleaned && onStream) {
                    onStream(cleaned);
                }
            }
            
            // Execute tools if needed
            if (choice?.finish_reason === 'tool_calls' && needsToolExecution) {
                console.log("🔧 Executing", currentToolCalls.filter(Boolean).length, "tools");
                
                const toolResults = [];
                
                for (const toolCall of currentToolCalls.filter(Boolean)) {
                    try {
                        const args = JSON.parse(toolCall.function.arguments || "{}");
                        let result;
                        
                        switch (toolCall.function.name) {
                            case "calculateSum":
                                result = calculateSum(args.fieldName, args.values);
                                break;
                            case "calculateAverage":
                                result = calculateAverage(args.fieldName, args.values);
                                break;
                            case "calculateMinMax":
                                result = calculateMinMax(args.fieldName, args.values);
                                break;
                            case "calculateDeviation":
                                result = calculateDeviation(args.fieldName, args.values);
                                break;
                            default:
                                console.log("❌ Unknown tool:", toolCall.function.name);
                                continue;
                        }
                        
                        if (result) {
                            toolResults.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(result)
                            });
                        }
                    } catch (err) {
                        console.error("❌ Tool execution error:", err.message);
                    }
                }
                
                // Continue conversation with tool results
                const continueMessages = [
                    ...messages,
                    { role: "assistant", content: assistantMessage, tool_calls: currentToolCalls.filter(Boolean) },
                    ...toolResults
                ];
                
                const continueCompletion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: continueMessages,
                    temperature: 0.1,
                    stream: true,
                });
                
                // Stream continuation
                for await (const continueChunk of continueCompletion) {
                    const continueDelta = continueChunk.choices?.[0]?.delta?.content || "";
                    if (!continueDelta) continue;
                    
                    fullText += continueDelta;
                    if (fullText.includes("###END###")) {
                        break;
                    }
                    
                    const cleaned = continueDelta.replace(/###\s*END\s*###/gi, "");
                    if (cleaned && onStream) {
                        onStream(cleaned);
                    }
                }
                break;
            } else if (choice?.finish_reason && choice.finish_reason !== 'tool_calls') {
                break;
            }
        }
        
        // Save to session with conversation history
        const finalReply = fullText.replace(/###END###/g, "").trim();
        
        // Update conversation history
        const updatedHistory = [
            ...conversationHistory,
            { role: "user", content: userMessage },
            { role: "assistant", content: finalReply }
        ];
        
        // Keep only last 20 messages to prevent token overflow
        const trimmedHistory = updatedHistory.slice(-20);
        
        await Session.updateOne(
            { _id: session._id },
            {
                $set: {
                    conversationHistory: trimmedHistory,
                    lastResponseMessage: finalReply,
                    lastSuccessUserMessage: userMessage,
                    lastSuccessIntent: api?.name || null,
                    lastSuccessApiResponse: actualData,
                    lastSuccessParams: params,
                    missingField: null
                }
            }
        );
        
        console.log("✅ Response processed successfully");
        return { userReply: finalReply, params, api };
        
    } catch (err) {
        console.error("❌ ERROR in processIntentAndFormatResponse:", err.message);
        
        return {
            userReply: "I encountered an issue processing your request. Here's the available data without personalization.",
            params,
            api
        };
    }
};

module.exports = processIntentAndFormatResponse;