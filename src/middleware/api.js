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
    if (req.method!=="DELETE" && !req.is("application/json")) return res.status(415).json({error:"Envie JSON."});
    const origin=req.get("origin");
    if (origin) {
      try {if(new URL(origin).host !==req.get("host")) return res.status(403).json({error:"Origem inválida."});}
      catch (_) {return res.status(403).json({error:"Origem inválida."});}
    }
  }
  next();
};
module.exports={asyncRoute,uuidRoute,validate,verifyApiOrigin};
