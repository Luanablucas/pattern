"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const Module=require("node:module");
const root=path.join(__dirname,"..");

function mockApp() {
  const routes=[];
  const middlewares=[];
  const app={routes,middlewares};
  for(const method of ["get","post","put","patch","delete"]){
    app[method]=function(route,...handlers){routes.push({method,path:route,handlers});return app;};
  }
  app.use=(...args)=>{middlewares.push(args);return app;};
  app.set=()=>app;
  app.disable=()=>app;
  return app;
}

function withMocks(run) {
  const original=Module._load;
  const chain=new Proxy(function(){return chain;},{get(_target,prop){
    if(prop==="safeParse")return data=>({success:true,data});
    return chain;
  },apply(){return chain;}});
  const express=()=>mockApp();
  express.json=()=>()=>{};
  express.static=()=>()=>{};
  const services={
    express,
    helmet:()=>()=>{},
    "cookie-parser":()=>()=>{},
    jsonwebtoken:{verify:()=>({id:"user"}),sign:()=>"token"},
    bcryptjs:{hash:async()=>"hash",compare:async()=>true},
    zod:{z:chain},
    "express-rate-limit":{rateLimit:()=>()=>{}}
  };
  try {
    Module._load=function(request,parent,isMain){
      if(Object.hasOwn(services,request))return services[request];
      return original.apply(this,arguments);
    };
    return run();
  } finally {
    Module._load=original;
  }
}

test("rotas existentes e novas rotas de autenticação continuam registradas",()=>{
  withMocks(()=>{
    const {createApp}=require("../src/app");
    const db={query:async()=>({rows:[],rowCount:0})};
    const app=createApp(db);
    const expected={
      get:["/","/login","/register","/forgot-password","/reset-password","/verify-email","/verify-pending","/:page","/api/tasks","/api/routines","/api/habits","/api/event-categories","/api/events","/api/insights","/api/analytics","/api/focus/active","/api/focus/history","/api/focus/calendar","/api/goals","/api/goals/options","/api/weekly-review","/api/intelligence","/api/theme","/api/account","/api/account/sessions","/api/assistant/status"],
      post:["/api/auth/register","/api/auth/login","/api/auth/logout","/api/auth/forgot-password","/api/auth/reset-password","/api/auth/verify-email","/api/auth/confirm-new-email","/api/auth/resend-verification","/api/account/change-password","/api/account/change-email","/api/account/sessions/revoke-others","/api/account/privacy/export","/api/account/privacy/delete","/api/assistant/chat","/api/assistant/proposals/:id","/api/tasks","/api/routines","/api/habits","/api/habits/:id/check","/api/event-categories","/api/events","/api/events/conflicts","/api/focus/start","/api/focus/:id/pause","/api/focus/:id/resume","/api/focus/:id/finish","/api/goals","/api/goals/:id/steps","/api/goals/:id/links","/api/intelligence/generate","/api/intelligence/:id/accept","/api/intelligence/:id/dismiss"],
      put:["/api/tasks/:id","/api/routines/:id","/api/habits/:id","/api/event-categories/:id","/api/events/:id","/api/goals/:id","/api/theme"],
      patch:["/api/recurring-tasks/:id/:date/toggle","/api/tasks/:id/date","/api/tasks/:id/toggle","/api/account/profile","/api/events/:id/occurrences/:date","/api/events/:id/future/:date","/api/goals/:id/steps/:stepId"],
      delete:["/api/account/sessions/:id","/api/recurring-tasks/:id/:date","/api/tasks/:id","/api/routines/:id","/api/habits/:id","/api/event-categories/:id","/api/events/:id/occurrences/:date","/api/events/:id","/api/goals/:id","/api/goals/:id/steps/:stepId","/api/goals/:id/links/:type/:entityId"]
    };
    const expectedKeys=Object.entries(expected).flatMap(([m,list])=>list.map(route=>`${m} ${route}`)).sort();
    const actual=app.routes.map(r=>`${r.method} ${r.path}`).sort();
    assert.deepEqual(actual,expectedKeys);
    assert.equal(new Set(actual).size,actual.length);
    assert.ok(app.middlewares.some(args=>args[0]==="/api" && args[1].name==="requireAuth"));
    assert.ok(app.middlewares.some(args=>args[0]==="/api" && args[1].name==="verifyApiOrigin"));
  });
});

test("controladores de tarefas, hábitos e agenda continuam respondendo com listas",async()=>{
  await withMocks(async()=>{
    const db={query:async()=>({rows:[],rowCount:0})};
    const tests=[
      ["tasks","list",{query:{}}],
      ["habits","list",{}],
      ["categories","list",{}],
      ["events","list",{query:{}}]
    ];
    for(const [name,method,request] of tests){
      const handler=require(`../src/controllers/${name}`)(db)[method];
      let payload;
      const req={user:{id:"user-id"},...request};
      const res={json(value){payload=value;return this;},status(){return this;}};
      await handler(req,res);
      if(name==="habits")assert.deepEqual(payload,{habits:[],entries:[]});
      else assert.deepEqual(payload,[]);
    }
  });
});

test("o ponto de entrada não incorpora regras de negócio nem altera o banco",()=>{
  const server=fs.readFileSync(path.join(root,"server.js"),"utf8");
  assert.match(server,/createApp\(db\)/);
  assert.doesNotMatch(server,/ALTER TABLE|CREATE TABLE|DROP TABLE|TRUNCATE/);
  assert.doesNotMatch(server,/app\.(get|post|put|patch|delete)\(/);
  assert.ok(server.length<1400);
});
