"use strict";
require("dotenv").config();
const {Pool}=require("pg");
const {createApp}=require("./src/app");

if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) {
  throw new Error("Configure JWT_SECRET com pelo menos 32 caracteres no arquivo .env");
}
if(!process.env.DATABASE_URL) {
  throw new Error("Configure DATABASE_URL no arquivo .env");
}
const db=new Pool({connectionString:process.env.DATABASE_URL});
const app=createApp(db);
const PORT=Number(process.env.PORT || 3000);
app.listen(PORT,()=>console.log(`Pattern disponível em http://localhost:${PORT}`));
