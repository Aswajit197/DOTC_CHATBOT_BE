const Widget = require("../model/widget.model");
const apiListData = require("../../apiDetails");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractJsonFromTable(htmlString, intent) {
	try {
		let exampleResponse = null;

		// If this API has a sample response → follow its structure
		if (intent) {
			const matchedApi = apiListData.find((api) => api.name === intent);
			if (matchedApi?.exampleResponse) {
				exampleResponse = matchedApi.exampleResponse;
			}
		}

		let systemPrompt = `
You convert HTML table or list content into a JSON array.
Rules:
- Output ONLY valid JSON.
- Detect table headers to form keys.
- Each row becomes an object.
- Convert number-like strings to numbers (e.g. "40 hours" → 40).
`;

		if (exampleResponse) {
			systemPrompt += `
Follow this exact JSON structure when creating keys:
${JSON.stringify(exampleResponse, null, 2)}
`;
		}

		// Call OpenAI
		const response = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: htmlString },
			],
			temperature: 0,
		});

		let raw = response.choices[0].message.content.trim();

		// Parse JSON safely
		return JSON.parse(raw);
	} catch (err) {
		console.error("extractJsonFromTable error:", err);
		return null;
	}
}

// Chat Controller
const widget = {};

// 🔹 Create Widget Controller
widget.addWidget = async (req, res) => {
	try {
		const {
			userId,
			ClientId,
			widgetName,
			widgetDescription,
			widgetType,
			widgetLastIntent,
			widgetLastResponse,
			widgetLastUserMessage,
			widgetLastParams,
			widgetLastFilterParams,
			widgetSampleJSON,
		} = req.body;

		// Basic validation
		if (!userId || !ClientId) {
			return res.status(400).json({ error: "userId and ClientId are required" });
		}

		// Create new widget
		const newWidget = new Widget({
			userId,
			ClientId,
			widgetName,
			widgetDescription,
			widgetType,
			widgetLastIntent,
			widgetLastResponse,
			widgetLastUserMessage,
			widgetLastParams,
			widgetLastFilterParams,
			widgetSampleJSON,
		});

		// Save to DB
		const savedWidget = await newWidget.save();

		res.status(201).json({
			message: "Widget created successfully",
			data: savedWidget,
		});
	} catch (err) {
		console.error("Error creating widget:", err);
		res.status(500).json({ error: "Widget creation failed", details: err.message });
	}
};

widget.addTableWidget = async (req, res) => {
	try {
		const {
			userId,
			ClientId,
			widgetName,
			widgetDescription,
			widgetLastIntent,
			widgetLastResponse, // <-- Contains table HTML
			widgetLastUserMessage,
			widgetLastParams,
		} = req.body;

		console.log(req.body, "request body for table widget");

		if (!userId || !ClientId) {
			return res.status(400).json({ error: "userId and ClientId are required" });
		}

		// 1️⃣ Extract JSON from table HTML
		const parsedJSON = await extractJsonFromTable(widgetLastResponse, widgetLastIntent);

		if (!parsedJSON) {
			return res.status(500).json({
				error: "Failed to extract JSON from HTML table.",
			});
		}

		// 2️⃣ Save the new widget
		const newWidget = new Widget({
			userId,
			ClientId,
			widgetName,
			widgetDescription,
			widgetType: "table",
			widgetLastIntent,
			widgetLastResponse,
			widgetLastUserMessage,
			widgetLastParams,
			widgetSampleJSON: parsedJSON, // ← extracted JSON saved
		});

		const savedWidget = await newWidget.save();

		res.status(201).json({
			message: "Table widget created successfully",
			data: savedWidget,
		});
	} catch (err) {
		console.error("Error creating table widget:", err);
		res.status(500).json({
			error: "Table widget creation failed",
			details: err.message,
		});
	}
};

// 🔹 Get Widget Controller
widget.getWidget = async (req, res) => {
	try {
		const { id } = req.params;
		let widgetData;
		if (id) {
			// Fetch a single widget by ID
			widgetData = await Widget.findById(id);
			if (!widgetData) {
				return res.status(404).json({ error: "Widget not found" });
			}
		} else {
			// Fetch all widgets
			widgetData = await Widget.find();
		}

		res.status(200).json({
			message: "Widget(s) fetched successfully",
			data: widgetData,
		});
	} catch (err) {
		console.error("Error fetching widget(s):", err);
		res.status(500).json({ error: "Widget fetch failed", details: err.message });
	}
};
widget.getWidgetByClientId = async (req, res) => {
	try {
		const { clientId } = req.params;
		const widgetData = await Widget.find({ ClientId: clientId });

		res.status(200).json({
			message: "Widget(s) fetched successfully",
			data: widgetData,
		});
	} catch (err) {
		console.error("Error fetching widget(s):", err);
		res.status(500).json({ error: "Widget fetch failed", details: err.message });
	}
};

