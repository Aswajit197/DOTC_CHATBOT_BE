const chatController = require("../controller/chat.controller");

module.exports = (router) => {
	router.get("/chats/:userId/:ClientId", chatController.getSessionsByUserId);
	// router.get("/chat", chatController.sendMessage);
	router.post("/chat", chatController.sendMessage);
	router.post("/chat/session", chatController.createSession);
	router.put("/chat/session/refresh", chatController.refreshDriverList);
};
