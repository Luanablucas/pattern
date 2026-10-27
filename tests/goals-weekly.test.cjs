"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Module=require("node:module");
const {monday,daysBetween,summarizeWeek,weekComparison,weeklyNotes,recurringCandidates}=require("../src/services/weekly-review");

test("semanas começam na segunda, inclusive na virada do ano",()=>{
  assert.equal(monday("2027-01-01"),"2026-12-28");
  assert.equal(monday("2026-10-19"),"2026-10-19");
  assert.deepEqual(daysBetween("2026-10-19","2026-10-21"),["2026-10-19","2026-10-20","2026-10-21"]);
});

test("resumo conta tarefas, foco e somente hábitos planejados",()=>{
  const days=["2026-10-19","2026-10-20"];
  const tasks=[{date:days[0],count:2},{date:days[1],count:1}];
  const focus=[{date:days[0],seconds:"1500",sessions:1},{date:days[1],seconds:"900",sessions:2}];
  const habits=[{id:"h1",created:"2026-01-01",days:[1,2]},{id:"h2",created:"2026-01-01",days:[2]}];
  const marked=[{id:"h1",date:days[0]},{id:"h2",date:days[1]}];
  const events=[{date:days[0]},{date:days[0]}];
  assert.deepEqual(summarizeWeek(days,tasks,focus,habits,marked,events),{
    tasksCompleted:3,focusSeconds:2400,focusSessions:3,habitPlanned:3,habitCompleted:2,habitRate:67,goalStepsCompleted:2
  });
});

test("sem hábitos cadastrados a taxa é nula e não NaN",()=>{
  const result=summarizeWeek(["2026-10-19"],[],[],[],[],[]);
  assert.equal(result.habitRate,null);
  assert.equal(result.focusSeconds,0);
});

test("comparação sem semana anterior não inventa crescimento",()=>{
  const summary={tasksCompleted:4,focusSeconds:600,goalStepsCompleted:1};
  assert.deepEqual(weekComparison(summary,{tasksCompleted:0,focusSeconds:0,goalStepsCompleted:0}),{
    tasksCompleted:null,focusSeconds:null,goalStepsCompleted:null
  });
  assert.equal(weekComparison(summary,{tasksCompleted:2,focusSeconds:300,goalStepsCompleted:2}).tasksCompleted,100);
  assert.ok(weeklyNotes(summary,{},2,true).some(note=>note.includes("parcial")));
});

test("tarefas recorrentes respeitam os dias e ocorrências canceladas",()=>{
  const series=[{id:"t1",title:"Estudar",start:"2026-10-19",until:null,repeat:"weekly",days:[1,3]}];
  const rows=[{id:"t1",date:"2026-10-26",cancelled:true,completed:false}];
  const result=recurringCandidates(series,rows,"2026-10-26","2026-11-01");
  assert.deepEqual(result.map(row=>row.dueDate),["2026-10-28"]);
});

function withZodMock(fn) {
  const original=Module._load;
  const chain=new Proxy(function(){return chain;},{get(_target,name){
    if(name==="safeParse")return data=>({success:true,data});
    return chain;
  },apply(){return chain;}});
  Module._load=function(request,parent,isMain){
    if(request==="zod")return {z:chain};
    return original.apply(this,arguments);
  };
  try{return fn();}finally{Module._load=original;}
}

test("etapas e vínculos são limitados ao usuário autenticado nas consultas",async()=>{
  await withZodMock(async()=>{
    const queries=[];
    const db={query:async(sql,params)=>{
      queries.push({sql,params});
      if(/RETURNING s.id,s.completed/.test(sql))return {rows:[{id:"step",completed:true,completedAt:"2026-10-20T10:00:00Z"}],rowCount:1};
      if(/COUNT\(\*\)::int AS count/.test(sql))return {rows:[{count:1}],rowCount:1};
      return {rows:[],rowCount:0};
    }};
    const ctrl=require("../src/controllers/goals")(db);
    const req={user:{id:"user-A"},params:{id:"goal-A",stepId:"step-A"},body:{completed:true}};
    const res={status(){return this;},json(data){return data;}};
    await ctrl.updateStep(req,res);
    assert.ok(queries[0].sql.includes("g.user_id=$5"));
    assert.equal(queries[0].params[4],"user-A");
    queries.length=0;
    await ctrl.removeLink({...req,params:{id:"goal-A",type:"task",entityId:"123e4567-e89b-42d3-a456-426614174000"}},res);
    assert.ok(queries[0].sql.includes("g.user_id=$1"));
    assert.equal(queries[0].params[0],"user-A");
  });
});

test("listagem de objetivos inclui etapas, links e progresso",async()=>{
  const goal={id:"g1",title:"Meu projeto",description:"",category:"Estudos",priority:"high",status:"active",dueDate:null};
  let count=0;
  const results=[
    [goal],
    [{id:"s1",goalId:"g1",title:"Preparar",completed:true},{id:"s2",goalId:"g1",title:"Concluir",completed:false}],
    [{goalId:"g1",id:"t1",title:"Criar projeto",completed:false}],
    [{goalId:"g1",id:"h1",name:"Estudar"}]
  ];
  const db={query:async()=>({rows:results[count++]})};
  const result=await withZodMock(async()=>{
    const ctrl=require("../src/controllers/goals")(db);
    let output;
    await ctrl.list({user:{id:"user-A"}},{json(value){output=value;}});
    return output;
  });
  assert.equal(result[0].progress,50);
  assert.equal(result[0].tasks.length,1);
  assert.equal(result[0].habits.length,1);
});

test("criar objetivo usa parâmetro booleano separado para concluir",async()=>{
  await withZodMock(async()=>{
    const calls=[];
    const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:"goal-created"}],rowCount:1};}};
    const ctrl=require("../src/controllers/goals")(db);
    const res={status(){return this;},json(value){return value;}};
    const body={title:"Curso",description:"",category:"Estudos",priority:"high",dueDate:null,status:"completed"};
    await ctrl.create({user:{id:"user-A"},body},res);
    assert.match(calls[0].sql,/CASE WHEN \$9 THEN NOW\(\)/);
    assert.equal(calls[0].params.length,9);
    assert.equal(calls[0].params[7],"completed");
    assert.equal(calls[0].params[8],true);
    await ctrl.create({user:{id:"user-A"},body:{...body,status:"active"}},res);
    assert.equal(calls[1].params[8],false);
  });
});

test("atualizar objetivo não mistura tipos do parâmetro de situação",async()=>{
  await withZodMock(async()=>{
    const calls=[];
    const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:"goal-A"}],rowCount:1};}};
    const ctrl=require("../src/controllers/goals")(db);
    const res={status(){return this;},json(value){return value;}};
    const body={title:"Curso",description:"",category:"Estudos",priority:"high",dueDate:null,status:"completed"};
    await ctrl.update({user:{id:"user-A"},params:{id:"goal-A"},body},res);
    assert.match(calls[0].sql,/CASE WHEN \$9 THEN COALESCE\(completed_at,NOW\(\)\)/);
    assert.equal(calls[0].params.length,9);
    assert.equal(calls[0].params[5],"completed");
    assert.equal(calls[0].params[8],true);
    await ctrl.update({user:{id:"user-A"},params:{id:"goal-A"},body:{...body,status:"paused"}},res);
    assert.equal(calls[1].params[8],false);
  });
});
