"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");
const {tokenHash,normalizeEmail,createToken,createSession,consumeToken}=require("../src/services/account-security");
const {emailLink}=require("../src/services/email");

function database(){
  const tokens=new Map(),sessions=[];
  const db={tokens,sessions,queries:[],
    async query(sql,p){
      this.queries.push([sql,p]);
      if(sql.includes("INSERT INTO auth_tokens")){tokens.set(p[2],{id:p[0],user_id:p[1],token_hash:p[2],purpose:p[3],email_value:p[4],expires_at:p[5],used_at:null});return {rowCount:1,rows:[]};}
      if(sql.includes("INSERT INTO auth_sessions")){sessions.push(p);return {rowCount:1,rows:[]};}
      return {rows:[],rowCount:0};
    },
    async connect(){return {
      async query(sql,p){
        if(sql.includes("SELECT t.id")){
          const t=tokens.get(p[0]);
          return {rows:t&&t.purpose===p[1]&&!t.used_at&&t.expires_at>Date.now()?[t]:[]};
        }
        if(sql.includes("UPDATE auth_tokens SET used_at")){const t=[...tokens.values()].find(x=>x.id===p[0]);if(t)t.used_at=new Date();}
        return {rows:[],rowCount:1};
      },release(){}
    };}
  };
  return db;
}
test("tokens de recuperação são aleatórios, armazenados apenas como hash e de uso único",async()=>{
  const db=database();
  const first=await createToken(db,"user","reset_password");
  const second=await createToken(db,"user","reset_password");
  assert.match(first,/^[0-9a-f]{64}$/);
  assert.notEqual(first,second);
  assert.equal(db.tokens.get(tokenHash(first)).token_hash,tokenHash(first));
  assert.ok(!JSON.stringify(db.queries).includes(first));
  let applied=0;
  assert.deepEqual(await consumeToken(db,first,"reset_password",async()=>{applied++;return true;}),{ok:true});
  assert.deepEqual(await consumeToken(db,first,"reset_password",async()=>{applied++;return true;}),{ok:false});
  assert.equal(applied,1);
});
test("tokens vencidos ou de outra finalidade são rejeitados",async()=>{
  const db=database();
  const raw=await createToken(db,"user","verify_email");
  assert.equal((await consumeToken(db,raw,"reset_password",async()=>true)).ok,false);
  db.tokens.get(tokenHash(raw)).expires_at=new Date(1);
  assert.equal((await consumeToken(db,raw,"verify_email",async()=>true)).ok,false);
});
test("tokens inválidos são rejeitados sem consultar o banco",async()=>{
  const db=database();
  for(const raw of ["",null,"foobar","b".repeat(64)])assert.equal((await consumeToken(db,raw,"reset_password",async()=>true)).ok,false);
});
test("sessões gravam identificador exclusivo com duração limitada",async()=>{
  const db=database();
  const req={get:()=>"Teste em Windows",ip:"127.0.0.1"};
  const a=await createSession(db,{id:"abc"},req);
  const b=await createSession(db,{id:"abc"},req);
  assert.notEqual(a,b);
  assert.equal(db.sessions.length,2);
  assert.equal(db.sessions[0][1],"abc");
  assert.equal(db.sessions[0][2],"Teste em Windows");
});
test("links de confirmação separam verificação inicial e troca de e-mail",()=>{
  assert.match(emailLink("verify_email","test"),/verify-email\?token=test$/);
  assert.match(emailLink("change_email","test"),/purpose=change_email$/);
  assert.match(emailLink("reset_password","test"),/reset-password\?token=test$/);
  assert.equal(normalizeEmail("  EMAIL@EXEMPLO.COM "),"email@exemplo.com");
});
test("mensagens só são enviadas quando o provedor está configurado",async()=>{
  const {sendAccountEmail,configured}=require("../src/services/email");
  const before={RESEND_API_KEY:process.env.RESEND_API_KEY,MAIL_FROM:process.env.MAIL_FROM,APP_BASE_URL:process.env.APP_BASE_URL};
  try{
    delete process.env.RESEND_API_KEY;delete process.env.MAIL_FROM;delete process.env.APP_BASE_URL;
    assert.equal(configured(),false);
    assert.equal(await sendAccountEmail("user@example.com","reset_password","test"),false);
  }finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test("autorização recusa cookies sem sessão ativa ou revogada",async()=>{
  const original=Module._load;
  const jwt={verify:()=>({id:"alice",sid:"valid-session"})};
  Module._load=function(request,parent,isMain){
    if(request==="jsonwebtoken")return jwt;
    if(request==="express-rate-limit")return {rateLimit:()=>()=>{}};
    return original.apply(this,arguments);
  };
  let auth;
  try{delete require.cache[require.resolve("../src/middleware/auth")];auth=require("../src/middleware/auth");}
  finally{Module._load=original;}
  const req={cookies:{pattern_token:"cookie"}};
  let queryCount=0;
  const absent={query:async()=>{queryCount++;return {rows:[]};}};
  assert.equal(await auth.getUser(req,absent),null);
  assert.equal(queryCount,1);
  const db={query:async(sql,p)=>sql.startsWith("SELECT")?{rows:[{id:"alice",session_id:"valid-session",name:"Teste"}]}:{rows:[]}};
  const user=await auth.getUser(req,db);
  assert.equal(user.sid,"valid-session");
  assert.equal(user.id,"alice");
});
