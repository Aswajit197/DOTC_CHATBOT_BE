const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Session = require("../model/session.model");

function calculateSum(fieldName, values) {
    console.log("🔢 calculateSum called:", { fieldName, valuesCount: values.length, values: values.slice(0, 3) });
    const total = values.reduce((sum, val) => sum + val, 0);
    const result = {
        operation: "sum",
        field: fieldName,
        total: total,
        count: values.length
    };
    console.log("🔢 calculateSum result:", result);
    return result;
}

function calculateAverage(fieldName, values) {
    console.log("📊 calculateAverage called:", { fieldName, valuesCount: values.length });
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
    console.log("📊 calculateAverage result:", result);
    return result;
}

function calculateMinMax(fieldName, values) {
    console.log("⬆️⬇️ calculateMinMax called:", { fieldName, valuesCount: values.length });
    if (values.length === 0) return { field: fieldName, min: null, max: null };
    const result = {
        operation: "min_max",
        field: fieldName,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length
    };
    console.log("⬆️⬇️ calculateMinMax result:", result);
    return result;
}

function calculateDeviation(fieldName, values) {
    console.log("📈 calculateDeviation called:", { fieldName, valuesCount: values.length });
    if (values.length === 0) return { field: fieldName, deviation: 0 };
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const result = {
        operation: "standard_deviation",
        field: fieldName,
        average: Math.round(avg * 100) / 100,
        standardDeviation: Math.round(Math.sqrt(variance) * 100) / 100,
        count: values.length
    };
    console.log("📈 calculateDeviation result:", result);
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
    console.log("🚀 === STARTING processIntentAndFormatResponse ===");
    console.log("📝 User Message:", userMessage);
    console.log("🔧 API Name:", api?.name);
    console.log("📊 Data Length:", Array.isArray(actualData) ? actualData.length : typeof actualData);
    console.log("🎛️ Has onStream callback:", typeof onStream === 'function');
    
    let fullText = "";
    
    try {
        const tools = [
            {
                type: "function",
                function: {
                    name: "calculateSum",
                    description: "Calculate sum of numeric values",
                    parameters: {
                        type: "object",
                        properties: {
                            fieldName: { type: "string" },
                            values: { type: "array", items: { type: "number" } }
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
                            fieldName: { type: "string" },
                            values: { type: "array", items: { type: "number" } }
                        },
                        required: ["fieldName", "values"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "calculateMinMax",
                    description: "Calculate minimum and maximum values",
                    parameters: {
                        type: "object",
                        properties: {
                            fieldName: { type: "string" },
                            values: { type: "array", items: { type: "number" } }
                        },
                        required: ["fieldName", "values"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "calculateDeviation",
                    description: "Calculate standard deviation",
                    parameters: {
                        type: "object",
                        properties: {
                            fieldName: { type: "string" },
                            values: { type: "array", items: { type: "number" } }
                        },
                        required: ["fieldName", "values"]
                    }
                }
            }
        ];

        const prompt = `
You're a smart assistant. Your task is to:
1. Understand the user's intent from their message.
2. Filter/transform the provided API data accordingly.
3. When the user request ("${userMessage}") includes a numeric threshold 
   (e.g., "at least 800 hours", maximum, minimum, average, sum, greater, less), 
   always use function tools for calculating those values.
   you MUST strictly filter the Raw API Data so that only items meeting that condition remain.
4. Never include items that fail the condition, even partially.
5. Generate a user-friendly response that directly answers the user's message.

---

### API Info
Name: ${api.name}
Description: ${api.description}

### User Message:
"${userMessage}"

### Query Parameters:
${JSON.stringify(params, null, 2)}

### Example Response Format:
${JSON.stringify(exampleResponse, null, 2)}

### Raw API Data:
${JSON.stringify(actualData, null, 2)}

---

### Instructions
Decide the HTML output format dynamically based on intent and API description:

- If the **user message** explicitly asks for "table", "tabular" or if the **API description** indicates tabular data, then format the reply as an HTML <table> with <thead>, <tbody>, <tr>, <th>, <td>.
- If the data is best represented as a **list**, use <ul><li>...</li></ul>.
- If userMessage intent is for specific one driver id or LMDP ID try to send in list format.
- Try to provide complete list/table always if user message don't contains any filter action.
- If the data is descriptive or narrative, use <p>...</p>.
- If the data contains date string send in proper user readable format.
- Always start with a <p> introduction sentence before table or list.

- **Add a final HTML summary block immediately before the optional follow-up visualization message**:
  - • One <div class="summary"><p>...</p></div> that must include:  
        - The exact total count of rows/entities in the table  
        - 1-2 additional meaningful insights (e.g., distribution of overtime preferences, highest/lowest values)  
    • Never use vague phrases like "several", "some", "a few". Always compute and display the precise number. 
${
    api?.isSuitableForGraph
        ? `- After the summary block, if the refined data is numeric, time-based, comparative, or trend-related, add the follow-up line:
    <p class="followup-message">Would you like me to turn this into a visualization, such as a graph or chart?</p>
  - Do NOT add the follow-up if the response is just a single value, a short list, or purely descriptive text.`
        : `- Do NOT add any follow-up visualization message.`
}

- Do not include Markdown, plain text, or JSON in this section. Only valid HTML.

After finishing the HTML reply, summary, and optional follow-up message, output a new line with exactly:
###END###
`;

        console.log("📤 About to call OpenAI with streaming...");
        const messages = [{ role: "user", content: prompt }];
        
        console.log("🔑 API Key exists:", !!process.env.OPENAI_API_KEY);
        console.log("🔑 API Key length:", process.env.OPENAI_API_KEY?.length || 0);
        console.log("📝 Messages array:", messages.length);
        console.log("🛠️ Tools count:", tools.length);
        
        let completion;
        try {
            console.log("⏳ Making OpenAI call...");
            completion = await Promise.race([
                openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages,
                    temperature: 0,
                    tools,
                    tool_choice: "auto",
                    stream: true,
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('OpenAI call timeout after 30s')), 30000)
                )
            ]);
            console.log("✅ OpenAI call successful, got completion object");
        } catch (timeoutOrError) {
            console.error("❌ OpenAI call failed:", timeoutOrError.message);
            
            // Try without tools as fallback
            console.log("🔄 Retrying without tools...");
            completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages,
                temperature: 0,
                stream: true,
            });
            console.log("✅ Fallback call successful");
        }
        
        console.log("✅ OpenAI call initiated, starting stream processing...");

        let currentToolCalls = [];
        let assistantMessage = "";
        let needsToolExecution = false;
        let chunkCount = 0;

        // Process the stream
        for await (const chunk of completion) {
            chunkCount++;
           
            
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            
            // Handle tool calls
            if (delta?.tool_calls) {
                console.log("🔧 Tool calls detected in chunk:", delta.tool_calls.length);
                for (const toolCall of delta.tool_calls) {
                    console.log("🔧 Tool call details:", {
                        index: toolCall.index,
                        id: toolCall.id,
                        name: toolCall.function?.name,
                        argsLength: toolCall.function?.arguments?.length || 0
                    });
                    
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
                continue; // Don't stream tool calls
            }
            
            // Handle regular content
            const content = delta?.content || "";
            if (content) {
                console.log("📄 Content chunk received:", {
                    length: content.length,
                    preview: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
                    hasEndMarker: content.includes('###END###')
                });
                
                fullText += content;
                assistantMessage += content;
                
                // Stop when END marker appears
                if (fullText.includes("###END###")) {
                    console.log("🔚 END marker found, stopping stream");
                    break;
                }
                
                const cleaned = content.replace(/###\s*END\s*###/gi, "");
                if (cleaned && onStream) {
                    const formatted = cleaned
                        .replace(/([a-z])([A-Z])/g, "$1 $2")
                        .replace(/(\d)([A-Za-z])/g, "$1 $2")
                        .replace(/([a-zA-Z])(\d)/g, "$1 $2");
                   
                    onStream(formatted);
                } else if (cleaned) {
                    console.log("⚠️ Content cleaned but not streamed (no onStream callback)");
                }
            }
            
            // Check if the stream is finished and we have tool calls
            if (choice?.finish_reason === 'tool_calls' && needsToolExecution) {
                console.log("🔧 Stream finished with tool_calls, executing tools...");
                console.log("🔧 Current tool calls:", currentToolCalls.filter(Boolean).map(tc => ({
                    name: tc.function?.name,
                    argsLength: tc.function?.arguments?.length
                })));
                
                // Execute tools and continue conversation
                const toolResults = [];
                
                for (const toolCall of currentToolCalls.filter(Boolean)) {
                    console.log("⚙️ Executing tool:", toolCall.function.name);
                    try {
                        const args = JSON.parse(toolCall.function.arguments || "{}");
                        console.log("⚙️ Tool arguments:", args);
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
                        }
                        
                        if (result) {
                            toolResults.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(result)
                            });
                            console.log("✅ Tool result added to queue");
                        }
                    } catch (err) {
                        console.error("❌ Tool execution error:", err);
                    }
                }
                
                console.log("🔄 Making continuation call with", toolResults.length, "tool results");
                
                // Continue conversation with tool results
                const continueMessages = [
                    ...messages,
                    { role: "assistant", content: assistantMessage, tool_calls: currentToolCalls.filter(Boolean) },
                    ...toolResults
                ];
                
                const continueCompletion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: continueMessages,
                    temperature: 0,
                    stream: true,
                });
                
                
                let continueChunkCount = 0;
                
                // Stream the continuation
                for await (const continueChunk of continueCompletion) {
                    continueChunkCount++;
                    
                    
                    const continueDelta = continueChunk.choices?.[0]?.delta?.content || "";
                    if (!continueDelta) continue;
                    
                    
                    
                    fullText += continueDelta;
                    if (fullText.includes("###END###")) {
                        
                        break;
                    }
                    
                    const cleaned = continueDelta.replace(/###\s*END\s*###/gi, "");
                    if (cleaned && onStream) {
                        const formatted = cleaned
                            .replace(/([a-z])([A-Z])/g, "$1 $2")
                            .replace(/(\d)([A-Za-z])/g, "$1 $2")
                            .replace(/([a-zA-Z])(\d)/g, "$1 $2");
                      
                        onStream(formatted);
                    }
                }
                console.log("🏁 Continuation stream complete");
                break; // Exit main loop after tool execution
            } else if (choice?.finish_reason && choice.finish_reason !== 'tool_calls') {
               
                break;
            }
        }
        
    
        
        // Save session
        const finalReply = fullText.replace(/###END###/g, "").trim();
       
        
        await Session.updateOne(
            { _id: session._id },
            {
                $set: {
                    lastResponseMessage: finalReply,
                    lastSuccessUserMessage: userMessage,
                    lastSuccessIntent: api?.name || null,
                    lastSuccessApiResponse: actualData,
                    lastSuccessParams: params,
                    missingField: null
                }
            }
        );
        
       
        return { userReply: finalReply, params, api };
        
    } catch (err) {
        console.error(" === ERROR IN processIntentAndFormatResponse ===");
        console.error("Error details:", {
            message: err.message,
            stack: err.stack?.substring(0, 500),
            name: err.name
        });
        
        return {
            userReply: "Here's the available data. (Intent-based personalization failed.)",
            params,
            api
        };
    }
};

module.exports = processIntentAndFormatResponse;