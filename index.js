const express = require("express");
const bodyParser = require("body-parser");
require("dotenv").config();
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
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

app.get("/chatapi", async (req, res) => {
	console.log("Health Check Endpoint Hit");
	res.send(`Server Running on ${PORT}....`);
});
app.get("/chatapi/health", async (req, res) => {
	console.log("Health Check Endpoint Hit");
	res.send(`Server Running on ${PORT} , updated on 10/11/25....`);
});

app.listen(PORT, () => {
	console.log(`🤖 Server running at port ${PORT}`);
});
