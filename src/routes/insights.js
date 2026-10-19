"use strict";
const createController=require("../controllers/insights");
const {asyncRoute,uuidRoute}=require("../middleware/api");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/api/insights",asyncRoute(controller.list));
};
