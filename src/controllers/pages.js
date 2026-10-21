"use strict";
const {getUser}=require("../middleware/auth");

module.exports = function createPagesController(db) {
const pages=["app","tasks","calendar","habits","insights","focus","goals","review","intelligence","settings"];
const root = async (req, res) => {const user=await getUser(req,db);return res.redirect(!user?"/login":user.email_verified_at?"/app":"/verify-pending");};
const login = (req, res) => res.render("auth", { mode: "login" });
const register = (req, res) => res.render("auth", { mode: "register" });
const forgot = (req, res) => res.render("auth", {mode:"forgot"});
const reset = (req, res) => {res.set("Referrer-Policy","no-referrer");res.render("auth",{mode:"reset"});};
const verify = (req, res) => {res.set("Referrer-Policy","no-referrer");res.render("auth",{mode:"verify"});};
const pending = async (req,res) => {
  const user=await getUser(req,db);
  if(!user)return res.redirect("/login");
  if(user.email_verified_at)return res.redirect("/app");
  res.set("Cache-Control","no-store");
  return res.render("auth",{mode:"pending",pendingEmail:user.email,deliveryFailed:req.query.delivery==="failed"});
};
const page = async (req, res, next) => {
  if (!pages.includes(req.params.page)) return next();
  const {rows}=await db.query("SELECT theme_preference FROM users WHERE id=$1",[req.user.id]);
  if(!rows[0])return res.redirect("/login");
  res.render("app", { page: req.params.page, name: req.user.name, themePreference:rows[0].theme_preference });
};
return {root,login,register,forgot,reset,verify,pending,page};
};
