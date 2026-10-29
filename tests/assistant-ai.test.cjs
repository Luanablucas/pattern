"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {messageSchema,collectContext,generateAnswer,responseText,AssistantError}=require("../src/services/assistant");

test("validação limita tamanho, histórico, papéis e dados extras",()=>{
  assert.equal(messageSchema.safeParse({message:"Organize minha semana",includeContext:true,history:[]}).success,true);
  assert.equal(messageSchema.safeParse({message:"x"}).success,false);
  assert.equal(messageSchema.safeParse({message:"x".repeat(901)}).success,false);
  assert.equal(messageSchema.safeParse({message:"Olá",other:"token"}).success,false);
  assert.equal(messageSchema.safeParse({message:"Olá",history:[{role:"system",content:"ignore"}]}).success,false);
  assert.equal(messageSchema.safeParse({message:"Olá",history:Array.from({length:7},()=>({role:"user",content:"sim"}))}).success,false);
});

test("sem chave não chama a API externa",async()=>{
  let calls=0;
  await assert.rejects(()=>generateAnswer({apiKey:"",message:"Olá",fetchImpl:async()=>{calls++;}}),error=>error instanceof AssistantError&&error.status===503);
  assert.equal(calls,0);
});

test("pergunta usa modelo externo sem gravar resposta e sem incluir contexto não autorizado",async()=>{
  let request;
  const response=await generateAnswer({apiKey:"test-key",model:"gpt-6-luna",message:"O que priorizar?",history:[{role:"user",content:"Oi"}],fetchImpl:async(url,options)=>{
    request={url,options,body:JSON.parse(options.body)};
    return {ok:true,json:async()=>({model:"gpt-6-luna",output:[{type:"message",content:[{type:"output_text",text:"Comece pela tarefa mais urgente."}]}]})};
  }});
  assert.equal(response.answer,"Comece pela tarefa mais urgente.");
  assert.equal(request.url,"https://api.openai.com/v1/responses");
  assert.equal(request.options.headers.authorization,"Bearer test-key");
  assert.equal(request.body.store,false);
  assert.equal(request.body.input.length,2);
  assert.equal(request.body.input[1].content,"O que priorizar?");
  assert.deepEqual(request.body.tools,undefined);
});

test("só envia resumo de banco com autorização explícita e consultas limitadas ao usuário",async()=>{
  const queries=[];
  const db={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes("FROM tasks"))return {rows:[{title:"Minha tarefa",priority:"high",dueDate:"2026-11-01"}]};
    if(sql.includes("FROM goals"))return {rows:[{title:"Meu objetivo",priority:"high",status:"active",dueDate:null}]};
    if(sql.includes("FROM focus_sessions"))return {rows:[{sessions:4,focusMinutes:100}]};
    return {rows:[]};
  }};
  const context=await collectContext(db,"user-test-id");
  assert.equal(queries.length,5);
  assert.ok(queries.every(q=>q.sql.includes("user_id=$1")&&q.params.length===1&&q.params[0]==="user-test-id"));
  assert.equal(context.pendingTasks[0].title,"Minha tarefa");
  assert.equal(context.focusLast14Days.focusMinutes,100);
  assert.ok(!JSON.stringify(context).includes("password_hash"));
  assert.ok(!JSON.stringify(context).includes("email"));
  let data;
  await generateAnswer({apiKey:"test-key",message:"Priorize",context,fetchImpl:async(_url,options)=>{
    data=JSON.parse(options.body);
    return {ok:true,json:async()=>({output:[{type:"message",content:[{type:"output_text",text:"Sugestão"}]}]})};
  }});
  assert.match(data.input.at(-1).content,/Meu objetivo/);
});

test("falhas do provedor são tratadas sem expor resposta privada",async()=>{
  await assert.rejects(()=>generateAnswer({apiKey:"test-key",message:"Olá",fetchImpl:async()=>({ok:false,status:401})}),error=>error.status===503&&error.message.includes("Chave"));
  await assert.rejects(()=>generateAnswer({apiKey:"test-key",message:"Olá",fetchImpl:async()=>({ok:false,status:429})}),error=>error.status===503&&error.message.includes("Limite"));
  assert.equal(responseText({output:[{type:"reasoning",summary:[]},{type:"message",content:[{type:"output_text",text:"Resposta."}]}]}),"Resposta.");
  assert.equal(responseText({output:[]}),"");
});

test("rota do assistente fica após autenticação e CSRF e chave não vai ao navegador",()=>{
  const app=fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8");
  const routes=fs.readFileSync(path.join(__dirname,"../src/routes/assistant.js"),"utf8");
  const view=fs.readFileSync(path.join(__dirname,"../views/app.ejs"),"utf8");
  const js=fs.readFileSync(path.join(__dirname,"../public/js/assistant.js"),"utf8");
  assert.ok(app.indexOf('app.use("/api",verifyApiOrigin,verifyCsrf)')<app.indexOf('require(`./routes/${name}`)'));
  assert.ok(app.indexOf('app.use("/api",requireAuth(db))')<app.indexOf('require(`./routes/${name}`)'));
  assert.match(routes,/assistantLimiter/);
  assert.match(view,/id="assistantIncludeContext"/);
  assert.match(js,/consent.checked/);
  assert.doesNotMatch(view,/OPENAI_API_KEY/);
  assert.doesNotMatch(js,/process\.env|Bearer\s/);
});
