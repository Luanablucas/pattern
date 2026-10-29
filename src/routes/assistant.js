"use strict";
const createController=require("../controllers/assistant");
const {asyncRoute}=require("../middleware/api");
module.exports=function register(app,db){
  const controller=createController(db);
  app.get("/api/assistant/status",controller.status);
  app.post("/api/assistant/chat",controller.assistantLimiter,asyncRoute(controller.chat));
};
