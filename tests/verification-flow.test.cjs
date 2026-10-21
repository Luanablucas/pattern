"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");
const fs=require("node:fs");
const path=require("node:path");

function controller({verified=false,validToken=true,previous=null,send=true}={}){
  const queries=[],cookies=[],events=[];
  const user={id:"user-123",name:"Usuária",email:"user@teste.com",email_verified_at:verified?new Date():null,password_hash:"hash"};
  const db={
    async query(sql,params=[]){
      queries.push({sql,params});
      if(sql.includes("SELECT id,name,password_hash,email_verified_at"))return {rows:[user]};
      if(sql.includes("INSERT INTO users"))return {rows:[],rowCount:1};
      return {rows:[],rowCount:1};
    }
  };
  const client={
    async query(sql,params=[]){
      events.push([sql,params]);
      if(sql.includes("UPDATE users SET email_verified_at="))return {rows:verified?[]:[{id:user.id,name:user.name,email:user.email}]};
      return {rows:[],rowCount:1};
    },release(){events.push(["RELEASE"]);}
  };
  db.connect=async()=>client;
  const dummy=new Proxy(function(){return dummy},{get(){return dummy},apply(){return dummy}});
  const deps={
    zod:{z:dummy},
    bcryptjs:{hash:async()=>"hash",compare:async(password)=>password==="senha-correta"},
    "../validation/common":{safeText:()=>dummy},
    "../middleware/api":{validate:(_schema,req)=>req.body},
    "../middleware/auth":{
      issueCookie:(res,u,sid)=>cookies.push({u,sid}),
      clearCookie:()=>{},
      getUser:async()=>previous
    },
    "../services/account-security":{
      createSession:async(target,u)=>{events.push(["SESSION",u.id,target===client?"transaction":"database"]);return "session-new";},
      createToken:async()=>"secret",normalizeEmail:x=>x,
      consumeToken:async(_db,_token,_purpose,handler)=>{
        if(!validToken)return {ok:false};
        events.push(["BEGIN"]);
        const applied=await handler(client,{id:"token-id",user_id:user.id});
        events.push([applied===false?"ROLLBACK":"COMMIT"]);
        return {ok:applied!==false};
      }
    },
    "../services/email":{sendAccountEmail:async()=>send}
  };
  const original=Module._load;
  Module._load=function(name,parent,isMain){if(name in deps)return deps[name];return original.apply(this,arguments);};
  let ctrl;
  try{delete require.cache[require.resolve("../src/controllers/auth")];ctrl=require("../src/controllers/auth")(db);}
  finally{Module._load=original;}
  const response=()=>({code:200,result:null,status(n){this.code=n;return this;},json(body){this.result=body;return this;}});
  return{ctrl,queries,cookies,events,response,user};
}

test("cadastro mantém conta pendente e direciona à confirmação",async()=>{
  const {ctrl,cookies,response}=controller();
  const res=response();
  await ctrl.register({body:{name:"Usuária",email:"user@teste.com",password:"senha-correta"}},res);
  assert.equal(res.code,201);
  assert.equal(res.result.verified,false);
  assert.equal(res.result.redirect,"/verify-pending");
  assert.equal(res.result.emailSent,true);
  assert.equal(cookies.length,1);
});

test("login sem e-mail confirmado não direciona ao aplicativo",async()=>{
  const {ctrl,cookies,response}=controller();
  const res=response();
  await ctrl.login({body:{email:"user@teste.com",password:"senha-correta"}},res);
  assert.equal(res.result.redirect,"/verify-pending");
  assert.equal(res.result.verified,false);
  assert.equal(cookies.length,1);
});

test("login confirmado abre o aplicativo e substitui a sessão anterior do navegador",async()=>{
  const {ctrl,queries,cookies,response}=controller({verified:true,previous:{id:"user-123",sid:"old-session"}});
  const res=response();
  await ctrl.login({body:{email:"user@teste.com",password:"senha-correta"}},res);
  assert.equal(res.result.redirect,"/app");
  assert.equal(res.result.verified,true);
  assert.equal(cookies.length,1);
  assert.ok(queries.some(q=>q.sql.includes("UPDATE auth_sessions SET revoked_at")&&q.params[0]==="old-session"));
});

