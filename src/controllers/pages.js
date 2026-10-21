"use strict";
const {getUser}=require("../middleware/auth");

module.exports = function createPagesController(db) {
const pages=["app","tasks","calendar","habits","insights","focus","goals","review","intelligence"];
const root = (req, res) => res.redirect(getUser(req) ? "/app" : "/login");
const login = (req, res) => res.render("auth", { mode: "login" });
const register = (req, res) => res.render("auth", { mode: "register" });
const page = async (req, res, next) => {
  if (!pages.includes(req.params.page)) return next();
  const {rows}=await db.query("SELECT theme_preference FROM users WHERE id=$1",[req.user.id]);
  if(!rows[0])return res.redirect("/login");
  res.render("app", { page: req.params.page, name: req.user.name, themePreference:rows[0].theme_preference });
};
return {root,login,register,page};
};
