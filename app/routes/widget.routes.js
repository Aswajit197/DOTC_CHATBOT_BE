const widgetController = require("../controller/widget.controller");

module.exports = (router) => {
    router.post("/widget/create", widgetController.addWidget);
    router.get("/widgets", widgetController.getWidget);
};
