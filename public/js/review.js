"use strict";
(() => {
  const $=selector=>document.querySelector(selector);
  const html=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  const asDate=date=>new Date(`${date}T12:00:00`);
  const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const add=(date,days)=>{const d=asDate(date);d.setDate(d.getDate()+days);return iso(d);};
  const monday=date=>add(date,-((asDate(date).getDay()+6)%7));
  const today=iso(new Date());
  let present=monday(today);
  let selected=null;
  let review=null;
  const formatted=date=>asDate(date).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"});
  const minutes=seconds=>{const minutes=Math.round(seconds/60);return minutes>=60?`${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,"0")}m`:`${minutes} min`;};
  const change=(current,previous,kind)=>{
    if(previous===0)return "Sem base anterior";
    const percent=Math.round((current-previous)/previous*100);
    return `${percent>=0?"+":""}${percent}% vs. anterior`;
  };
  async function load() {
    $("#reviewStatus").textContent="Atualizando retrospectiva...";
    try {
      const response=await fetch(selected?`/api/weekly-review?week=${encodeURIComponent(selected)}`:"/api/weekly-review");
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Não foi possível carregar.");
      if(selected===null) {selected=data.period.start;present=data.period.start;}
      review=data;render();
    } catch(error){$("#reviewStatus").textContent=error.message;$("#reviewOverview").innerHTML='<div class="empty">Não foi possível carregar o resumo.</div>';}
  }
  function render() {
    if(!review)return;
    const {period,current,previous,highlights,goalProgress,nextWeek}=review;
    $("#reviewTitle").textContent=`${formatted(period.start)} — ${formatted(period.end)}`;
    $("#reviewStatus").textContent=period.partial?"Semana em andamento · indicadores até hoje":"Semana concluída";
    $("#reviewNext").disabled=selected>=present;
    $("#reviewOverview").innerHTML=[
      ["Tarefas concluídas",current.tasksCompleted,change(current.tasksCompleted,previous.tasksCompleted)],
      ["Tempo de foco",minutes(current.focusSeconds),change(current.focusSeconds,previous.focusSeconds)],
      ["Hábitos realizados",current.habitRate===null?"—":`${current.habitRate}%`,`${current.habitCompleted} de ${current.habitPlanned} programados`],
      ["Etapas de objetivos",current.goalStepsCompleted,change(current.goalStepsCompleted,previous.goalStepsCompleted)]
    ].map(([title,value,caption])=>`<article class="review-stat"><span>${html(title)}</span><strong>${html(value)}</strong><small>${html(caption)}</small></article>`).join("");
    $("#reviewHighlights").innerHTML=highlights.map(text=>`<p><span aria-hidden="true">✧</span>${html(text)}</p>`).join("");
    $("#reviewCaveat").textContent=review.note;
    $("#reviewGoals").innerHTML=goalProgress.length?goalProgress.slice(0,8).map(g=>`<div class="review-goal"><div><strong>${html(g.title)}</strong><span>${g.advances?`+${g.advances} etapa(s) nesta semana`:"Sem novas etapas registradas"}</span></div><div class="progress-track"><span style="width:${g.progress}%"></span></div><small>${g.progress}% concluído</small></div>`).join(""):'<p class="muted small">Cadastre objetivos para acompanhar sua evolução aqui.</p>';
    $("#reviewNextLabel").textContent=`Próxima semana: ${formatted(nextWeek.start)} a ${formatted(nextWeek.end)} · ${review.pendingCount} tarefa(s) comum(ns) pendente(s) no total.`;
    $("#reviewPending").innerHTML=nextWeek.tasks.length?nextWeek.tasks.map(t=>`<div class="review-pending-row"><div><strong>${html(t.title)}</strong><span>${t.recurring?"Recorrente · ":""}${t.dueDate?html(formatted(t.dueDate)):"Sem data"}</span></div><a class="subtle-link" href="/tasks">Organizar →</a></div>`).join(""):'<div class="empty"><strong>Tudo organizado</strong>Não há tarefas pendentes para sugerir.</div>';
  }
  $("#reviewPrevious").addEventListener("click",()=>{selected=add(selected,-7);load();});
  $("#reviewNext").addEventListener("click",()=>{if(selected<present){selected=add(selected,7);load();}});
  $("#reviewCurrent").addEventListener("click",()=>{selected=present;load();});
  $("#reviewPlanToggle").addEventListener("click",()=>{const section=$("#reviewPlan");section.hidden=!section.hidden;$("#reviewPlanToggle").setAttribute("aria-expanded",String(!section.hidden));$("#reviewPlanToggle").textContent=section.hidden?"Ver tarefas pendentes":"Ocultar tarefas";});
  load();
})();
