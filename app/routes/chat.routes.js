const chatController = require("../controller/chat.controller");

module.exports = (router) => {
	router.post("/chat", chatController.sendMessage);
	router.post("/chat/session", chatController.createSession);
};
