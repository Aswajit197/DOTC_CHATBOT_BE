const Widget = require("../model/widget.model");
const apiListData = require("../../apiDetails");
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
		const { widgetLastIntent, widgetLastParams, widgetLastResponse, widgetSampleJSON, _id } = req.body;
		let allResults = [];

		// 🔹 Check if multi-intent
		if (widgetLastIntent.includes(",")) {
			const intents = widgetLastIntent.split(",").map((s) => s.trim());
			for (const intent of intents) {
				const matchedApi = apiListData.find((api) => api.name === intent);

				if (!matchedApi) {
					return res.status(400).json({ error: `No matching API found for intent: ${intent}` });
				}

				const apiResponse = await matchedApi.multiHandler(widgetLastParams);
				allResults.push({
					api: intent,
					rawData: apiResponse?.data || [],
					exampleResponse: matchedApi.exampleResponse,
				});
			}
		} else {
			// 🔹 Single intent
			const matchedApi = apiListData.find((api) => api.name === widgetLastIntent);

			if (!matchedApi) {
				return res.status(400).json({ error: "No matching API found for the given intent." });
			}

			const apiResponse = await matchedApi.multiHandler(widgetLastParams);
			allResults.push({
				api: widgetLastIntent,
				rawData: apiResponse?.data || [],
				exampleResponse: matchedApi.exampleResponse,
			});
		}

		// 🔹 Build system prompt
		let systemPrompt = `
You are an assistant that converts raw API response data into a structured JSON array format.
- Input: Raw JSON data (from one or more APIs).
- Output: Valid JSON array of objects, matching the example structure exactly.
- Try to convert values into appropriate types (numbers, strings).
- Do not add any extra text, explanation, or formatting outside valid JSON.

Here is an example JSON structure you MUST match exactly:
${JSON.stringify(widgetSampleJSON, null, 2)}
`;

		const userPrompt = `
User message: "${widgetLastResponse}"

Raw API data (from ${allResults.length} intent${allResults.length > 1 ? "s" : ""}):
${JSON.stringify(allResults, null, 2)}
`;

		// 🔹 OpenAI call
		const completion = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			temperature: 0,
		});

		let structuredJson;
		try {
			structuredJson = JSON.parse(completion.choices[0].message.content.trim());
		} catch (err) {
			console.error("Failed to parse OpenAI JSON:", err);
			return res.status(500).json({ error: "OpenAI returned invalid JSON." });
		}

		// 🔹 Save in DB
		const updatedWidget = await Widget.findByIdAndUpdate(_id, { widgetSampleJSON: structuredJson }, { new: true });

		if (!updatedWidget) {
			return res.status(404).json({ error: "Widget not found." });
		}

		res.status(200).json({
			message: "Widget refreshed successfully.",
			widget: updatedWidget,
		});
	} catch (err) {
		console.error("Error refreshing widget:", err);
		res.status(500).json({ error: "Widget refresh failed", details: err.message });
	}
};

module.exports = widget;
