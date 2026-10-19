"use strict";
const createController=require("../controllers/pages");
const {asyncRoute,uuidRoute}=require("../middleware/api");
const {requirePageAuth}=require("../middleware/auth");

module.exports = function register(app,db) {
const controller=createController(db);
app.get("/",controller.root);
app.get("/login",controller.login);
app.get("/register",controller.register);
app.get("/:page",requirePageAuth,controller.page);
};
