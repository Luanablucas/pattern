"use strict";
const createController=require("../controllers/events");
const {asyncRoute,uuidRoute}=require("../middleware/api");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/api/events",asyncRoute(controller.list));
app.post("/api/events",asyncRoute(controller.create));
app.put("/api/events/:id",uuidRoute,asyncRoute(controller.update));
app.delete("/api/events/:id/occurrences/:date",uuidRoute,asyncRoute(controller.cancelOccurrence));
app.delete("/api/events/:id",uuidRoute,asyncRoute(controller.remove));
};
