"use strict";
const createController=require("../controllers/weekly-review");
const {asyncRoute}=require("../middleware/api");
module.exports=function register(app,db) {
  const controller=createController(db);
  app.get("/api/weekly-review",asyncRoute(controller.list));
};
