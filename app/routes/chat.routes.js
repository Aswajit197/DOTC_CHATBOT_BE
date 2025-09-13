const chatController = require("../controller/chat.controller");

module.exports = (router) => {
	router.get("/chats/:userId", chatController.getSessionsByUserId);
	router.get("/chat", chatController.sendMessage);
	router.post("/chat/session", chatController.createSession);
};
