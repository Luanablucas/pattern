"use strict";

const createController = require("../controllers/analytics");
const { asyncRoute } = require("../middleware/api");

module.exports = function register(app, db) {
  const controller = createController(db);
  app.get("/api/analytics", asyncRoute(controller.list));
};
