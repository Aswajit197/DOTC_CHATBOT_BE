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

		// Step 1: Find matched API and get filtered raw API response data
		const matchedApi = apiListData.find((api) => api.name === widgetLastIntent);

		if (!matchedApi) {
			return res.status(400).json({ error: "No matching API found for the given intent." });
		}

		const apiResponse = await matchedApi.multiHandler(widgetLastParams);
		const filteredApiData = apiResponse.data;

		// Step 2: Build OpenAI system prompt with example schema guidance
		let systemPrompt = `
You are an assistant that converts raw API response data into a structured JSON array format.
- Input: Raw JSON data (stringified).
- Output: Valid JSON array of objects, matching the example structure exactly.
- Try to convert values into appropriate types (e.g., numbers, strings).
- Do not add any extra text, explanation, or formatting outside valid JSON.

Here is an example JSON structure you MUST match exactly:
${JSON.stringify(widgetSampleJSON, null, 2)}
`;

		const userPrompt = `
User message: "${widgetLastResponse}"

Raw API data:
${JSON.stringify(filteredApiData, null, 2)}
`;

		// Step 3: Call OpenAI directly
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

		// Step 4: Update the Widget in DB
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
