"use strict";
const {createHmac,randomBytes,timingSafeEqual}=require("node:crypto");
const name="pattern_csrf";
const safeMethods=new Set(["GET","HEAD","OPTIONS"]);
const cookieOptions={httpOnly:false,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:7*24*60*60*1000};

function sign(nonce){
  const secret=process.env.JWT_SECRET;
  if(!secret||secret.length<32)throw new Error("JWT_SECRET deve conter pelo menos 32 caracteres.");
  return createHmac("sha256",secret).update(`pattern-csrf-v1:${nonce}`).digest("hex");
}
function valid(value){
  if(typeof value!=="string"||!(/^[0-9a-f]{48}\.[0-9a-f]{64}$/).test(value))return false;
  const [nonce,signature]=value.split(".");
  const expected=Buffer.from(sign(nonce),"hex");
  return timingSafeEqual(expected,Buffer.from(signature,"hex"));
}
function issueCsrfCookie(req,res,next){
  if(req.method==="GET"&&!req.path.startsWith("/api/")&&!req.path.startsWith("/static/")){
    if(!valid(req.cookies?.[name])){
      const nonce=randomBytes(24).toString("hex");
      res.cookie(name,`${nonce}.${sign(nonce)}`,cookieOptions);
    }
  }
  next();
}
function verifyCsrf(req,res,next){
  if(safeMethods.has(req.method))return next();
  const fromCookie=req.cookies?.[name];
  const fromHeader=req.get("x-csrf-token");
  if(!valid(fromCookie)||typeof fromHeader!=="string"||fromHeader.length!==fromCookie.length||
    !timingSafeEqual(Buffer.from(fromCookie),Buffer.from(fromHeader))){
    return res.status(403).json({error:"Requisição não autorizada. Atualize a página e tente novamente."});
  }
  next();
}
module.exports={name,valid,issueCsrfCookie,verifyCsrf};