test("confirmar e-mail cria sessão no mesmo commit antes de abrir o Pattern",async()=>{
  const {ctrl,queries,cookies,events,response}=controller({previous:{id:"user-123",sid:"pending-session"}});
  const res=response();
  await ctrl.verifyEmail({body:{token:"valid-token"},ip:"127.0.0.1"},res);
  assert.equal(res.result.redirect,"/app");
  assert.equal(cookies.length,1);
  assert.equal(cookies[0].sid,"session-new");
  assert.ok(events.some(([sql])=>sql.includes("email_verified_at IS NULL")));
  assert.ok(events.some(([sql,params])=>sql.includes("UPDATE auth_sessions SET revoked_at")&&params[0]==="pending-session"));
  assert.ok(events.some(([sql])=>sql==="SESSION"));
  assert.equal(events.at(-1)[0],"COMMIT");
  assert.equal(queries.length,0);
});

test("link inválido ou já confirmado não gera outra sessão",async()=>{
  for(const options of [{validToken:false},{verified:true}]){
    const {ctrl,cookies,response}=controller(options);
    const res=response();
    await ctrl.verifyEmail({body:{token:"expired"}},res);
    assert.equal(res.code,400);
    assert.equal(cookies.length,0);
  }
});

test("confirmação pendente possui ações de reenvio e sair, sem liberar /app",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","views","auth.ejs"),"utf8");
  const js=fs.readFileSync(path.join(__dirname,"..","public","js","auth.js"),"utf8");
  assert.match(html,/id="pendingResend"/);
  assert.match(html,/id="pendingLogout"/);
  assert.match(js,/result\.redirect\|\|"\/verify-pending"/);
  assert.match(js,/window\.location\.replace\(result\.redirect\|\|"\/app"\)/);
});

test("sessões diferentes deixam de ser apresentadas como dispositivos diferentes",()=>{
  const js=fs.readFileSync(path.join(__dirname,"..","public","js","account.js"),"utf8");
  assert.match(js,/Outra sessão/);
  assert.doesNotMatch(js,/Outro dispositivo/);
});

test("autorização exige verificação mesmo sem a flag de ambiente",async()=>{
  const old=process.env.EMAIL_VERIFICATION_REQUIRED;
  process.env.EMAIL_VERIFICATION_REQUIRED="false";
  const original=Module._load;
  const deps={
    jsonwebtoken:{verify:()=>({id:"user-123",sid:"session-123"})},
    "express-rate-limit":{rateLimit:()=>()=>{}}
  };
  Module._load=function(name,parent,isMain){if(name in deps)return deps[name];return original.apply(this,arguments);};
  let auth;
  try{delete require.cache[require.resolve("../src/middleware/auth")];auth=require("../src/middleware/auth");}
  finally{Module._load=original;}
  try{
    const db={query:async(sql)=>({rows:sql.startsWith("SELECT")?[{id:"user-123",sid:"session-123",session_id:"session-123",email_verified_at:null}]:[]})};
    const response=()=>({code:200,status(n){this.code=n;return this;},json(x){this.data=x;return this;},redirect(x){this.target=x;return this;}});
    const blocked=response();
    let called=false;
    await auth.requireAuth(db)({cookies:{pattern_token:"abc"},originalUrl:"/api/tasks"},blocked,()=>{called=true;});
    assert.equal(blocked.code,403);
    assert.equal(called,false);
    const allowed=response();
    await auth.requireAuth(db)({cookies:{pattern_token:"abc"},originalUrl:"/api/auth/resend-verification"},allowed,()=>{called=true;});
    assert.equal(called,true);
    const page=response();
    await auth.requirePageAuth(db)({cookies:{pattern_token:"abc"},path:"/app"},page,()=>{});
    assert.equal(page.target,"/verify-pending");
  }finally{if(old===undefined)delete process.env.EMAIL_VERIFICATION_REQUIRED;else process.env.EMAIL_VERIFICATION_REQUIRED=old;}
});

test("falha ao reenviar confirmação retorna 503 e não uma mensagem de sucesso",async()=>{
  const {ctrl,response,user}=controller({send:false});
  const res=response();
  await ctrl.resendVerification({user},res);
  assert.equal(res.code,503);
  assert.match(res.result.error,/Não foi possível enviar/);
  assert.equal(res.result.ok,undefined);
});
