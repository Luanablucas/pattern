"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("propostas ficam no PostgreSQL com dono, prazo de validade e estado",()=>{
  const sql=read("sql/schema.sql");
  assert.match(sql,/CREATE TABLE IF NOT EXISTS ai_action_proposals/);
  assert.match(sql,/user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql,/status VARCHAR\(12\) NOT NULL DEFAULT 'pending'/);
  assert.match(sql,/expires_at TIMESTAMPTZ NOT NULL/);
});

test("aprovação exige autenticação, CSRF e bloqueio transacional",()=>{
  const app=read("src/app.js");
  const route=read("src/routes/assistant.js");
  const service=read("src/services/assistant-actions.js");
  assert.ok(app.indexOf('app.use("/api",verifyApiOrigin,verifyCsrf)')<app.indexOf('require(`./routes/${name}`)'));
  assert.ok(app.indexOf('app.use("/api",requireAuth(db))')<app.indexOf('require(`./routes/${name}`)'));
  assert.match(route,/app\.post\("\/api\/assistant\/proposals\/:id"/);
  assert.match(service,/WHERE id=\$1 AND user_id=\$2 FOR UPDATE/);
  assert.match(service,/new Date\(row\.expires_at\)\.getTime\(\)<=Date\.now\(\)/);
  assert.match(service,/await client\.query\("COMMIT"\)/);
  assert.match(service,/await client\.query\("ROLLBACK"\)/);
});

test("interface apresenta ações confirmáveis sem executar do navegador nem expor chave",()=>{
  const source=read("public/js/assistant.js");
  assert.match(source,/function proposalCard\(/);
  assert.match(source,/Confirmar e salvar/);
  assert.match(source,/Cancelar/);
  assert.match(source,/api\/assistant\/proposals/);
  assert.match(source,/\.textContent=/);
  assert.doesNotMatch(source,/process\.env\.OPENAI_API_KEY|Bearer /);
  assert.match(source,/includeContext:consent\.checked/);
});
