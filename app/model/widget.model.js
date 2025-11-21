const mongoose = require("mongoose");
const widgetSchema = new mongoose.Schema(
	{
		userId: { type: String, required: true },
		ClientId: { type: String, required: true },
		widgetName: { type: String },
		widgetDescription: { type: String },
		widgetType: { type: String, default: "bar" },
		widgetLastIntent: { type: String },
		widgetLastUserMessage: { type: String },
		widgetLastResponse: { type: mongoose.Schema.Types.Mixed },
		widgetLastParams: { type: mongoose.Schema.Types.Mixed },
		widgetOptionalParams: { type: mongoose.Schema.Types.Mixed },
		widgetSampleJSON: { type: mongoose.Schema.Types.Mixed },
	},
	{ timestamps: true }
);

module.exports = mongoose.model("Widget", widgetSchema);
