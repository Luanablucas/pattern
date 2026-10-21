"use strict";
const {addDays,localDate,occurrences}=require("../../recurrence-utils");
const {monday}=require("./weekly-review");

const TZ="America/Sao_Paulo";
const priorityScore={high:3,medium:2,low:1};
function nextWeek(today=localDate(new Date())) {
  const start=addDays(monday(today),7);
  return {start,end:addDays(start,6)};
}
function median(values) {
  const a=values.filter(x=>Number.isFinite(x)&&x>0).sort((x,y)=>x-y);
  if(!a.length)return null;
  const k=Math.floor(a.length/2);
  return a.length%2?a[k]:(a[k-1]+a[k])/2;
}
function estimate(taskId,sessions) {
  const specific=sessions.filter(s=>s.taskId===taskId).map(s=>Number(s.seconds)/60);
  if(specific.length>=2)return {minutes:Math.min(120,Math.max(25,Math.round(median(specific)/5)*5)),method:`Mediana de ${specific.length} sessões desta tarefa`};
  const general=sessions.map(s=>Number(s.seconds)/60);
  if(general.length>=5)return {minutes:Math.min(120,Math.max(25,Math.round(median(general)/5)*5)),method:`Referência de ${general.length} sessões de foco; sem histórico suficiente desta tarefa`};
  return {minutes:50,method:"Duração sugerida padrão; histórico insuficiente"};
}
function preferredHours(sessions) {
  const counts=new Map();
  const valid=sessions.filter(s=>Number(s.hour)>=8&&Number(s.hour)<=19);
  if(valid.length<5)return [9,10,14,15,16,17];
  for(const s of valid)counts.set(Number(s.hour),(counts.get(Number(s.hour))||0)+1);
  const common=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,3).map(([hour])=>hour);
  return [...new Set([...common,9,10,14,15,16,17])];
}
function occupied(events,proposals,day) {
  const from=new Date(`${day}T00:00:00-03:00`).getTime();
  const to=from+86400000;
  return [...events,...proposals].map(e=>({start:new Date(e.startsAt).getTime(),end:new Date(e.endsAt).getTime()})).filter(e=>e.end>from&&e.start<to);
}
function intersect(start,end,blocks) {
  return blocks.some(x=>start<x.end&&end>x.start);
}
function slotFor(task,estimateMinutes,events,proposals,period,hours) {
  const maxDate=task.dueDate&&task.dueDate>=period.start&&task.dueDate<period.end?task.dueDate:period.end;
  const candidates=[];
  for(let date=period.start;date<=maxDate;date=addDays(date,1)){
    const daysAway=Math.round((Date.parse(`${date}T12:00:00Z`)-Date.parse(`${period.start}T12:00:00Z`))/86400000);
    const dow=new Date(`${date}T12:00:00Z`).getUTCDay();
    const isWeekend=dow===0||dow===6;
    for(const hour of hours){
      for(const half of [0,30]){
        const start=new Date(`${date}T${String(hour).padStart(2,"0")}:${String(half).padStart(2,"0")}:00-03:00`).getTime();
        const end=start+estimateMinutes*60000;
        const dayEnd=new Date(`${date}T20:00:00-03:00`).getTime();
        if(end>dayEnd)continue;
        if(intersect(start,end,occupied(events,proposals,date)))continue;
        candidates.push({startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),score:daysAway*10+(isWeekend?20:0)+(hours.indexOf(hour)*2)+half/30});
      }
    }
  }
  candidates.sort((a,b)=>a.score-b.score||a.startsAt.localeCompare(b.startsAt));
  return candidates[0]||null;
}
function candidates(tasks,series,records,links,period) {
  const byTask=new Map();
  for(const link of links){
    if(!byTask.has(link.taskId))byTask.set(link.taskId,[]);
    byTask.get(link.taskId).push(link);
  }
  const list=tasks.filter(t=>!t.completed&&t.repeat==="none")
    .map(t=>({...t,occurrenceDate:null,goals:byTask.get(t.id)||[]}));
  const marks=new Map(records.map(x=>[`${x.id}@${x.date}`,x]));
  for(const task of series){
    const dates=occurrences({start:task.dueDate,until:task.repeatUntil,type:task.repeat,days:task.repeatDays||[],from:period.start,to:period.end});
    for(const date of dates){
      const mark=marks.get(`${task.id}@${date}`);
      if(mark?.completed||mark?.cancelled)continue;
      list.push({...task,occurrenceDate:date,dueDate:date,goals:byTask.get(task.id)||[]});
    }
  }
  return list.map(t=>{
    const goals=t.goals.filter(g=>g.status==="active");
    const linkedGoal=goals.sort((a,b)=>priorityScore[b.priority]-priorityScore[a.priority]||(a.dueDate||"9999").localeCompare(b.dueDate||"9999"))[0]||null;
    const score=priorityScore[t.priority]*100+(linkedGoal?80+priorityScore[linkedGoal.priority]*20:0)+(t.dueDate&&t.dueDate<=period.end?100:0);
    return {...t,linkedGoal,score};
  }).sort((a,b)=>b.score-a.score||(a.dueDate||"9999").localeCompare(b.dueDate||"9999")||a.title.localeCompare(b.title,"pt-BR"));
}
function plan(tasks,series,records,links,sessions,events,existing,period,limit=6,hoursOverride=null) {
  const suggestions=[];
  const keys=new Set(existing.map(x=>`${x.taskId}@${x.occurrenceDate||""}`));
  const hours=hoursOverride?.length?hoursOverride:preferredHours(sessions);
  for(const task of candidates(tasks,series,records,links,period)){
    if(suggestions.length>=limit)break;
    const key=`${task.id}@${task.occurrenceDate||""}`;
    if(keys.has(key))continue;
    const effort=estimate(task.id,sessions);
    const slot=slotFor(task,effort.minutes,events,[...existing.filter(x=>x.status==="proposed"),...suggestions],period,hours);
    if(!slot)continue;
    const rationale=[task.priority==="high"?"Prioridade alta":task.priority==="medium"?"Prioridade média":"Prioridade baixa"];
    if(task.linkedGoal)rationale.push(`Relacionado ao objetivo: ${task.linkedGoal.title}`);
    if(task.dueDate)rationale.push(`Prazo: ${task.dueDate}`);
    rationale.push(effort.method);
    suggestions.push({taskId:task.id,taskTitle:task.title,occurrenceDate:task.occurrenceDate,goalId:task.linkedGoal?.id||null,goalTitle:task.linkedGoal?.title||null,startsAt:slot.startsAt,endsAt:slot.endsAt,minutes:effort.minutes,reason:rationale.join(" · ")});
    keys.add(key);
  }
  return suggestions;
}
function hasConflict(events,startsAt,endsAt) {return intersect(new Date(startsAt).getTime(),new Date(endsAt).getTime(),events.map(e=>({start:new Date(e.startsAt).getTime(),end:new Date(e.endsAt).getTime()})));}
module.exports={nextWeek,median,estimate,preferredHours,occupied,hasConflict,slotFor,candidates,plan};
