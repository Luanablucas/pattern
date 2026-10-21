"use strict";
const createController=require("../controllers/pages");
const {asyncRoute,uuidRoute}=require("../middleware/api");
const {requirePageAuth}=require("../middleware/auth");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/",asyncRoute(controller.root));
app.get("/login",controller.login);
app.get("/register",controller.register);
app.get("/forgot-password",controller.forgot);
app.get("/reset-password",controller.reset);
app.get("/verify-email",controller.verify);
app.get("/verify-pending",asyncRoute(controller.pending));
app.get("/:page",requirePageAuth(db),asyncRoute(controller.page));
};
