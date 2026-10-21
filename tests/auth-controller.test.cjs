"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");

function setup(rows=[]){
  const statements=[],cookies=[];
  const db={async query(sql,params){statements.push({sql,params});if(sql.includes("SELECT id,name,password_hash,email_verified_at"))return {rows};if(sql.includes("SELECT id,email FROM users"))return {rows:rows.map(r=>({id:r.id,email:r.email}))};return {rows:[],rowCount:1};}};
  const original=Module._load;
  const dummy=new Proxy(function(){return dummy},{get(){return dummy},apply(){return dummy}});
  const modules={
    zod:{z:dummy},
    bcryptjs:{compare:async(pass,hash)=>pass==="senha-valida"&&hash==="hash",hash:async()=>"new-hash"},
    "../validation/common":{safeText:()=>dummy},
    "../middleware/api":{validate:(_schema,req)=>req.body},
    "../middleware/auth":{issueCookie:(res,user,sid)=>cookies.push({user,sid}),clearCookie:()=>{},getUser:async()=>null},
    "../services/account-security":{
      createSession:async()=>"11111111-1111-4111-8111-111111111111",
      createToken:async()=>"secret",
      consumeToken:async()=>({ok:true}),normalizeEmail:x=>x
    },
    "../services/email":{sendAccountEmail:async()=>false}
  };
  Module._load=function(request,parent,isMain){if(request in modules)return modules[request];return original.apply(this,arguments);};
  let controller;
  try{delete require.cache[require.resolve("../src/controllers/auth")];controller=require("../src/controllers/auth")(db);}
  finally{Module._load=original;}
  const response=()=>({code:200,result:null,status(n){this.code=n;return this},json(x){this.result=x;return this}});
  return {controller,statements,cookies,response};
}
test("login cria sessão persistida e só emite cookie após senha válida",async()=>{
  const {controller,cookies,response}=setup([{id:"a",name:"Teste",password_hash:"hash",email_verified_at:null}]);
  const res=response();
  await controller.login({body:{email:"a@teste.com",password:"senha-valida"},ip:"127.0.0.1"},res);
  assert.equal(res.code,200);
  assert.equal(cookies.length,1);
  assert.equal(cookies[0].sid,"11111111-1111-4111-8111-111111111111");
  assert.equal(res.result.verified,false);
});
test("login rejeita senha inválida e não emite cookie",async()=>{
  const {controller,cookies,response}=setup([{id:"a",name:"Teste",password_hash:"hash"}]);
  const res=response();
  await controller.login({body:{email:"a@teste.com",password:"errada"}},res);
  assert.equal(res.code,401);
  assert.equal(cookies.length,0);
});
test("redefinição de senha não revela se endereço está cadastrado",async()=>{
  const withUser=setup([{id:"a",email:"test@example.com"}]);
  const missing=setup([]);
  const a=withUser.response(),b=missing.response();
  await withUser.controller.requestReset({body:{email:"test@example.com"}},a);
  await missing.controller.requestReset({body:{email:"unknown@example.com"}},b);
  assert.deepEqual(a.result,b.result);
  assert.equal(a.result.ok,true);
});
test("logout revoga a sessão atual",async()=>{
  const {controller,statements,response}=setup();
  const res=response();
  await controller.logout({user:{id:"a",sid:"s"}},res);
  assert.deepEqual(statements[0].params,["s","a"]);
  assert.equal(res.result.ok,true);
});
