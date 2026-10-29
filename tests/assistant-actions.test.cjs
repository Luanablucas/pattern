"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const {generateAnswer}=require("../src/services/assistant");
const {tools,ActionError,normalizedAction,saveProposal,decideProposal}=require("../src/services/assistant-actions");

function mockDb(){
  const proposals=new Map();
  const inserted=[];
  const userId=randomUUID();
  const otherUserId=randomUUID();
  const client={
    async query(sql,params=[]){
      if(sql==="BEGIN"||sql==="COMMIT"||sql==="ROLLBACK")return {rows:[]};
      if(sql.includes("FROM ai_action_proposals")&&sql.includes("FOR UPDATE")){
        const item=proposals.get(params[0]);
        return {rows:item&&item.userId===params[1]?[item]:[]};
      }
      if(sql.startsWith("UPDATE ai_action_proposals")){
        const item=proposals.get(params[0]);
        item.status=sql.includes("executed")?"executed":"rejected";
        return {rowCount:1,rows:[]};
      }
      if(sql.startsWith("INSERT INTO tasks")){
        inserted.push({table:"tasks",params});
        return {rowCount:1,rows:[{id:params[0],title:params[2],dueDate:params[4]}]};
      }
      if(sql.includes("FROM event_categories"))return {rows:[{id:randomUUID(),legacy_key:params[1]}]};
      if(sql.includes("FROM events e")||sql.includes("FROM event_overrides")||sql.includes("FROM event_cancellations"))return {rows:[]};
      if(sql.startsWith("INSERT INTO events")){
        inserted.push({table:"events",params});return {rowCount:1,rows:[]};
      }
      throw new Error(`Consulta não simulada: ${sql.slice(0,80)}`);
    },release(){}
  };
  return {userId,otherUserId,proposals,inserted,
    async query(sql,params){
      if(sql.startsWith("DELETE FROM ai_action_proposals"))return {rowCount:0};
      if(sql.startsWith("INSERT INTO ai_action_proposals")){
        proposals.set(params[0],{action_type:params[2],arguments:JSON.parse(params[3]),status:"pending",expires_at:new Date(Date.now()+15*60000),userId:params[1]});
        return {rowCount:1};
      }
      throw new Error(`Consulta inesperada: ${sql.slice(0,70)}`);
    },async connect(){return client;}
  };
}

test("Function Calling anuncia duas ferramentas estritas e sem funções de exclusão",()=>{
  assert.deepEqual(tools.map(tool=>tool.name),["create_task","create_event"]);
  for(const tool of tools){
    assert.equal(tool.type,"function");assert.equal(tool.strict,true);
    assert.equal(tool.parameters.additionalProperties,false);
    assert.deepEqual(new Set(tool.parameters.required),new Set(Object.keys(tool.parameters.properties)));
  }
});

test("propostas recusam parâmetros extras, funções desconhecidas e compromissos inválidos",()=>{
  assert.throws(()=>normalizedAction("delete_task",{}),ActionError);
  assert.throws(()=>normalizedAction("create_task",{title:"ok",priority:"high",due_date:null,notes:null,admin:true}),ActionError);
  assert.throws(()=>normalizedAction("create_task",{"title":"",priority:"high",due_date:null,notes:null}),ActionError);
  const starts=new Date(Date.now()+24*3600000).toISOString();
  assert.throws(()=>normalizedAction("create_event",{title:"Reunião",starts_at:starts,ends_at:starts,category:"work",notes:null}),ActionError);
});

test("modelo devolve function_call sem executar operação e com store=false",async()=>{
  let body;
  const result=await generateAnswer({apiKey:"test",message:"Crie uma tarefa",tools,fetchImpl:async(_url,request)=>{
    body=JSON.parse(request.body);
    return {ok:true,json:async()=>({output:[{type:"function_call",name:"create_task",call_id:"call_123",arguments:JSON.stringify({title:"Estudar",due_date:null,priority:"medium",notes:null})}]})};
  }});
  assert.equal(body.tool_choice,"auto");
  assert.equal(body.parallel_tool_calls,false);
  assert.equal(body.store,false);
  assert.equal(body.tools.length,2);
  assert.equal(result.toolCall.name,"create_task");
  assert.match(result.answer,/Nenhuma alteração/);
});

test("proposta só grava tarefa após confirmação e não duplica",async()=>{
  const db=mockDb();
  const action=normalizedAction("create_task",{title:"Estudar",due_date:null,priority:"high",notes:null});
  const proposal=await saveProposal(db,db.userId,action);
  assert.equal(db.inserted.length,0);
  await assert.rejects(()=>decideProposal(db,db.otherUserId,proposal.id,"confirm"),error=>error.status===404);
  const confirmed=await decideProposal(db,db.userId,proposal.id,"confirm");
  assert.equal(confirmed.status,"executed");
  assert.equal(confirmed.created.href,"/tasks");
  assert.equal(db.inserted.length,1);
  assert.equal(db.inserted[0].params[1],db.userId);
  await assert.rejects(()=>decideProposal(db,db.userId,proposal.id,"confirm"),error=>error.status===409);
  assert.equal(db.inserted.length,1);
});

test("cancelamento e expiração impedem gravação",async()=>{
  const db=mockDb();
  const action=normalizedAction("create_task",{title:"Tarefa",due_date:null,priority:"medium",notes:null});
  const one=await saveProposal(db,db.userId,action);
  assert.equal((await decideProposal(db,db.userId,one.id,"reject")).status,"rejected");
  await assert.rejects(()=>decideProposal(db,db.userId,one.id,"confirm"),error=>error.status===409);
  const two=await saveProposal(db,db.userId,action);
  db.proposals.get(two.id).expires_at=new Date(Date.now()-2000);
  await assert.rejects(()=>decideProposal(db,db.userId,two.id,"confirm"),error=>error.status===409);
  assert.equal(db.inserted.length,0);
});

test("compromisso validado só é salvo depois de confirmar",async()=>{
  const db=mockDb();
  const start=new Date(Date.now()+4*86400000);
  const end=new Date(start.getTime()+3600000);
  const action=normalizedAction("create_event",{title:"Aula",starts_at:start.toISOString(),ends_at:end.toISOString(),category:"study",notes:null});
  const proposal=await saveProposal(db,db.userId,action);
  const saved=await decideProposal(db,db.userId,proposal.id,"confirm");
  assert.equal(saved.created.href,"/calendar");
  assert.equal(db.inserted[0].table,"events");
  assert.equal(db.inserted[0].params[1],db.userId);
});
