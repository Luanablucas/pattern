"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const Module=require("node:module");
const root=path.join(__dirname,"..");

function loadController(db){
  const original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="zod")return {z:{object:()=>({strict:()=>({safeParse(value){return {success:!!value&&Object.keys(value).length===1&&["light","dark","system"].includes(value.preference),data:value};}})}) ,enum:()=>({})}};
    return original.apply(this,arguments);
  };
  try{return require("../src/controllers/theme")(db);}finally{Module._load=original;}
}
function response(){
  const r={code:200,payload:null,headers:{}};
  r.status=function(code){this.code=code;return this};
  r.set=function(k,v){this.headers[k]=v;return this};
  r.json=function(data){this.payload=data;return this};
  return r;
}

test("tema consulta a preferência do usuário autenticado",async()=>{
  let params;
  const db={query:async(sql,p)=>{params=p;return {rows:[{preference:"dark"}]};}};
  const res=response();
  await loadController(db).read({user:{id:"alice"}},res);
  assert.deepEqual(params,["alice"]);
  assert.deepEqual(res.payload,{preference:"dark"});
  assert.equal(res.headers["Cache-Control"],"no-store");
});
test("salvar preferência só modifica a conta autenticada",async()=>{
  let params;
  const db={query:async(sql,p)=>{assert.match(sql,/WHERE id=\$2/);params=p;return {rows:[{preference:p[0]}]};}};
  const res=response();
  await loadController(db).update({user:{id:"alice"},body:{preference:"system"}},res);
  assert.deepEqual(params,["system","alice"]);
  assert.deepEqual(res.payload,{preference:"system"});
});
test("preferências inválidas são rejeitadas sem escrita no banco",async()=>{
  let called=false;
  const db={query:async()=>{called=true;return {rows:[]}}};
  for(const pref of ["midnight","","DARK",null]){
    const res=response();
    await loadController(db).update({user:{id:"alice"},body:{preference:pref}},res);
    assert.equal(res.code,400);
  }
  assert.equal(called,false);
});
test("a página recebe a escolha persistida no banco",async()=>{
  const db={query:async()=>({rows:[{theme_preference:"dark"}]})};
  const original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="../middleware/auth")return {getUser:()=>null};
    return original.apply(this,arguments);
  };
  let ctrl;
  try{ctrl=require("../src/controllers/pages")(db);}finally{Module._load=original;}
  let view,vars;
  await ctrl.page({user:{id:"alice",name:"Teste"},params:{page:"focus"}}, {render:(v,data)=>{view=v;vars=data}},()=>{});
  assert.equal(view,"app");
  assert.equal(vars.themePreference,"dark");
});
test("JavaScript de aparência carrega antes de CSS e persiste preferência local",async()=>{
  for(const template of ["app.ejs","auth.ejs"]){
    const html=fs.readFileSync(path.join(root,"views",template),"utf8");
    assert.ok(html.indexOf("/static/js/theme.js")<html.indexOf("/static/css/style.css"));
    assert.match(html,/\/static\/css\/theme\.css/);
    assert.match(html,/data-theme-select/);
  }
  const script=fs.readFileSync(path.join(root,"public/js/theme.js"),"utf8");
  let mediaCallback, domCallback;
  let value="system";
  const selectors=[{value:"",addEventListener:(_,handler)=>{selectors[0].changed=handler}}];
  const doc={documentElement:{dataset:{},style:{},classList:{add(){}}},body:{dataset:{}},querySelector:()=>null,querySelectorAll:()=>selectors,addEventListener:(_,cb)=>{domCallback=cb}};
  const window={document:doc,matchMedia:()=>({matches:true,addEventListener:(_,cb)=>{mediaCallback=cb}}),localStorage:{getItem:()=>value,setItem:(_,v)=>{value=v}},fetch:async()=>({ok:true}),setTimeout(){}};
  vm.runInNewContext(script,{window});
  assert.equal(doc.documentElement.dataset.theme,"dark");
  domCallback();
  await window.PatternTheme.setPreference("light");
  assert.equal(doc.documentElement.dataset.theme,"light");
  assert.equal(value,"light");
  await window.PatternTheme.setPreference("system");
  assert.equal(doc.documentElement.dataset.theme,"dark");
  mediaCallback();
  assert.equal(doc.documentElement.dataset.theme,"dark");
});
