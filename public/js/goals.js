"use strict";
(() => {
  const $ = selector => document.querySelector(selector);
  const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[character]);
  const state = { goals:[], options:{tasks:[],habits:[]}, filter:"active", pending:null };
  const statusNames = {active:"Em andamento",paused:"Pausado",completed:"Concluído",archived:"Arquivado"};
  const priorityNames = {low:"Baixa",medium:"Média",high:"Alta"};
  const notify = message => {const toast=$("#toast");toast.textContent=message;toast.classList.add("visible");setTimeout(()=>toast.classList.remove("visible"),3200);};
  async function request(url,method="GET",body) {
    const response=await fetch(url,{method,headers:body!==undefined?{"content-type":"application/json"}:{},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(response.status===401){location.assign("/login");throw new Error("Faça login novamente.");}
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Não foi possível concluir a ação.");
    return data;
  }
  const dateLabel = date => date?new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR"):"Sem prazo";
  function overview() {
    const active=state.goals.filter(g=>g.status==="active");
    const done=state.goals.filter(g=>g.status==="completed").length;
    const stages=active.reduce((sum,g)=>sum+g.completedSteps,0);
    $("#goalOverview").innerHTML=`<article class="goal-stat"><span class="eyebrow">EM ANDAMENTO</span><strong>${active.length}</strong><p>Objetivos ativos</p></article><article class="goal-stat"><span class="eyebrow">ETAPAS REALIZADAS</span><strong>${stages}</strong><p>Nos objetivos ativos</p></article><article class="goal-stat"><span class="eyebrow">CONCLUÍDOS</span><strong>${done}</strong><p>Objetivos alcançados</p></article>`;
  }
  function options(type) {
    const items=type==="task"?state.options.tasks:state.options.habits;
    return items.map(item=>`<option value="${html(item.id)}">${html(item.title||item.name)}</option>`).join("");
  }
  function card(g) {
    const steps=g.steps.map(step=>`<div class="goal-step">
      <label class="goal-step-label"><input type="checkbox" class="check" data-goal-step-toggle="${step.id}" data-goal-id="${g.id}" ${step.completed?"checked":""} /><span class="${step.completed?"is-complete":""}">${html(step.title)}</span></label>
      <button type="button" class="mini-button" data-goal-step-remove="${step.id}" data-goal-id="${g.id}" aria-label="Excluir etapa ${html(step.title)}">×</button></div>`).join("");
    const links=[...g.tasks.map(item=>`<span class="goal-link">☑ ${html(item.title)} <button type="button" data-goal-unlink="task" data-entity-id="${item.id}" data-goal-id="${g.id}" aria-label="Desvincular tarefa">×</button></span>`),...g.habits.map(item=>`<span class="goal-link">◷ ${html(item.name)} <button type="button" data-goal-unlink="habit" data-entity-id="${item.id}" data-goal-id="${g.id}" aria-label="Desvincular hábito">×</button></span>`)].join("");
    return `<article class="goal-card" data-goal-card="${g.id}">
      <div class="goal-card-top"><div><span class="goal-category">${html(g.category)}</span><span class="goal-priority">${html(priorityNames[g.priority])} prioridade</span><h3>${html(g.title)}</h3></div><div class="row-actions"><button type="button" class="mini-button" data-goal-edit="${g.id}" aria-label="Editar objetivo">✎</button><button type="button" class="mini-button" data-goal-remove="${g.id}" aria-label="Excluir objetivo">×</button></div></div>
      ${g.description?`<p class="muted small goal-description">${html(g.description)}</p>`:""}
      <div class="goal-info"><span>${html(statusNames[g.status])}</span><span>◷ ${html(dateLabel(g.dueDate))}</span></div>
      <div class="goal-progress-caption"><strong>Progresso</strong><span>${g.completedSteps} de ${g.totalSteps} etapas · ${g.progress}%</span></div>
      <div class="progress-track" role="progressbar" aria-label="Progresso de ${html(g.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${g.progress}"><span style="width:${g.progress}%"></span></div>
      <div class="goal-step-section"><strong>Etapas</strong>${steps||'<p class="muted small">Adicione etapas para acompanhar o progresso.</p>'}
        <form class="goal-add-step" data-goal-add-step="${g.id}"><input name="title" maxlength="160" required aria-label="Nova etapa" placeholder="Nova etapa..." /><button type="submit" class="btn btn-soft">Adicionar</button></form></div>
      <details class="goal-linked"><summary>Tarefas e hábitos vinculados (${g.tasks.length+g.habits.length})</summary><div class="goal-link-list">${links||'<p class="muted small">Nenhum vínculo ainda.</p>'}</div>
        <form class="goal-add-link" data-goal-add-link="${g.id}"><select name="type" aria-label="Tipo de vínculo"><option value="task">Tarefa</option><option value="habit">Hábito</option></select><select name="entityId" aria-label="Escolher item" required>${options("task")}</select><button type="submit" class="btn btn-soft">Vincular</button></form>
      </details>
      <div class="goal-actions">${g.status==="active"?`<button class="btn btn-soft" data-goal-status="paused" data-goal-id="${g.id}">Pausar</button><button class="btn btn-primary" data-goal-status="completed" data-goal-id="${g.id}">Concluir</button>`:g.status==="paused"?`<button class="btn btn-primary" data-goal-status="active" data-goal-id="${g.id}">Retomar</button>`:g.status==="completed"?`<button class="btn btn-soft" data-goal-status="active" data-goal-id="${g.id}">Reabrir</button>`:`<button class="btn btn-soft" data-goal-status="active" data-goal-id="${g.id}">Restaurar</button>`}${g.status!=="archived"?`<button class="btn btn-soft" data-goal-status="archived" data-goal-id="${g.id}">Arquivar</button>`:""}</div>
    </article>`;
  }
  function render() {
    overview();
    document.querySelectorAll("[data-goal-filter]").forEach(tab=>{const active=tab.dataset.goalFilter===state.filter;tab.classList.toggle("active",active);tab.setAttribute("aria-pressed",String(active));});
    const expanded=new Set([...document.querySelectorAll(".goal-card:has(details.goal-linked[open])")].map(card=>card.dataset.goalCard));
    const goals=state.goals.filter(g=>state.filter==="all"||g.status===state.filter);
    $("#goalList").innerHTML=goals.length?goals.map(card).join(""):'<div class="empty goal-empty"><strong>Nenhum objetivo nesta seção</strong>Crie um objetivo ou escolha outro filtro.</div>';
    document.querySelectorAll(".goal-card").forEach(card=>{if(expanded.has(card.dataset.goalCard))card.querySelector("details.goal-linked").open=true;});
  }
  async function refresh() {state.goals=await request("/api/goals");render();}
  function edit(goal=null) {
    const form=$("#goalForm");form.reset();
    for(const field of ["id","title","description","category","priority","dueDate","status"]) form.elements[field].value=goal?.[field]??(field==="category"?"Pessoal":field==="priority"?"medium":field==="status"?"active":"");
    $("#goalDialogTitle").textContent=goal?"Editar objetivo":"Novo objetivo";
    $("#goalError").hidden=true;
    $("#goalDialog").showModal();form.elements.title.focus();
  }
  async function statusChange(id,status) {
    const g=state.goals.find(item=>item.id===id);if(!g)return;
    await request(`/api/goals/${id}`,"PUT",{title:g.title,description:g.description,category:g.category,priority:g.priority,dueDate:g.dueDate,status});
    await refresh();notify("Objetivo atualizado.");
  }
  function confirmDelete({message,action}) {
    state.pending=action;$("#goalConfirmText").textContent=message;$("#goalConfirmError").hidden=true;$("#goalConfirm").showModal();
  }
  document.addEventListener("click",async event=>{
    const button=event.target.closest("button");if(!button)return;
    try {
      if(button.dataset.goalClose){$(`#${button.dataset.goalClose}`).close();return;}
      if(button.id==="goalNew"){edit();return;}
      if(button.id==="goalConfirmSubmit") {if(state.pending){button.disabled=true;try{await state.pending();state.pending=null;$("#goalConfirm").close();await refresh();notify("Exclusão concluída.");}finally{button.disabled=false;}}return;}
      const id=button.dataset.goalId||button.dataset.goalEdit||button.dataset.goalRemove;
      const goal=state.goals.find(g=>g.id===id);
      if(button.dataset.goalEdit){if(goal)edit(goal);return;}
      if(button.dataset.goalRemove){if(goal)confirmDelete({message:`Excluir “${goal.title}” e suas etapas? As tarefas e hábitos vinculados serão preservados.`,action:()=>request(`/api/goals/${id}`,"DELETE")});return;}
      if(button.dataset.goalStatus){await statusChange(id,button.dataset.goalStatus);return;}
      if(button.dataset.goalStepToggle) return;
      if(button.dataset.goalStepRemove){const step=goal?.steps.find(s=>s.id===button.dataset.goalStepRemove);if(step)confirmDelete({message:`Excluir a etapa “${step.title}”?`,action:()=>request(`/api/goals/${id}/steps/${step.id}`,"DELETE")});return;}
      if(button.dataset.goalUnlink){await request(`/api/goals/${id}/links/${button.dataset.goalUnlink}/${button.dataset.entityId}`,"DELETE");await refresh();notify("Vínculo removido.");return;}
      if(button.dataset.goalFilter){state.filter=button.dataset.goalFilter;render();}
    } catch(error){const target=$("#goalConfirm").open?$("#goalConfirmError"):null;if(target){target.textContent=error.message;target.hidden=false;}else notify(error.message);}
  });
  document.addEventListener("change",async event=>{
    const target=event.target;
    if(target.matches("[data-goal-step-toggle]")) {
      try{await request(`/api/goals/${target.dataset.goalId}/steps/${target.dataset.goalStepToggle}`,"PATCH",{completed:target.checked});await refresh();}
      catch(error){target.checked=!target.checked;notify(error.message);}
    }
    if(target.matches(".goal-add-link select[name=type]")) {
      const select=target.closest("form").elements.entityId;
      select.innerHTML=options(target.value);
    }
  });
  document.addEventListener("submit",async event=>{
    const form=event.target;
    if(!form.matches("#goalForm,[data-goal-add-step],[data-goal-add-link]"))return;
    event.preventDefault();
    const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
    try{
      if(form.matches("#goalForm")) {
        const id=form.elements.id.value;
        const body=Object.fromEntries(["title","description","category","priority","status"].map(k=>[k,form.elements[k].value]));body.dueDate=form.elements.dueDate.value||null;
        await request(id?`/api/goals/${id}`:"/api/goals",id?"PUT":"POST",body);
        $("#goalDialog").close();notify(id?"Objetivo atualizado.":"Objetivo criado.");
      } else if(form.dataset.goalAddStep){await request(`/api/goals/${form.dataset.goalAddStep}/steps`,"POST",{title:form.elements.title.value});notify("Etapa adicionada.");}
      else if(form.dataset.goalAddLink){await request(`/api/goals/${form.dataset.goalAddLink}/links`,"POST",{type:form.elements.type.value,entityId:form.elements.entityId.value});notify("Vínculo adicionado.");}
      await refresh();
    } catch(error){if(form.matches("#goalForm")){$("#goalError").hidden=false;$("#goalError").textContent=error.message;}else notify(error.message);}
    finally{if(submit)submit.disabled=false;}
  });
  Promise.all([request("/api/goals/options"),request("/api/goals")]).then(([options,goals])=>{state.options=options;state.goals=goals;render();}).catch(error=>{notify(error.message);$("#goalList").innerHTML='<div class="empty">Não foi possível carregar os objetivos.</div>';});
})();
