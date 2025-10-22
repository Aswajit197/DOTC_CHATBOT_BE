const mongoose = require("mongoose");
const sessionSchema = new mongoose.Schema(
	{
		userId: { type: String, required: true },
		ClientId: { type: String, required: true },
		StationId: { type: String },
		sessionName: { type: String },
		history: [
			{
				sender: String,
				message: String,
				chatType: String, //used for type like visualization in frontend
				data: { type: mongoose.Schema.Types.Mixed },  // api response data for visualization 
				graphContents: {  //only useful/added for visualization type
					lastGraphPrompt: { type: String }, //last success matched Api
					lastGraphResponse: { type: String }, //last success bot response message
					lastGraphParams: { type: mongoose.Schema.Types.Mixed }, // last params used
					lastIntentType: { type: String, enum: ["single", "multi"], default: "single" }, // last params used
					graphType: { type: String, default: "bar" },
				},
				timestamp: Date,
			},
		],
		//last successful bot response , api response etc...
		lastResponseMessage: { type: String },
		lastSuccessUserMessage: { type: String },
		lastSuccessIntent: { type: String },
		lastSuccessApiResponse: { type: mongoose.Schema.Types.Mixed },
		lastSuccessParams: { type: mongoose.Schema.Types.Mixed },
		// 🔹 to persist missing field context (using if user forgot to provide some param in last message and send that for that required missing field in current message)
		missingField: {
			lastMissingFieldBotMessage: { type: String },
			lastMissingApiIntent: { type: String },
			lastParams: { type: mongoose.Schema.Types.Mixed }, // <--- allow object storage
			missingFields: [{ type: String }],
		},
		createdAt: {
			type: Date,
			default: Date.now,
			expires: 5 * 60 * 60 * 24, // 5* 24 hours
		},
	},
	{ timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
