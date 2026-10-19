"use strict";
const createController=require("../controllers/routines");
const {asyncRoute,uuidRoute}=require("../middleware/api");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/api/routines",asyncRoute(controller.list));
app.post("/api/routines",asyncRoute(controller.create));
app.put("/api/routines/:id",uuidRoute,asyncRoute(controller.update));
app.delete("/api/routines/:id",uuidRoute,asyncRoute(controller.remove));
};
