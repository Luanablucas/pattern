"use strict";
const createController = require("../controllers/goals");
const { asyncRoute, uuidRoute } = require("../middleware/api");

module.exports = function register(app,db) {
  const controller = createController(db);
  app.get("/api/goals",asyncRoute(controller.list));
  app.get("/api/goals/options",asyncRoute(controller.options));
  app.post("/api/goals",asyncRoute(controller.create));
  app.put("/api/goals/:id",uuidRoute,asyncRoute(controller.update));
  app.delete("/api/goals/:id",uuidRoute,asyncRoute(controller.remove));
  app.post("/api/goals/:id/steps",uuidRoute,asyncRoute(controller.addStep));
  app.patch("/api/goals/:id/steps/:stepId",uuidRoute,asyncRoute(controller.updateStep));
  app.delete("/api/goals/:id/steps/:stepId",uuidRoute,asyncRoute(controller.removeStep));
  app.post("/api/goals/:id/links",uuidRoute,asyncRoute(controller.addLink));
  app.delete("/api/goals/:id/links/:type/:entityId",uuidRoute,asyncRoute(controller.removeLink));
};
