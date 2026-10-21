"use strict";
const createController=require("../controllers/theme");
const {asyncRoute}=require("../middleware/api");
module.exports=function register(app,db){
  const controller=createController(db);
  app.get("/api/theme",asyncRoute(controller.read));
  app.put("/api/theme",asyncRoute(controller.update));
};
