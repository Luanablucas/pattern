"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");

test("PostgreSQL de testes usa serviço próprio e volume diferente do banco principal",()=>{
  const compose=fs.readFileSync(path.join(root,"docker-compose.integration.yml"),"utf8");
  const original=fs.readFileSync(path.join(root,"docker-compose.yml"),"utf8");
  assert.match(compose,/postgres_test:/);
  assert.match(compose,/name: pattern-integration/);
  assert.match(compose,/127\.0\.0\.1:5434:5432/);
  assert.match(compose,/POSTGRES_DB: pattern_test/);
  assert.match(compose,/pattern_test_db:\/var\/lib\/postgresql\/data/);
  assert.doesNotMatch(compose,/pattern_db:\/var\/lib\/postgresql\/data/);
  assert.match(original,/pattern_db:\/var\/lib\/postgresql\/data/);
});

test("testes de integração exigem nome, usuário, host e porta exclusivos",()=>{
  const script=fs.readFileSync(path.join(root,"integration","flows.cjs"),"utf8");
  assert.match(script,/parsed\.hostname!=="127\.0\.0\.1"/);
  assert.match(script,/parsed\.port!=="5434"/);
  assert.match(script,/parsed\.pathname!=="\/pattern_test"/);
  assert.match(script,/parsed\.username!=="pattern_test"/);
  assert.match(script,/DELETE FROM users WHERE email=ANY/);
  assert.doesNotMatch(script,/TRUNCATE|DROP DATABASE|DROP SCHEMA|down -v/);
});

test("cada operação de recuperação possui seu próprio limite de tentativas",()=>{
  const routes=fs.readFileSync(path.join(root,"src","routes","auth.js"),"utf8");
  const middleware=fs.readFileSync(path.join(root,"src","middleware","auth.js"),"utf8");
  assert.equal((routes.match(/recoveryLimiter\(\)/g)||[]).length,5);
  assert.match(middleware,/recoveryLimiter=\(\)=>rateLimit/);
  assert.match(middleware,/limit:5/);
});
