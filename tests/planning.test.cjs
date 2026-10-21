"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {nextWeek,median,estimate,preferredHours,hasConflict,slotFor,candidates,plan}=require("../src/services/planning");
const period={start:"2026-10-26",end:"2026-11-01"};
const task={id:"task-1",title:"Estudar Python",priority:"high",dueDate:"2026-10-30",completed:false,repeat:"none"};
const session=(taskId,seconds,hour=9)=>({taskId,seconds,hour});

test("a próxima semana começa na segunda-feira",()=>{
  assert.deepEqual(nextWeek("2026-10-20"),{start:"2026-10-26",end:"2026-11-01"});
  assert.deepEqual(nextWeek("2026-10-25"),{start:"2026-10-26",end:"2026-11-01"});
});
test("mediana resiste a duração atípica",()=>{
  assert.equal(median([25,30,450]),30);
  assert.equal(median([20,40]),30);
  assert.equal(median([]),null);
});
test("estimativa usa duas sessões da tarefa",()=>{
  const x=estimate("x",[session("x",1800),session("x",3600),session("y",100)]);
  assert.equal(x.minutes,45);
  assert.match(x.method,/2 sessões desta tarefa/);
});
test("sem dados suficientes usa 50 minutos com ressalva",()=>{
  const x=estimate("x",[session("other",900)]);
  assert.equal(x.minutes,50);
  assert.match(x.method,/insuficiente/);
});
test("com histórico geral mas sem específico sinaliza a limitação",()=>{
  const s=Array.from({length:5},()=>session("y",3000));
  assert.equal(estimate("x",s).minutes,50);
  assert.match(estimate("x",s).method,/sem histórico suficiente desta tarefa/);
});
test("horários favoritos requerem pelo menos cinco sessões",()=>{
  assert.deepEqual(preferredHours([session("x",1500,11)])[0],9);
  const ranked=preferredHours([9,9,9,10,10,17].map(h=>session("x",1200,h)));
  assert.equal(ranked[0],9);
  assert.equal(ranked[1],10);
});
test("conflitos respeitam fronteiras, com fim exclusivo",()=>{
  const existing=[{startsAt:"2026-10-26T12:00:00.000Z",endsAt:"2026-10-26T13:00:00.000Z"}];
  assert.equal(hasConflict(existing,"2026-10-26T11:00:00.000Z","2026-10-26T12:00:00.000Z"),false);
  assert.equal(hasConflict(existing,"2026-10-26T12:30:00.000Z","2026-10-26T13:30:00.000Z"),true);
});
test("agendamento evita compromisso que ocupa o dia inteiro",()=>{
  const event={startsAt:"2026-10-26T03:00:00.000Z",endsAt:"2026-10-27T03:00:00.000Z"};
  const result=slotFor(task,50,[event],[],period,[9]);
  assert.ok(result);
  assert.equal(result.startsAt.slice(0,10),"2026-10-27");
});
test("tarefa atrasada também pode receber horário na próxima semana",()=>{
  const result=slotFor({...task,dueDate:"2026-10-15"},50,[],[],period,[9]);
  assert.ok(result);
});
test("tarefas concluídas e ocorrências canceladas não recebem sugestões",()=>{
  const recurring={...task,id:"recurring",repeat:"weekly",repeatDays:[1],dueDate:"2026-10-05"};
  const selected=candidates([{...task,completed:true}],[recurring],[{id:"recurring",date:"2026-10-26",cancelled:true}],[],period);
  assert.equal(selected.length,0);
});
test("objetivo ativo e prioridade influenciam ordem",()=>{
  const low={...task,id:"low",priority:"low"};
  const high={...task,id:"high",priority:"medium"};
  const links=[{taskId:"low",id:"goal",title:"Concluir projeto",priority:"high",status:"active",dueDate:null}];
  const selected=candidates([low,high],[],[],links,period);
  assert.equal(selected[0].id,"low");
  assert.equal(selected[0].linkedGoal.title,"Concluir projeto");
});
test("geração não repete tarefa já proposta e não cria sobreposição",()=>{
  const t2={...task,id:"task-2",title:"Documentar projeto"};
  const generated=plan([task,t2],[],[],[],[],[],[],period,6);
  assert.equal(generated.length,2);
  assert.equal(hasConflict([generated[0]],generated[1].startsAt,generated[1].endsAt),false);
  const again=plan([task,t2],[],[],[],[],[],[{taskId:task.id,occurrenceDate:null,status:"proposed",startsAt:generated[0].startsAt,endsAt:generated[0].endsAt}],period,6);
  assert.equal(again.length,1);
  assert.equal(again[0].taskId,t2.id);
});
