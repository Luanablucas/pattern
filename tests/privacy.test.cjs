"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {exportData,eraseAccount,datasets}=require("../src/services/privacy");

function connection(log,responses={}){
  const client={
    query:async(sql,params)=>{
      log.push({sql,params});
      if(sql.startsWith("SELECT id,name,email"))return {rows:[{id:"user-a",name:"Teste",email:"a@example.com"}]};
      if(sql.startsWith("SELECT password_hash"))return {rows:[{password_hash:"sample-hash"}]};
      if(sql.startsWith("DELETE FROM users"))return {rowCount:1,rows:[{id:"user-a"}]};
      return {rows:responses[sql]||[],rowCount:1};
    },
    release:()=>log.push({sql:"RELEASE"})
  };
  return {connect:async()=>client};
}

test("exportação seleciona apenas dados do dono e não consulta credenciais",async()=>{
  const log=[];
  const archive=await exportData(connection(log),"user-a");
  assert.equal(archive.conta.email,"a@example.com");
  assert.equal(archive.formato,"pattern-export");
  assert.equal(Object.keys(archive.dados).length,Object.keys(datasets).length);
  for(const {sql,params} of log.filter(item=>item.sql.startsWith("SELECT"))){
    assert.deepEqual(params,["user-a"]);
    assert.match(sql,/WHERE .*\$1/);
    assert.doesNotMatch(sql,/password_hash|token_hash|ip_address/i);
  }
  assert.ok(log.some(item=>item.sql.includes("REPEATABLE READ READ ONLY")));
  assert.ok(log.some(item=>item.sql==="COMMIT"));
});

test("exclusão com senha errada reverte sem excluir dados",async()=>{
  const log=[];
  const outcome=await eraseAccount(connection(log),"user-a",async()=>false);
  assert.equal(outcome,"invalid");
  assert.ok(log.some(item=>item.sql==="ROLLBACK"));
  assert.ok(!log.some(item=>item.sql.startsWith("DELETE")));
});

test("exclusão válida remove compromissos antes da conta na mesma transação",async()=>{
  const log=[];
  const outcome=await eraseAccount(connection(log),"user-a",async()=>true);
  assert.equal(outcome,"deleted");
  const commands=log.map(item=>item.sql);
  assert.ok(commands.indexOf("BEGIN")<commands.indexOf("DELETE FROM events WHERE user_id=$1"));
  assert.ok(commands.indexOf("DELETE FROM events WHERE user_id=$1")<commands.indexOf("DELETE FROM users WHERE id=$1 RETURNING id"));
  assert.ok(commands.indexOf("DELETE FROM users WHERE id=$1 RETURNING id")<commands.indexOf("COMMIT"));
  assert.deepEqual(log.filter(item=>item.sql.startsWith("DELETE")).map(item=>item.params),[["user-a"],["user-a"]]);
});

test("falha de exclusão dispara rollback e libera conexão",async()=>{
  const log=[];
  const db={connect:async()=>({query:async sql=>{log.push(sql);if(sql.startsWith("DELETE FROM users"))throw new Error("constraint");if(sql.startsWith("SELECT password"))return {rows:[{password_hash:"hash"}]};return {rows:[]};},release:()=>log.push("RELEASE")})};
  await assert.rejects(()=>eraseAccount(db,"user-a",async()=>true),/constraint/);
  assert.ok(log.includes("ROLLBACK"));
  assert.ok(log.includes("RELEASE"));
});

test("rotas de privacidade exigem autenticação, senha e confirmação e a página oferece exportação",()=>{
  const routes=fs.readFileSync(path.join(__dirname,"../src/routes/account.js"),"utf8");
  const controller=fs.readFileSync(path.join(__dirname,"../src/controllers/account.js"),"utf8");
  const app=fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8");
  const view=fs.readFileSync(path.join(__dirname,"../views/app.ejs"),"utf8");
  assert.ok(app.indexOf('app.use("/api",requireAuth(db))')<app.indexOf('require(`./routes/${name}`)'));
  assert.match(routes,/\/api\/account\/privacy\/export.*accountLimiter/);
  assert.match(routes,/\/api\/account\/privacy\/delete.*accountLimiter/);
  assert.match(controller,/confirmation:z.literal\("EXCLUIR"\)/);
  assert.match(controller,/await bcrypt.compare\(body.currentPassword/);
  for(const id of ["accountExportForm","accountDeleteForm","accountDeleteDialog"])assert.ok(view.includes(`id="${id}"`));
});
