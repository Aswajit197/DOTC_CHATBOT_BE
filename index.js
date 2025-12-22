const express = require("express");
const bodyParser = require("body-parser");
require("dotenv").config();
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { startLmdpAutoRefresh, startLmdpAutoRefreshWithInterval, startWeekDaysAutoRefreshWithInterval, startWeekDaysAutoRefresh } = require("./app/schedulers/lmdpScheduler");
const router = express.Router();
const app = express();
const PORT = process.env.PORT;

const routes = [];
const routesPath = path.join(__dirname, "app/routes");
const routeFiles = fs.readdirSync(routesPath);
routeFiles.forEach((routeFile) => {
	if (routeFile !== "index.js" && routeFile.endsWith(".js")) {
		routes.push("app/routes/" + routeFile);
		const routeModule = require(path.join(routesPath, routeFile));
		routeModule(router);
	}
});
app.use(bodyParser.json());
app.use(cors());
app.use("/chatapi", router);

mongoose
	.connect(process.env.MONGO_URL)
	.then(() => console.log(`MongoDB connected `))
	.catch((err) => console.error("MongoDB error:", err));

// ============================================
// START AUTOMATED LMDP REFRESH
// ============================================
mongoose.connection.once("open", () => {
	startLmdpAutoRefresh();
	startWeekDaysAutoRefresh();
});

app.get("/chatapi", async (req, res) => {
	console.log("Health Check Endpoint Hit");
	res.send(`Server Running on ${PORT}....`);
});
app.get("/chatapi/health", async (req, res) => {
	console.log("Health Check Endpoint Hit");
	res.send(`Server Running on ${PORT} , updated on 10/11/25....`);
});

app.get("/chatapi/health/mongo", async (req, res) => {
	try {
		const state = mongoose.connection.readyState;

		// 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
		const states = {
			0: "Disconnected",
			1: "Connected",
			2: "Connecting",
			3: "Disconnecting",
		};

		res.json({
			mongoStatus: states[state],
			code: state,
			success: state === 1,
		});
	} catch (err) {
		console.error("Mongo Health Error:", err);
		res.status(500).json({
			mongoStatus: "Error",
			error: err.message,
			success: false,
		});
	}
});


app.listen(PORT, () => {
	console.log(`🤖 Server running at port ${PORT}`);
});
