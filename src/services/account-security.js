"use strict";
const {randomBytes,createHash,randomUUID}=require("node:crypto");

const tokenLifetime={verify_email:24*60*60*1000,reset_password:30*60*1000,change_email:30*60*1000};
const sessionLifetime=7*24*60*60*1000;
const tokenHash=token=>createHash("sha256").update(token).digest("hex");
const normalizeEmail=value=>String(value||"").trim().toLowerCase();
const safeAgent=value=>String(value||"Dispositivo não identificado").slice(0,200);
const safeIp=value=>String(value||"").slice(0,64);

async function createToken(db,userId,purpose,emailValue=null){
  if(!Object.hasOwn(tokenLifetime,purpose))throw new Error("Finalidade inválida.");
  const secret=randomBytes(32).toString("hex");
  await db.query(`INSERT INTO auth_tokens(id,user_id,token_hash,purpose,email_value,expires_at)
    VALUES($1,$2,$3,$4,$5,$6)`,[randomUUID(),userId,tokenHash(secret),purpose,emailValue,new Date(Date.now()+tokenLifetime[purpose])]);
  return secret;
}

async function createSession(db,user,req){
  const id=randomUUID();
  const expiry=new Date(Date.now()+sessionLifetime);
  await db.query(`INSERT INTO auth_sessions(id,user_id,user_agent,ip_address,expires_at)
    VALUES($1,$2,$3,$4,$5)`,[id,user.id,safeAgent(req.get?.("user-agent")),safeIp(req.ip),expiry]);
  return id;
}

async function consumeToken(db,secret,purpose,handler){
  if(typeof secret!=="string"||!/^[0-9a-f]{64}$/.test(secret))return {ok:false};
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const result=await client.query(`SELECT t.id,t.user_id,t.email_value FROM auth_tokens t
      WHERE t.token_hash=$1 AND t.purpose=$2 AND t.used_at IS NULL AND t.expires_at>NOW()
      FOR UPDATE`,[tokenHash(secret),purpose]);
    const token=result.rows[0];
    if(!token){await client.query("ROLLBACK");return {ok:false};}
    const applied=await handler(client,token);
    if(applied===false){await client.query("ROLLBACK");return {ok:false};}
    await client.query("UPDATE auth_tokens SET used_at=NOW() WHERE id=$1",[token.id]);
    await client.query("COMMIT");
    return {ok:true};
  }catch(error){
    try{await client.query("ROLLBACK");}catch(_){}
    throw error;
  }finally{client.release();}
}

module.exports={tokenLifetime,sessionLifetime,tokenHash,normalizeEmail,safeAgent,createToken,createSession,consumeToken};
