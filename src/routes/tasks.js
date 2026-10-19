"use strict";
const createController=require("../controllers/tasks");
const {asyncRoute,uuidRoute}=require("../middleware/api");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/api/tasks",asyncRoute(controller.list));
app.patch("/api/recurring-tasks/:id/:date/toggle",uuidRoute,asyncRoute(controller.toggleOccurrence));
app.delete("/api/recurring-tasks/:id/:date",uuidRoute,asyncRoute(controller.cancelOccurrence));
app.post("/api/tasks",asyncRoute(controller.create));
app.put("/api/tasks/:id",uuidRoute,asyncRoute(controller.update));
app.patch("/api/tasks/:id/date",uuidRoute,asyncRoute(controller.changeDate));
app.patch("/api/tasks/:id/toggle",uuidRoute,asyncRoute(controller.toggle));
app.delete("/api/tasks/:id",uuidRoute,asyncRoute(controller.remove));
};
