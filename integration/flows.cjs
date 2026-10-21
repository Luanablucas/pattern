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
  let pythonAvailable=true;
  let base="";
  let schemaReady=false;
  const marker=randomBytes(8).toString("hex");
  const userA=`integration-${marker}-a@pattern.local`;
  const userB=`integration-${marker}-b@pattern.local`;
  const userANew=`integration-${marker}-novo@pattern.local`;
  const originalEnvPython=process.env.PYTHON_API_URL;
  const originalEnvBase=process.env.APP_BASE_URL;
  const credential={a:"senha-de-teste-12345",b:"senha-de-teste-12345",newA:"senha-alterada-12345",resetA:"senha-redefinida-12345"};
  const cookies={};
  const send=async(route,{method="GET",body,cookie,origin,headers={}}={})=>{
    const response=await nativeFetch(`${base}${route}`,{
      method,
      headers:{...(body!==undefined?{"content-type":"application/json"}:{}),...(cookie?{cookie}:{}),...(origin?{origin}:{}),...headers},
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

    await t.test("origens externas e entradas inválidas são bloqueadas",async()=>{
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
