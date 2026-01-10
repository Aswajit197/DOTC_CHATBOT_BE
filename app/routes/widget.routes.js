const widgetController = require("../controller/widget.controller");

module.exports = (router) => {
	router.post("/widget/create", widgetController.addWidget);
	router.post("/tableWidget/create", widgetController.addTableWidget);
	router.get("/widgets", widgetController.getWidget);
	router.get("/widgets/:clientId", widgetController.getWidgetByClientId);
	router.delete("/widget/:id", widgetController.deleteWidget); // DELETE route
	router.post("/widget/refresh/:id", widgetController.refreshWidget);
};
