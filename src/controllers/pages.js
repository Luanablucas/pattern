"use strict";
const {getUser}=require("../middleware/auth");

module.exports = function createPagesController(db) {
const pages=["app","tasks","calendar","habits","insights","focus"];
const root = (req, res) => res.redirect(getUser(req) ? "/app" : "/login");
const login = (req, res) => res.render("auth", { mode: "login" });
const register = (req, res) => res.render("auth", { mode: "register" });
const page = (req, res, next) => {
  if (!pages.includes(req.params.page)) return next();
  res.render("app", { page: req.params.page, name: req.user.name });
};
return {root,login,register,page};
};
