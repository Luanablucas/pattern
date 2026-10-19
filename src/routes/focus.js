"use strict";
const createController=require("../controllers/focus");
const {asyncRoute,uuidRoute}=require("../middleware/api");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/api/focus/active",asyncRoute(controller.active));
app.post("/api/focus/start",asyncRoute(controller.start));
app.post("/api/focus/:id/pause",uuidRoute,asyncRoute(controller.pause));
app.post("/api/focus/:id/resume",uuidRoute,asyncRoute(controller.resume));
app.post("/api/focus/:id/finish",uuidRoute,asyncRoute(controller.finish));
app.get("/api/focus/history",asyncRoute(controller.history));
app.get("/api/focus/calendar",asyncRoute(controller.calendar));
};
