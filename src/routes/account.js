"use strict";
const createController=require("../controllers/account");
const {asyncRoute,uuidRoute}=require("../middleware/api");
const {accountLimiter}=require("../middleware/auth");
module.exports=function register(app,db){
  const c=createController(db);
  app.get("/api/account",asyncRoute(c.profile));
  app.patch("/api/account/profile",asyncRoute(c.updateName));
  app.post("/api/account/change-password",accountLimiter(),asyncRoute(c.changePassword));
  app.post("/api/account/change-email",accountLimiter(),asyncRoute(c.changeEmail));
  app.get("/api/account/sessions",asyncRoute(c.sessions));
  app.delete("/api/account/sessions/:id",uuidRoute,asyncRoute(c.revokeSession));
  app.post("/api/account/sessions/revoke-others",asyncRoute(c.revokeOthers));
};
