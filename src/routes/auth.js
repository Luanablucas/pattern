"use strict";
const createController=require("../controllers/auth");
const {asyncRoute}=require("../middleware/api");
const {authLimiter,recoveryLimiter,requireAuth}=require("../middleware/auth");
module.exports=function register(app,db){
  const c=createController(db);
  app.post("/api/auth/register",authLimiter,asyncRoute(c.register));
  app.post("/api/auth/login",authLimiter,asyncRoute(c.login));
  app.post("/api/auth/logout",requireAuth(db),asyncRoute(c.logout));
  app.post("/api/auth/forgot-password",recoveryLimiter,asyncRoute(c.requestReset));
  app.post("/api/auth/reset-password",recoveryLimiter,asyncRoute(c.resetPassword));
  app.post("/api/auth/verify-email",recoveryLimiter,asyncRoute(c.verifyEmail));
  app.post("/api/auth/confirm-new-email",recoveryLimiter,asyncRoute(c.verifyChangedEmail));
  app.post("/api/auth/resend-verification",requireAuth(db),recoveryLimiter,asyncRoute(c.resendVerification));
};