// 🔹 Delete Widget Controller
widget.deleteWidget = async (req, res) => {
	try {
		const { id } = req.params;
		const { userId, ClientId } = req.body;

		// Validate required fields
		if (!id || !userId || !ClientId) {
			return res.status(400).json({ error: "id, userId, and ClientId are required" });
		}

		// Find the widget by ID
		const existingWidget = await Widget.findById(id);

		if (!existingWidget) {
			return res.status(404).json({ error: "Widget not found" });
		}

		// Check if userId and ClientId match
		// if (
		// 	existingWidget.userId !== userId ||
		// 	existingWidget.ClientId !== ClientId
		// ) {
		// 	return res.status(403).json({ error: "Unauthorized to delete this widget" });
		// }

		// Delete the widget
		await Widget.findByIdAndDelete(id);

		res.status(200).json({
			message: "Widget deleted successfully",
		});
	} catch (err) {
		console.error("Error deleting widget:", err);
		res.status(500).json({ error: "Widget deletion failed", details: err.message });
	}
};

widget.refreshWidget = async (req, res) => {
	try {
		console.log("=== REFRESH WIDGET START ===");
		console.log("Request Body:", JSON.stringify(req.body, null, 2));

		const { widgetLastIntent, widgetLastParams, widgetLastResponse, widgetSampleJSON, _id, widgetLastFilterParams } = req.body;

		console.log("📋 Extracted Parameters:");
		console.log("  - Intent:", widgetLastIntent);
		console.log("  - Filter Params:", JSON.stringify(widgetLastFilterParams, null, 2));
		console.log("  - Has Filters:", !!(widgetLastFilterParams && Object.keys(widgetLastFilterParams).length > 0));

		let allResults = [];
		// 🔹 Check if multi-intent
		if (widgetLastIntent.includes(",")) {
			console.log("🔀 Multi-intent detected");
			const intents = widgetLastIntent.split(",").map((s) => s.trim());
			console.log("  Intents:", intents);

			for (const intent of intents) {
				const matchedApi = apiListData.find((api) => api.name === intent);

				if (!matchedApi) {
					console.error(`❌ No API found for intent: ${intent}`);
					return res.status(400).json({ error: `No matching API found for intent: ${intent}` });
				}

				console.log(`  ✅ Calling API for: ${intent}`);
				const apiResponse = await matchedApi.multiHandler(widgetLastParams);
				console.log(`  📊 API Response for ${intent}:`, {
					dataLength: apiResponse?.data?.length || 0,
					sample: apiResponse?.data?.[0] || null,
				});

				allResults.push({
					api: intent,
					rawData: apiResponse?.data || [],
					exampleResponse: matchedApi.exampleResponse,
				});
			}
		} else {
			// 🔹 Single intent
			console.log("🎯 Single intent detected:", widgetLastIntent);
			const matchedApi = apiListData.find((api) => api.name === widgetLastIntent);

			if (!matchedApi) {
				console.error("❌ No matching API found for intent:", widgetLastIntent);
				return res.status(400).json({ error: "No matching API found for the given intent." });
			}

			console.log("  ✅ Calling API for:", widgetLastIntent);
			const apiResponse = await matchedApi.multiHandler(widgetLastParams);
			console.log("  📊 API Response:", {
				dataLength: apiResponse?.data?.length || 0,
				sample: apiResponse?.data?.[0] || null,
			});

			allResults.push({
				api: widgetLastIntent,
				rawData: apiResponse?.data || [],
				exampleResponse: matchedApi.exampleResponse,
			});
		}

		console.log("\n📦 All Results Summary:");
		console.log("  Total APIs called:", allResults.length);
		allResults.forEach((result, idx) => {
			console.log(`  [${idx}] ${result.api}: ${result.rawData.length} records`);
		});

		// 🔹 Build system prompt with stronger filtering emphasis
		let systemPrompt = `
You are a data filtering and formatting assistant. Your job is to:
1. Filter raw API data based on provided filter parameters
2. Format the filtered data to match the exact JSON structure provided

CRITICAL RULES:
- When filter parameters are provided, you MUST filter the data first before formatting
- ONLY return data that matches ALL filter criteria exactly
- Match filter values precisely (compare numbers as numbers, strings as strings)
- Look for the filter field in various formats (driverId, DriverId, driver_id, id, etc.)
- If no matches are found after filtering, return an empty array []
- Output ONLY valid JSON - no explanations, no markdown, no extra text

Target JSON structure to match:
${JSON.stringify(widgetSampleJSON, null, 2)}
`;

		// 🔹 Build user prompt with explicit filtering steps
		let userPrompt = "";
		const hasFilters = widgetLastFilterParams && Object.keys(widgetLastFilterParams).length > 0;

		console.log("\n🤖 Preparing OpenAI Request:");
		console.log("  Filtering Mode:", hasFilters ? "ACTIVE" : "INACTIVE");

		if (hasFilters) {
			console.log("  🔍 Active Filters:", JSON.stringify(widgetLastFilterParams, null, 2));

			userPrompt = `
FILTERING MODE: ACTIVE
Step 1: MANDATORY - Apply these filters to the raw data:
${JSON.stringify(widgetLastFilterParams, null, 2)}
Step 2: Format ONLY the filtered results to match the target JSON structure.

Context:
- Original Intent: "${widgetLastIntent}"
- Original Response: "${widgetLastResponse}"

Raw API data to filter and format:
${JSON.stringify(allResults, null, 2)}

CRITICAL: If driverId filter is ${widgetLastFilterParams.driverId}, you MUST only return data where the driver's ID matches ${
				widgetLastFilterParams.driverId
			} exactly. Ignore all other records.
`;
		} else {
			console.log("  ℹ️ No filters - formatting all data");

			userPrompt = `
Format all the raw API data to match the target JSON structure.

Original Intent: "${widgetLastIntent}"
Original Response: "${widgetLastResponse}"

Raw API data:
${JSON.stringify(allResults, null, 2)}
`;
		}

		console.log("  📝 User Prompt Length:", userPrompt.length, "characters");

		// 🔹 OpenAI call
		console.log("\n⏳ Calling OpenAI API...");
		const startTime = Date.now();

		const completion = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			temperature: 0,
			max_tokens: 2000,
		});

		const elapsed = Date.now() - startTime;
		console.log(`✅ OpenAI Response received in ${elapsed}ms`);
		console.log("  Token Usage:", completion.usage);
		console.log("  Raw Response Preview:", completion.choices[0].message.content.substring(0, 200) + "...");

		let structuredJson;
		try {
			const content = completion.choices[0].message.content.trim();
			// Remove potential markdown code blocks
			const cleanContent = content.replace(/```json\n?/g, "").replace(/```\n?/g, "");

			console.log("\n🔄 Parsing OpenAI JSON response...");
			structuredJson = JSON.parse(cleanContent);
			console.log("✅ JSON Parsed Successfully");
			console.log("  Result Type:", Array.isArray(structuredJson) ? "Array" : typeof structuredJson);
			console.log("  Result Length:", Array.isArray(structuredJson) ? structuredJson.length : "N/A");

			if (hasFilters && Array.isArray(structuredJson)) {
				console.log("\n🔍 Validating Filter Application:");
				console.log("  Expected Filter:", widgetLastFilterParams);
				console.log("  Records Returned:", structuredJson.length);

				if (structuredJson.length > 0) {
					console.log("  First Record Sample:", JSON.stringify(structuredJson[0], null, 2));

					// Check if filter was actually applied
					if (widgetLastFilterParams.driverId) {
						const matchingRecords = structuredJson.filter((record) => {
							const recordDriverId = record.driverId || record.DriverId || record.driver_id || record.id;
							return recordDriverId == widgetLastFilterParams.driverId;
						});

						console.log(`  ✓ Records matching driverId ${widgetLastFilterParams.driverId}:`, matchingRecords.length);

						if (matchingRecords.length !== structuredJson.length) {
							console.warn("  ⚠️ WARNING: Filter may not have been applied correctly!");
							console.warn(
								`  Expected all ${structuredJson.length} records to match driverId ${widgetLastFilterParams.driverId}`,
							);
						} else {
							console.log("  ✅ Filter validation passed!");
						}
					}
				} else {
					console.log("  ⚠️ Empty result - no matching records found");
				}
			}
		} catch (err) {
			console.error("❌ Failed to parse OpenAI JSON:", err);
			console.error("Raw response:", completion.choices[0].message.content);
			return res.status(500).json({ error: "OpenAI returned invalid JSON." });
		}

		console.log("\n📊 Structured JSON:", JSON.stringify(structuredJson, null, 2));

		// 🔹 Get widget from DB (without updating)
		console.log("\n🔍 Fetching widget from DB:", _id);
		const widget = await Widget.findById(_id);

		if (!widget) {
			console.error("❌ Widget not found:", _id);
			return res.status(404).json({ error: "Widget not found." });
		}

		console.log("✅ Widget found:", widget._id);

		// 🔹 Send response with refreshed data (not saved to DB)
		console.log("\n📤 Sending response...");
		const response = {
			message: "Widget refreshed successfully.",
			widget: {
				...widget.toObject(),
				widgetSampleJSON: structuredJson, // Send refreshed data without saving
			},
		};

		console.log("  Response includes:", {
			widgetId: widget._id,
			dataRecords: Array.isArray(structuredJson) ? structuredJson.length : "N/A",
			filtersApplied: widgetLastFilterParams || "None",
		});

		console.log("=== REFRESH WIDGET SUCCESS ===\n");

		res.status(200).json(response);
	} catch (err) {
		console.error("\n❌ === REFRESH WIDGET ERROR ===");
		console.error("Error:", err);
		console.error("Stack:", err.stack);
		console.error("=================================\n");

		res.status(500).json({ error: "Widget refresh failed", details: err.message });
	}
};
module.exports = widget;
