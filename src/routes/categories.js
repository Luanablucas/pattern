"use strict";
const createController=require("../controllers/categories");
const {asyncRoute,uuidRoute}=require("../middleware/api");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/api/event-categories",asyncRoute(controller.list));
app.post("/api/event-categories",asyncRoute(controller.create));
app.put("/api/event-categories/:id",uuidRoute,asyncRoute(controller.update));
app.delete("/api/event-categories/:id",uuidRoute,asyncRoute(controller.remove));
};
