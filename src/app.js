"use strict";
const express=require("express");
const path=require("node:path");
const helmet=require("helmet");
const cookieParser=require("cookie-parser");
const {verifyApiOrigin}=require("./middleware/api");
const {issueCsrfCookie,verifyCsrf}=require("./middleware/csrf");
const {requireAuth}=require("./middleware/auth");
const {assetUrl}=require("./utils/assets");

function createApp(db) {
  const app=express();
  app.set("view engine","ejs");
  app.locals ??= {};
  app.locals.assetUrl=assetUrl;
  app.set("views",path.join(__dirname,"..","views"));
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({limit:"24kb"}));
  app.use(cookieParser());
  app.use((req,res,next)=>{
    if(req.method==="GET" && !req.path.startsWith("/api/") && !req.path.startsWith("/static/")) {
      res.setHeader("Cache-Control","no-store");
    }
    next();
  });
  app.use(issueCsrfCookie);
  app.use("/static",express.static(path.join(__dirname,"..","public"),{maxAge:"2h"}));
  app.use("/api",verifyApiOrigin,verifyCsrf);
  require("./routes/pages")(app,db);
  require("./routes/auth")(app,db);
  app.use("/api",requireAuth(db));
  for(const name of ["tasks","routines","habits","categories","events","insights","analytics","focus","goals","weekly-review","intelligence","theme","account","assistant"]) {
    require(`./routes/${name}`)(app,db);
  }
  app.use("/api",(_req,res)=>res.status(404).json({error:"Rota não encontrada."}));
  app.use((_req,res)=>res.status(404).send("Página não encontrada."));
  app.use((err,req,res,_next)=>{
    console.error(err);
    if(req.path.startsWith("/api/"))return res.status(500).json({error:"Ocorreu um erro inesperado."});
    return res.status(500).send("Ocorreu um erro inesperado.");
  });
  return app;
}
module.exports={createApp};
