"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const http=require("node:http");
const {randomBytes}=require("node:crypto");

const rawUrl=process.env.TEST_DATABASE_URL||"postgres://pattern_test:pattern_test_local@127.0.0.1:5434/pattern_test";
const parsed=new URL(rawUrl);
if(parsed.protocol!=="postgres:"||parsed.hostname!=="127.0.0.1"||parsed.port!=="5434"||parsed.pathname!=="/pattern_test"||parsed.username!=="pattern_test"){
  throw new Error("TEST_DATABASE_URL deve apontar apenas para pattern_test, usuário pattern_test, em 127.0.0.1:5434. O banco principal nunca pode ser usado nos testes.");
}

process.env.NODE_ENV="test";
process.env.DATABASE_URL=rawUrl;
process.env.JWT_SECRET=randomBytes(40).toString("hex");
process.env.RESEND_API_KEY="test-mail-provider";
process.env.MAIL_FROM="Pattern Tests <onboarding@resend.dev>";
process.env.OPENAI_API_KEY="integration-test-key";
process.env.APP_BASE_URL="http://localhost:3000";
const {Pool}=require("pg");
const {createApp}=require("../src/app");

const listen=(server)=>new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.removeListener("error",reject);resolve(server.address().port);});});
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

test("fluxos HTTP reais com PostgreSQL isolado e e-mail simulado",{timeout:90000},async t=>{
  const db=new Pool({connectionString:rawUrl,connectionTimeoutMillis:4000,max:4});
  let server;
  let pythonServer;
  const nativeFetch=globalThis.fetch;
  const emails=[];
  let rejectMail=false;
  let assistantResponse=null;
  let pythonAvailable=true;
  let base="";
  let csrfCookie="";
  let csrfToken="";
  let schemaReady=false;
  const marker=randomBytes(8).toString("hex");
  const userA=`integration-${marker}-a@pattern.local`;
  const userB=`integration-${marker}-b@pattern.local`;
  const userANew=`integration-${marker}-novo@pattern.local`;
  const originalEnvPython=process.env.PYTHON_API_URL;
  const originalEnvBase=process.env.APP_BASE_URL;
  const credential={a:"senha-de-teste-12345",b:"senha-de-teste-12345",newA:"senha-alterada-12345",resetA:"senha-redefinida-12345"};
  const cookies={};
  const send=async(route,{method="GET",body,cookie,origin,headers={},skipCsrf=false}={})=>{
    const allCookies=[cookie,csrfCookie].filter(Boolean).join("; ");
    const csrfHeader=!skipCsrf&&!["GET","HEAD","OPTIONS"].includes(method.toUpperCase())?{"x-csrf-token":csrfToken}:{};
    const response=await nativeFetch(`${base}${route}`,{
      method,
      headers:{...(body!==undefined?{"content-type":"application/json"}:{}),...(allCookies?{cookie:allCookies}:{}),...csrfHeader,...(origin?{origin}:{}),...headers},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),
      redirect:"manual"
    });
    const type=response.headers.get("content-type")||"";
    const data=type.includes("application/json")?await response.json():await response.text();
    return {status:response.status,data,cookie:response.headers.get("set-cookie")?.split(";")[0]||null,location:response.headers.get("location")};
  };
  const expectMail=address=>{
    const mail=emails.filter(m=>m.to.includes(address)).at(-1);
    assert.ok(mail,`E-mail simulado não encontrado para ${address}`);
    const link=mail.text.match(/https?:\/\/[^\s]+/)?.[0];
    assert.ok(link,"Mensagem não contém link");
    const token=new URL(link).searchParams.get("token");
    assert.match(token,/^[0-9a-f]{64}$/);
    return token;
  };
  try{
    try{await db.query("SELECT 1");}
    catch(error){throw new Error(`O banco de testes não respondeu em 127.0.0.1:5434. Execute: docker compose -f docker-compose.integration.yml up -d postgres_test. Detalhe: ${error.code||error.message}`);}
    const dbname=(await db.query("SELECT current_database() AS name")).rows[0].name;
    assert.equal(dbname,"pattern_test");
    const schema=fs.readFileSync(path.join(__dirname,"..","sql","schema.sql"),"utf8");
    await db.query(schema);
    schemaReady=true;
    const activeDb=(await db.query("SELECT current_database() AS name")).rows[0].name;
    assert.equal(activeDb,"pattern_test");

    globalThis.fetch=async(url,options)=>{
      if(String(url)==="https://api.openai.com/v1/responses"){
        const request=JSON.parse(options.body);
        assert.ok(Array.isArray(request.tools));
        assert.equal(request.parallel_tool_calls,false);
        assert.equal(request.store,false);
        const msg=String(request.input.at(-1).content);
        if(msg.includes("agendar compromisso")){
          const start=new Date(Date.now()+4*86400000);
          const end=new Date(start.getTime()+3600000);
          assistantResponse={type:"function_call",name:"create_event",call_id:"call_event_1",arguments:JSON.stringify({title:"Compromisso assistido",starts_at:start.toISOString(),ends_at:end.toISOString(),category:"study",notes:null})};
        }else if(msg.includes("criar tarefa")){
          assistantResponse={type:"function_call",name:"create_task",call_id:"call_task_1",arguments:JSON.stringify({title:"Tarefa proposta pela IA",priority:"high",due_date:null,notes:null})};
        }else assistantResponse=null;
        return new Response(JSON.stringify({model:"gpt-6-luna",output:assistantResponse?[assistantResponse]:[{type:"message",content:[{type:"output_text",text:"Você pode organizar suas tarefas."}]}]}),{status:200,headers:{"content-type":"application/json"}});
      }
      if(String(url)==="https://api.resend.com/emails"){
        if(rejectMail)return new Response(JSON.stringify({message:"Recipient not allowed"}),{status:403,headers:{"content-type":"application/json"}});
        const message=JSON.parse(options.body);
        emails.push(message);
        return new Response(JSON.stringify({id:`integration-${emails.length}`}),{status:200,headers:{"content-type":"application/json"}});
      }
      return nativeFetch(url,options);
    };
    pythonServer=http.createServer((req,res)=>{
      if(req.url!=="/analyze-dashboard"){res.writeHead(404).end();return;}
      let text="";
      req.on("data",chunk=>{text+=chunk;});
      req.on("end",()=>{
        if(!pythonAvailable){res.writeHead(503).end();return;}
        const payload=JSON.parse(text);
        res.writeHead(200,{"content-type":"application/json"});
        res.end(JSON.stringify({source:"integration-python",periodDays:payload.periodDays}));
      });
    });
    const pythonPort=await listen(pythonServer);
    process.env.PYTHON_API_URL=`http://127.0.0.1:${pythonPort}`;
    server=http.createServer(createApp(db));
    const port=await listen(server);
    base=`http://127.0.0.1:${port}`;
    process.env.APP_BASE_URL=base;
    const csrfPage=await nativeFetch(`${base}/login`);
    assert.equal(csrfPage.status,200);
    csrfCookie=csrfPage.headers.get("set-cookie")?.split(";")[0]||"";
    assert.match(csrfCookie,/^pattern_csrf=/);
    csrfToken=decodeURIComponent(csrfCookie.split("=")[1]);

    await t.test("cadastro grava conta pendente, envia link e bloqueia páginas privadas",async()=>{
      const a=await send("/api/auth/register",{method:"POST",body:{name:"Usuária A",email:userA,password:credential.a}});
      assert.equal(a.status,201);
      assert.equal(a.data.redirect,"/verify-pending");
      assert.equal(a.data.emailSent,true);
      assert.ok(a.cookie?.startsWith("pattern_token="));
      cookies.pendingA=a.cookie;
      const unauth=await send("/api/tasks");
      assert.equal(unauth.status,401);
      assert.equal((await send("/api/tasks",{cookie:a.cookie})).status,403);
      const page=await send("/app",{cookie:a.cookie});
      assert.equal(page.status,302);
      assert.equal(page.location,"/verify-pending");
      const current=(await db.query("SELECT id,email_verified_at FROM users WHERE email=$1",[userA])).rows[0];
      assert.ok(current.id);
      assert.equal(current.email_verified_at,null);

    });

    await t.test("erro do provedor de e-mail retorna falha visível, não mensagem de sucesso",async()=>{
      rejectMail=true;
      const result=await send("/api/auth/resend-verification",{method:"POST",body:{},cookie:cookies.pendingA});
      rejectMail=false;
      assert.equal(result.status,503);
      assert.match(result.data.error,/Não foi possível enviar/);
    });

    await t.test("confirmação do e-mail abre sessão e não aceita reutilização do link",async()=>{
      const token=expectMail(userA);
      const result=await send("/api/auth/verify-email",{method:"POST",body:{token},cookie:cookies.pendingA});
      assert.equal(result.status,200);
      assert.equal(result.data.redirect,"/app");
      cookies.a=result.cookie;
      assert.ok(cookies.a);
      assert.equal((await send("/app",{cookie:cookies.a})).status,200);
      const replay=await send("/api/auth/verify-email",{method:"POST",body:{token}});
      assert.equal(replay.status,400);
      const profile=await send("/api/account",{cookie:cookies.a});
      assert.equal(profile.data.email,userA);
      assert.ok(profile.data.emailVerifiedAt);
      const sessions=await send("/api/account/sessions",{cookie:cookies.a});
      assert.equal(sessions.status,200);
      assert.equal(sessions.data.filter(s=>s.current).length,1);
      assert.equal((await send("/api/tasks",{cookie:cookies.pendingA})).status,401);
    });

    await t.test("segunda conta tem sessões, tarefas e hábitos isolados",async()=>{
      const register=await send("/api/auth/register",{method:"POST",body:{name:"Usuário B",email:userB,password:credential.b}});
      assert.equal(register.status,201);
  
      const confirm=await send("/api/auth/verify-email",{method:"POST",body:{token:expectMail(userB)},cookie:register.cookie});
      assert.equal(confirm.status,200);
      cookies.b=confirm.cookie;
      assert.notEqual(cookies.a,cookies.b);
      const task=await send("/api/tasks",{method:"POST",body:{title:"Tarefa secreta A"},cookie:cookies.a});
      assert.equal(task.status,201);
      assert.ok(task.data.id);
      const taskId=task.data.id;
      const bTasks=await send("/api/tasks",{cookie:cookies.b});
      assert.equal(bTasks.status,200);
      assert.ok(!bTasks.data.some(row=>row.id===taskId));
      assert.equal((await send(`/api/tasks/${taskId}/toggle`,{method:"PATCH",body:{},cookie:cookies.b})).status,404);
      assert.equal((await send(`/api/tasks/${taskId}`,{method:"DELETE",cookie:cookies.b})).status,404);
      assert.equal((await send(`/api/tasks/${taskId}/toggle`,{method:"PATCH",body:{},cookie:cookies.a})).data.completed,true);
      const habit=await send("/api/habits",{method:"POST",body:{name:"Ler livros",scheduleDays:[1,2,3],goalPerWeek:3},cookie:cookies.a});
      assert.equal(habit.status,201);
      assert.equal((await send("/api/habits",{cookie:cookies.b})).data.habits.length,0);
      assert.equal((await send(`/api/habits/${habit.data.id}`,{method:"DELETE",cookie:cookies.b})).status,404);
      const goal=await send("/api/goals",{method:"POST",cookie:cookies.a,body:{title:"Objetivo privado A"}});
      assert.equal(goal.status,201);
      const goalUpdate=await send(`/api/goals/${goal.data.id}`,{method:"PUT",cookie:cookies.a,body:{title:"Objetivo privado A",description:"",category:"Pessoal",priority:"medium",dueDate:null,status:"completed"}});
      assert.equal(goalUpdate.status,200);
      const completedGoal=(await db.query("SELECT status,completed_at FROM goals WHERE id=$1",[goal.data.id])).rows[0];
      assert.equal(completedGoal.status,"completed");
      assert.ok(completedGoal.completed_at);
      const goalReopen=await send(`/api/goals/${goal.data.id}`,{method:"PUT",cookie:cookies.a,body:{title:"Objetivo privado A",description:"",category:"Pessoal",priority:"medium",dueDate:null,status:"active"}});
      assert.equal(goalReopen.status,200);
      const reopenedGoal=(await db.query("SELECT status,completed_at FROM goals WHERE id=$1",[goal.data.id])).rows[0];
      assert.equal(reopenedGoal.status,"active");
      assert.equal(reopenedGoal.completed_at,null);
      assert.equal((await send("/api/goals",{cookie:cookies.b})).data.length,0);
      assert.equal((await send(`/api/goals/${goal.data.id}`,{method:"DELETE",cookie:cookies.b})).status,404);
      const categories=await send("/api/event-categories",{cookie:cookies.a});
      assert.equal(categories.status,200);
      assert.ok(categories.data.length>0);
      const starts=new Date(Date.now()+36*60*60*1000);
      const ends=new Date(starts.getTime()+60*60*1000);
      const event=await send("/api/events",{method:"POST",cookie:cookies.a,body:{title:"Agenda privada A",startsAt:starts.toISOString(),endsAt:ends.toISOString(),categoryId:categories.data[0].id}});
      assert.equal(event.status,201);
      assert.ok(event.data.id);
      assert.ok(!(await send("/api/events",{cookie:cookies.b})).data.some(row=>row.id===event.data.id));
      assert.equal((await send(`/api/events/${event.data.id}`,{method:"DELETE",cookie:cookies.b})).status,404);
      const theme=await send("/api/theme",{method:"PUT",cookie:cookies.a,body:{preference:"dark"}});
      assert.equal(theme.status,200);
      assert.equal((await send("/api/theme",{cookie:cookies.a})).data.preference,"dark");
      assert.equal((await send("/api/theme",{cookie:cookies.b})).data.preference,"system");
      const focus=await send("/api/focus/start",{method:"POST",cookie:cookies.a,body:{mode:"free",durationMinutes:null,taskId:taskId}});
      assert.equal(focus.status,201);
      assert.equal((await send("/api/focus/active",{cookie:cookies.b})).data.session,null);
      assert.equal((await send(`/api/focus/${focus.data.session.id}/finish`,{method:"POST",cookie:cookies.b,body:{}})).status,404);
      assert.equal((await send(`/api/focus/${focus.data.session.id}/finish`,{method:"POST",cookie:cookies.a,body:{}})).status,200);
      assert.equal((await send("/api/analytics?days=7",{cookie:cookies.a})).data.pythonOnline,true);
      pythonAvailable=false;
      const offline=await send("/api/analytics?days=7",{cookie:cookies.a});
      assert.equal(offline.status,200);
      assert.equal(offline.data.pythonOnline,false);
      pythonAvailable=true;
    });

    await t.test("Function Calling exige aprovação, respeita contas e impede execução duplicada",async()=>{
      const requestAction=async(cookie,message)=>send("/api/assistant/chat",{method:"POST",cookie,body:{message,history:[],includeContext:false}});
      const proposal1=await requestAction(cookies.a,"Por favor, criar tarefa de estudo");
      assert.equal(proposal1.status,200);
      assert.equal(proposal1.data.proposal.type,"create_task");
      const id1=proposal1.data.proposal.id;
      assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM tasks WHERE title=$1",["Tarefa proposta pela IA"])).rows[0].count,0);
      assert.equal((await send(`/api/assistant/proposals/${id1}`,{method:"POST",cookie:cookies.b,body:{decision:"confirm"}})).status,404);
      assert.equal((await send(`/api/assistant/proposals/${id1}`,{method:"POST",cookie:cookies.a,body:{decision:"confirm"},skipCsrf:true})).status,403);
      assert.equal((await send(`/api/assistant/proposals/${id1}`,{method:"POST",cookie:cookies.a,body:{decision:"reject"}})).status,200);
      assert.equal((await send(`/api/assistant/proposals/${id1}`,{method:"POST",cookie:cookies.a,body:{decision:"confirm"}})).status,409);
      const proposal2=await requestAction(cookies.a,"Por favor, criar tarefa nova");
      assert.equal(proposal2.status,200);
      const id2=proposal2.data.proposal.id;
      const accepted=await send(`/api/assistant/proposals/${id2}`,{method:"POST",cookie:cookies.a,body:{decision:"confirm"}});
      assert.equal(accepted.status,200);
      assert.equal(accepted.data.status,"executed");
      assert.equal(accepted.data.created.href,"/tasks");
      assert.equal((await send(`/api/assistant/proposals/${id2}`,{method:"POST",cookie:cookies.a,body:{decision:"confirm"}})).status,409);
      const created=(await db.query("SELECT user_id FROM tasks WHERE id=$1",[accepted.data.created.id])).rows[0];
      const owner=(await db.query("SELECT id FROM users WHERE email=$1",[userA])).rows[0];
      assert.equal(created.user_id,owner.id);
      assert.ok(!(await send("/api/tasks",{cookie:cookies.b})).data.some(task=>task.id===accepted.data.created.id));
      const proposedEvent=await requestAction(cookies.a,"Quero agendar compromisso de estudos");
      assert.equal(proposedEvent.status,200);
      assert.equal(proposedEvent.data.proposal.type,"create_event");
      const eventId=proposedEvent.data.proposal.id;
      const confirmation=await send(`/api/assistant/proposals/${eventId}`,{method:"POST",cookie:cookies.a,body:{decision:"confirm"}});
      assert.equal(confirmation.status,200);
      assert.equal(confirmation.data.created.href,"/calendar");
      const existing=(await db.query("SELECT user_id FROM events WHERE id=$1",[confirmation.data.created.id])).rows[0];
      assert.equal(existing.user_id,owner.id);
      const conflict=await requestAction(cookies.a,"Quero agendar compromisso também");
      assert.equal(conflict.status,200);
      assert.equal((await send(`/api/assistant/proposals/${conflict.data.proposal.id}`,{method:"POST",cookie:cookies.a,body:{decision:"confirm"}})).status,409);
    });

    await t.test("origens externas e entradas inválidas são bloqueadas",async()=>{
      assert.equal((await send("/api/tasks",{method:"POST",cookie:cookies.a,body:{title:"Sem CSRF"},skipCsrf:true})).status,403);
      assert.equal((await send("/api/tasks",{method:"POST",cookie:cookies.a,body:{title:"CSRF inválido"},headers:{"x-csrf-token":"falso"}})).status,403);
      assert.equal((await send("/api/tasks",{method:"POST",cookie:cookies.a,body:{title:"Fetch de outro site"},headers:{"sec-fetch-site":"cross-site"}})).status,403);
      assert.equal((await send("/api/tasks",{method:"POST",cookie:cookies.a,body:{title:"Porta diferente"},origin:`http://127.0.0.1:${Number(new URL(base).port)+1}`})).status,403);
      assert.equal((await send("/api/tasks",{method:"POST",cookie:cookies.a,body:{title:"Origem correta"},origin:base})).status,201);

      assert.equal((await send("/api/tasks",{method:"POST",cookie:cookies.a,body:{title:"Bloqueado"},origin:"https://outro-site.example"})).status,403);
      assert.equal((await send("/api/tasks",{method:"POST",cookie:cookies.a,body:{title:""}})).status,400);
      assert.equal((await send("/api/account/sessions/nao-uuid",{method:"DELETE",cookie:cookies.a})).status,400);
    });

    await t.test("sessões são revogadas após troca de senha, com logout verificável",async()=>{
      const secondLogin=await send("/api/auth/login",{method:"POST",body:{email:userA,password:credential.a}});
      assert.equal(secondLogin.status,200);
      cookies.a2=secondLogin.cookie;
      const sessions=await send("/api/account/sessions",{cookie:cookies.a});
      assert.equal(sessions.status,200);
      assert.ok(sessions.data.length>=2);
      assert.equal(sessions.data.filter(s=>s.current).length,1);
      const change=await send("/api/account/change-password",{method:"POST",cookie:cookies.a,body:{currentPassword:credential.a,newPassword:credential.newA}});
      assert.equal(change.status,200);
      assert.equal((await send("/api/account",{cookie:cookies.a2})).status,401);
      assert.equal((await send("/api/account",{cookie:cookies.a})).status,200);
      const logout=await send("/api/auth/logout",{method:"POST",cookie:cookies.a,body:{}});
      assert.equal(logout.status,200);
      assert.equal((await send("/api/account",{cookie:cookies.a})).status,401);
      const relogin=await send("/api/auth/login",{method:"POST",body:{email:userA,password:credential.newA}});
      assert.equal(relogin.status,200);
      cookies.a=relogin.cookie;
    });

    await t.test("recuperação invalida sessões e token de uso único",async()=>{
      const requested=await send("/api/auth/forgot-password",{method:"POST",body:{email:userA}});
      assert.equal(requested.status,200);
      const token=expectMail(userA);
      const reset=await send("/api/auth/reset-password",{method:"POST",body:{token,password:credential.resetA}});
      assert.equal(reset.status,200);
      assert.equal((await send("/api/account",{cookie:cookies.a})).status,401);
      const replay=await send("/api/auth/reset-password",{method:"POST",body:{token,password:"outra-senha-12345"}});
      assert.equal(replay.status,400);
      const login=await send("/api/auth/login",{method:"POST",body:{email:userA,password:credential.resetA}});
      assert.equal(login.status,200);
      cookies.a=login.cookie;
    });

    await t.test("alteração de e-mail requer confirmação no novo endereço",async()=>{
      const change=await send("/api/account/change-email",{method:"POST",cookie:cookies.a,body:{email:userANew,currentPassword:credential.resetA}});
      assert.equal(change.status,200);
      assert.equal(change.data.emailSent,true);
      const token=expectMail(userANew);
      const done=await send("/api/auth/confirm-new-email",{method:"POST",body:{token}});
      assert.equal(done.status,200);
      assert.equal((await send("/api/account",{cookie:cookies.a})).status,401);
      assert.equal((await send("/api/auth/login",{method:"POST",body:{email:userA,password:credential.resetA}})).status,401);
      assert.equal((await send("/api/auth/login",{method:"POST",body:{email:userANew,password:credential.resetA}})).status,200);
    });
    await t.test("exportação isolada, senha obrigatória e exclusão irreversível de uma conta",async()=>{
      const renewed=await send("/api/auth/login",{method:"POST",body:{email:userANew,password:credential.resetA}});
      assert.equal(renewed.status,200);
      cookies.a=renewed.cookie;
      const unauthorized=await send("/api/account/privacy/export",{method:"POST",body:{currentPassword:credential.resetA}});
      assert.equal(unauthorized.status,401);
      const invalidExport=await send("/api/account/privacy/export",{method:"POST",cookie:cookies.a,body:{currentPassword:"senha-incorreta"}});
      assert.equal(invalidExport.status,403);
      const archive=await send("/api/account/privacy/export",{method:"POST",cookie:cookies.a,body:{currentPassword:credential.resetA}});
      assert.equal(archive.status,200);
      assert.equal(archive.data.formato,"pattern-export");
      assert.equal(archive.data.conta.email,userANew);
      assert.ok(archive.data.dados.tarefas.some(task=>task.title==="Tarefa secreta A"));
      assert.ok(!JSON.stringify(archive.data).includes("password_hash"));
      assert.ok(!JSON.stringify(archive.data).includes("token_hash"));
      assert.ok(!JSON.stringify(archive.data).includes(userB));
      const wrongConfirmation=await send("/api/account/privacy/delete",{method:"POST",cookie:cookies.b,body:{currentPassword:credential.b,confirmation:"apagar"}});
      assert.equal(wrongConfirmation.status,400);
      const wrongPassword=await send("/api/account/privacy/delete",{method:"POST",cookie:cookies.b,body:{currentPassword:"errada",confirmation:"EXCLUIR"}});
      assert.equal(wrongPassword.status,403);
      const removed=await send("/api/account/privacy/delete",{method:"POST",cookie:cookies.b,body:{currentPassword:credential.b,confirmation:"EXCLUIR"}});
      assert.equal(removed.status,200);
      assert.equal(removed.data.ok,true);
      assert.equal((await send("/api/account",{cookie:cookies.b})).status,401);
      assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM users WHERE email=$1",[userB])).rows[0].count,0);
      assert.equal((await send("/api/account",{cookie:cookies.a})).status,200);
    });
  }finally{
    globalThis.fetch=nativeFetch;
    if(server)await close(server);
    if(pythonServer)await close(pythonServer);
    try{if(schemaReady)await db.query("DELETE FROM users WHERE email=ANY($1::text[])",[[userA,userB,userANew]]);}
    finally{await db.end();}
    if(originalEnvPython===undefined)delete process.env.PYTHON_API_URL;else process.env.PYTHON_API_URL=originalEnvPython;
    if(originalEnvBase===undefined)delete process.env.APP_BASE_URL;else process.env.APP_BASE_URL=originalEnvBase;
  }
});
