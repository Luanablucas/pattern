"use strict";
const jwt=require("jsonwebtoken");
const {rateLimit}=require("express-rate-limit");
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
function getUser(req) {
  const token = req.cookies.pattern_token;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (_) {
    return null;
  }
}
function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user)
    return res.status(401).json({ error: "Faça login para continuar." });
  req.user = user;
  next();
}
function requirePageAuth(req, res, next) {
  req.user = getUser(req);
  if (!req.user) return res.redirect("/login");
  res.set("Cache-Control", "no-store");
  next();
}
function issueCookie(res, user) {
  const token = jwt.sign(
    { id: user.id, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "7d", algorithm: "HS256" },
  );
  res.cookie("pattern_token", token, cookieOptions);
}

module.exports={getUser,requireAuth,requirePageAuth,issueCookie,authLimiter,cookieOptions};
