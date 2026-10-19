"use strict";
const createController=require("../controllers/auth");
const {asyncRoute,uuidRoute}=require("../middleware/api");
const {authLimiter,requireAuth}=require("../middleware/auth");

module.exports = function register(app,db) {
const controller=createController(db);
app.post("/api/auth/register",authLimiter,asyncRoute(controller.register));
app.post("/api/auth/login",authLimiter,asyncRoute(controller.login));
app.post("/api/auth/logout",requireAuth,controller.logout);
};
