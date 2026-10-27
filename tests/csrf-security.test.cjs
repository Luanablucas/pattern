"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {issueCsrfCookie,verifyCsrf,valid}=require("../src/middleware/csrf");
const previousSecret=process.env.JWT_SECRET;
process.env.JWT_SECRET="unit-test-csrf-secret-with-at-least-32-chars-long";

test("token CSRF é assinado e não aceita adulteração",()=>{
  let saved;
  const response={cookie:(name,value,options)=>{saved={name,value,options};}};
  issueCsrfCookie({method:"GET",path:"/login",cookies:{}},response,()=>{});
  assert.equal(saved.name,"pattern_csrf");
  assert.equal(saved.options.sameSite,"strict");
  assert.equal(saved.options.httpOnly,false);
  assert.equal(valid(saved.value),true);
  assert.equal(valid(saved.value.replace(/^./,saved.value[0]==="0"?"1":"0")),false);
  assert.equal(valid(saved.value.slice(0,-1)),false);
});

test("operações mutáveis exigem cabeçalho correspondente ao cookie legítimo",()=>{
  let csrf;
  issueCsrfCookie({method:"GET",path:"/register",cookies:{}},{cookie:(n,t)=>csrf=t},()=>{});
  const makeReq=(header,cookie=csrf)=>({method:"POST",cookies:{pattern_csrf:cookie},get:(name)=>name==="x-csrf-token"?header:undefined});
  const response=()=>({statusCode:200,status(value){this.statusCode=value;return this;},json(value){this.payload=value;return this;}});
  let accepted=false;
  let res=response();verifyCsrf(makeReq(csrf),res,()=>{accepted=true;});
  assert.equal(accepted,true);
  for(const header of [undefined,"falso",csrf.slice(0,-1)]){
    res=response();accepted=false;verifyCsrf(makeReq(header),res,()=>{accepted=true;});
    assert.equal(accepted,false);
    assert.equal(res.statusCode,403);
  }
  res=response();accepted=false;
  verifyCsrf(makeReq(csrf,"0".repeat(48)+"."+"0".repeat(64)),res,()=>{accepted=true;});
  assert.equal(accepted,false);
  assert.equal(res.statusCode,403);
});

test("cookie antifalsificação é reutilizado enquanto válido e não criado em rotas estáticas",()=>{
  let saved;
  const res={cookie:(_name,value)=>{saved=value;}};
  issueCsrfCookie({method:"GET",path:"/login",cookies:{}},res,()=>{});
  const current=saved;
  saved=null;
  issueCsrfCookie({method:"GET",path:"/app",cookies:{pattern_csrf:current}},res,()=>{});
  assert.equal(saved,null);
  issueCsrfCookie({method:"GET",path:"/static/js/app.js",cookies:{}},res,()=>{});
  assert.equal(saved,null);
});

test("front-end injeta token apenas em ações locais da API e todas as páginas o carregam",()=>{
  const fs=require("node:fs");const path=require("node:path");const dir=path.join(__dirname,"..");
  for(const file of ["views/app.ejs","views/auth.ejs"]){
    const view=fs.readFileSync(path.join(dir,file),"utf8");
    assert.match(view,/\/static\/js\/csrf\.js/);
    assert.ok(view.indexOf("csrf.js")<view.indexOf("theme.js"));
  }
  const script=fs.readFileSync(path.join(dir,"public/js/csrf.js"),"utf8");
  assert.match(script,/target\.origin!==window\.location\.origin/);
  assert.match(script,/headers\.set\("x-csrf-token"/);
});


test("troca de senha e e-mail têm limite próprio de tentativas",()=>{
  const fs=require("node:fs");const path=require("node:path");
  const root=path.join(__dirname,"..");
  const routes=fs.readFileSync(path.join(root,"src/routes/account.js"),"utf8");
  const auth=fs.readFileSync(path.join(root,"src/middleware/auth.js"),"utf8");
  assert.match(routes,/change-password",accountLimiter\(\)/);
  assert.match(routes,/change-email",accountLimiter\(\)/);
  assert.match(auth,/accountLimiter=\(\)=>rateLimit/);
  assert.match(auth,/limit:6/);
});

test("interceptador envia proteção em POST/DELETE local e não envia a serviços externos",async()=>{
  const fs=require("node:fs");const path=require("node:path");const vm=require("node:vm");
  const source=fs.readFileSync(path.join(__dirname,"..","public/js/csrf.js"),"utf8");
  const calls=[];
  const mockFetch=async(url,init)=>{calls.push({url,init});return {ok:true};};
  const window={fetch:mockFetch,location:{href:"http://localhost:3000/app",origin:"http://localhost:3000"}};
  const document={cookie:"pattern_csrf=token-assinado; other=value"};
  vm.runInNewContext(source,{window,document,URL,Request,Headers,Set});
  await window.fetch("/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
  await window.fetch("/api/tasks/abc",{method:"DELETE"});
  await window.fetch("/api/tasks",{method:"GET"});
  await window.fetch("https://exemplo.com/api/tasks",{method:"POST"});
  assert.equal(calls[0].init.headers.get("x-csrf-token"),"token-assinado");
  assert.equal(calls[0].init.headers.get("content-type"),"application/json");
  assert.equal(calls[1].init.headers.get("x-csrf-token"),"token-assinado");
  assert.equal(calls[2].init.headers?.get?.("x-csrf-token"),undefined);
  assert.equal(calls[3].init.headers?.get?.("x-csrf-token"),undefined);
});
