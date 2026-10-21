"use strict";
const { addDays, occurrences } = require("../../recurrence-utils");

function monday(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
function daysBetween(from,to) {
  const out = [];
  for (let date=from;date<=to && out.length<20;date=addDays(date,1)) out.push(date);
  return out;
}
function summarizeWeek(dates, completions, focusRows, habits, marked, events) {
  const completionCounts = new Map(completions.map(r => [r.date,Number(r.count)]));
  const focusCounts = new Map(focusRows.map(r => [r.date,{seconds:Number(r.seconds),sessions:Number(r.sessions)}]));
  const markedSet = new Set(marked.map(r => `${r.id}@${r.date}`));
  let tasks=0,seconds=0,sessions=0,scheduled=0,completed=0;
  for(const date of dates) {
    tasks += completionCounts.get(date)||0;
    seconds += focusCounts.get(date)?.seconds||0;
    sessions += focusCounts.get(date)?.sessions||0;
    const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
    const expected=habits.filter(h => h.created<=date && h.days.includes(weekday));
    scheduled+=expected.length;
    completed+=expected.filter(h=>markedSet.has(`${h.id}@${date}`)).length;
  }
  const steps=events.filter(e=>dates.includes(e.date)).length;
  return {tasksCompleted:tasks,focusSeconds:seconds,focusSessions:sessions,habitPlanned:scheduled,habitCompleted:completed,
    habitRate:scheduled?Math.round(100*completed/scheduled):null,goalStepsCompleted:steps};
}
function weekComparison(current,previous) {
  const diffs={};
  for(const field of ["tasksCompleted","focusSeconds","goalStepsCompleted"]) {
    diffs[field]=previous[field]>0?Math.round((current[field]-previous[field])/previous[field]*100):null;
  }
  return diffs;
}
function weeklyNotes(current,previous,remaining,partial) {
  const notes=[];
  if(current.tasksCompleted>0) notes.push(`${current.tasksCompleted} tarefa(s) concluída(s) no período.`);
  if(current.focusSeconds>0) notes.push(`Você registrou ${Math.round(current.focusSeconds/60)} minutos de foco.`);
  if(current.habitRate!==null) notes.push(`${current.habitRate}% das ocorrências planejadas de hábitos foram registradas.`);
  if(current.goalStepsCompleted>0) notes.push(`${current.goalStepsCompleted} avanço(s) em etapas de objetivos.`);
  if(remaining>0) notes.push(`${remaining} tarefa(s) pendente(s) disponíveis para reorganizar.`);
  if(!notes.length) notes.push("Ainda não há registros suficientes para destacar atividades nesta semana.");
  if(partial) notes.push("Semana em andamento: a comparação com a semana anterior é parcial.");
  return notes;
}
function recurringCandidates(series, existing,from,to) {
  const excludes=new Set(existing.filter(x=>x.completed||x.cancelled).map(x=>`${x.id}@${x.date}`));
  const result=[];
  for(const item of series) {
    for(const date of occurrences({start:item.start,until:item.until,type:item.repeat,days:item.days,from,to})) {
      if(!excludes.has(`${item.id}@${date}`)) result.push({id:`${item.id}@${date}`,title:item.title,dueDate:date,recurring:true});
    }
  }
  return result.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,60);
}
module.exports={monday,daysBetween,summarizeWeek,weekComparison,weeklyNotes,recurringCandidates};
