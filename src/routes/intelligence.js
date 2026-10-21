"use strict";
const createController=require("../controllers/intelligence");
const {asyncRoute,uuidRoute}=require("../middleware/api");
module.exports=function register(app,db){
  const controller=createController(db);
  app.get("/api/intelligence",asyncRoute(controller.list));
  app.post("/api/intelligence/generate",asyncRoute(controller.generate));
  app.post("/api/intelligence/:id/accept",uuidRoute,asyncRoute(controller.accept));
  app.post("/api/intelligence/:id/dismiss",uuidRoute,asyncRoute(controller.dismiss));
};
