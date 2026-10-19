"use strict";
const createController=require("../controllers/habits");
const {asyncRoute,uuidRoute}=require("../middleware/api");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/api/habits",asyncRoute(controller.list));
app.post("/api/habits",asyncRoute(controller.create));
app.put("/api/habits/:id",uuidRoute,asyncRoute(controller.update));
app.post("/api/habits/:id/check",uuidRoute,asyncRoute(controller.check));
app.delete("/api/habits/:id",uuidRoute,asyncRoute(controller.remove));
};
