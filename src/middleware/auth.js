"use strict";
const jwt=require("jsonwebtoken");
const {rateLimit}=require("express-rate-limit");
const cookieOptions={
  httpOnly:true,
  secure:process.env.NODE_ENV==="production",
  sameSite:"strict",
  path:"/",
  maxAge:7*24*60*60*1000
};
const authLimiter=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:"draft-7",legacyHeaders:false});
const recoveryLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:"draft-7",legacyHeaders:false});

async function getUser(req,db){
  const cookie=req.cookies?.pattern_token;
  if(!cookie)return null;
  let payload;
  try{payload=jwt.verify(cookie,process.env.JWT_SECRET,{algorithms:["HS256"]});}
  catch(_){return null;}
  if(!payload?.id||!payload?.sid)return null;
  const {rows}=await db.query(`SELECT u.id,u.name,u.email,u.email_verified_at,s.id AS session_id
    FROM auth_sessions s INNER JOIN users u ON u.id=s.user_id
    WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>NOW()`,[payload.sid,payload.id]);
  if(!rows[0])return null;
  await db.query("UPDATE auth_sessions SET last_seen_at=NOW() WHERE id=$1 AND last_seen_at<NOW()-INTERVAL '2 minutes'",[payload.sid]);
  return {...rows[0],sid:rows[0].session_id};
}
function requireAuth(db){
  return async function requireAuth(req,res,next){
    try{
      const user=await getUser(req,db);
      if(!user)return res.status(401).json({error:"Faça login para continuar."});
      req.user=user;
      if(process.env.EMAIL_VERIFICATION_REQUIRED==="true"&&!user.email_verified_at&&!req.originalUrl?.startsWith("/api/account")&&!req.originalUrl?.startsWith("/api/auth/resend-verification")&&!req.originalUrl?.startsWith("/api/auth/logout")&&!req.originalUrl?.startsWith("/api/theme"))return res.status(403).json({error:"Confirme seu e-mail em Minha conta para continuar."});
      next();
    }catch(error){next(error);}
  };
}
function requirePageAuth(db){
  return async function requirePageAuth(req,res,next){
    try{
      req.user=await getUser(req,db);
      if(!req.user)return res.redirect("/login");
      if(process.env.EMAIL_VERIFICATION_REQUIRED==="true"&&!req.user.email_verified_at&&req.path!=="/settings")return res.redirect("/settings");
      res.set("Cache-Control","no-store");
      next();
    }catch(error){next(error);}
  };
}
function issueCookie(res,user,sid){
  const token=jwt.sign({id:user.id,sid},process.env.JWT_SECRET,{expiresIn:"7d",algorithm:"HS256"});
  res.cookie("pattern_token",token,cookieOptions);
}
function clearCookie(res){res.clearCookie("pattern_token",{path:"/",sameSite:cookieOptions.sameSite,secure:cookieOptions.secure,httpOnly:true});}
module.exports={getUser,requireAuth,requirePageAuth,issueCookie,clearCookie,authLimiter,recoveryLimiter,cookieOptions};
