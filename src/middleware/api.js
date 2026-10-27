"use strict";
const { z } = require("zod");
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const uuidRoute = (req,res,next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({error:"Identificador inválido."});
  next();
};
const validate = (schema,req,res) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({error:result.error.issues[0]?.message || "Dados inválidos."});
    return null;
  }
  return result.data;
};
const verifyApiOrigin = (req,res,next) => {
  if (["POST","PUT","PATCH","DELETE"].includes(req.method)) {
    const site=req.get("sec-fetch-site");
    if(site&&!(["same-origin","none"].includes(site)))return res.status(403).json({error:"Origem inválida."});
    const origin=req.get("origin");
    if(origin){
      try{
        const parsed=new URL(origin);
        const expected=process.env.NODE_ENV==="production"&&process.env.APP_BASE_URL
          ?new URL(process.env.APP_BASE_URL).origin
          :`${req.protocol}://${req.get("host")}`;
        if(parsed.origin!==expected)return res.status(403).json({error:"Origem inválida."});
      }catch(_){return res.status(403).json({error:"Origem inválida."});}
    }
    if(req.method!=="DELETE"&&!req.is("application/json"))return res.status(415).json({error:"Envie JSON."});
  }
  next();
};
module.exports={asyncRoute,uuidRoute,validate,verifyApiOrigin};
