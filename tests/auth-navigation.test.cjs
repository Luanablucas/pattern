"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.join(__dirname,"..");

test("acesso a conta fica no perfil e nao no menu",()=>{
  const html=fs.readFileSync(path.join(root,"views/app.ejs"),"utf8");
  const navigation=html.split('<nav class="nav-list">')[1].split("</nav>")[0];
  assert.doesNotMatch(navigation,/href="\/settings"/);
  assert.match(html,/<a class="profile-link" href="\/settings"/);
  assert.match(html,/class="logout" id="logoutBtn"/);
});

test("perfil permanece acessivel no celular",()=>{
  const css=fs.readFileSync(path.join(root,"public/css/theme.css"),"utf8");
  assert.match(css,/@media\(max-width:700px\)\{\.sidebar-bottom\{margin-top:12px\}\.sidebar-bottom \.profile\{display:flex/);
});

test("falha de rede no cadastro mostra diagnostico em vez de Failed to fetch",async()=>{
  const js=fs.readFileSync(path.join(root,"public/js/auth.js"),"utf8");
  let submit;
  const error={hidden:true,textContent:""};
  const success={hidden:true,textContent:""};
  const button={disabled:false};
  const form={dataset:{mode:"register"},addEventListener:(event,handler)=>{if(event==="submit")submit=handler;}};
  const document={querySelector:selector=>({"#authForm":form,"#formError":error,"#formSuccess":success,"#submitButton":button}[selector]||null)};
  const context={document,window:{location:{search:""}},URLSearchParams,FormData:class{constructor(){}*[Symbol.iterator](){yield ["name","Teste"];yield ["email","teste@example.com"];yield ["password","uma-senha-forte"];}},fetch:async()=>{throw new TypeError("Failed to fetch");},console};
  vm.runInNewContext(js,context);
  await submit({preventDefault(){}});
  assert.match(error.textContent,/Não foi possível conectar ao servidor/);
  assert.doesNotMatch(error.textContent,/Failed to fetch/);
  assert.equal(button.disabled,false);
});
