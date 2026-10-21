"use strict";
(() => {
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  let state={suggestions:[],categories:[],period:null,historySamples:0};
  let selected=null;
  const format=date=>new Date(date).toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short",timeZone:"America/Sao_Paulo"}).replace(".","");
  const hour=date=>new Date(date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"});
  function notice(message){const element=$("#toast");element.textContent=message;element.classList.add("visible");setTimeout(()=>element.classList.remove("visible"),3300);}
  async function request(url,method="GET",body){
    const response=await fetch(url,{method,headers:body!==undefined?{"content-type":"application/json"}:{},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(response.status===401){location.assign("/login");throw new Error("Sua sessão terminou.");}
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Não foi possível concluir.");
    return data;
  }
  function render(){
    const pending=state.suggestions.filter(item=>item.status==="proposed");
    const accepted=state.suggestions.filter(item=>item.status==="accepted");
    const dismissed=state.suggestions.filter(item=>item.status==="dismissed");
    $("#intelligencePeriod").textContent=`${new Date(`${state.period.start}T12:00:00`).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})} a ${new Date(`${state.period.end}T12:00:00`).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}`;
    $("#intelligenceSummary").innerHTML=`<article class="intelligence-stat"><span>Propostas para avaliar</span><strong>${pending.length}</strong></article><article class="intelligence-stat"><span>Adicionadas ao calendário</span><strong>${accepted.length}</strong></article><article class="intelligence-stat"><span>Sessões no histórico (90 dias)</span><strong>${state.historySamples}</strong></article>`;
    $("#intelligenceStatus").textContent=`${state.method}${state.analysisSource?` Motor utilizado nesta geração: ${state.analysisSource}.`:""} ${dismissed.length?`${dismissed.length} sugestão(ões) descartada(s).`:""}`;
    $("#intelligenceGenerate").textContent=pending.length?"✧ Buscar mais sugestões":"✧ Gerar sugestões para a semana";
    $("#intelligenceList").innerHTML=pending.length?pending.map(item=>{
      const date=`${format(item.startsAt)} · ${hour(item.startsAt)}–${hour(item.endsAt)}`;
      return `<article class="intelligence-card"><div class="intelligence-card-head"><div><p class="eyebrow">BLOCO SUGERIDO · ${item.minutes} MIN</p><h3>${escape(item.taskTitle)}</h3>${item.goalTitle?`<p class="intelligence-goal">◎ ${escape(item.goalTitle)}</p>`:""}</div><span class="intelligence-clock">◷</span></div><div class="intelligence-time">${escape(date)}</div><p class="muted small intelligence-reason">${escape(item.reason)}</p><div class="intelligence-actions"><button type="button" class="btn btn-soft" data-plan-dismiss="${item.id}">Dispensar</button><button type="button" class="btn btn-primary" data-plan-accept="${item.id}">Ver e confirmar →</button></div></article>`;
    }).join(""):`<div class="empty intelligence-empty"><strong>Nenhuma sugestão pendente</strong>Use o botão acima para procurar espaços livres na próxima semana.</div>`;
    $("#intelligenceAccepted").innerHTML=accepted.length?accepted.map(item=>`<div class="intelligence-accepted-row"><span>✓</span><div><strong>${escape(item.taskTitle)}</strong><small>${escape(format(item.startsAt))} · ${escape(hour(item.startsAt))}–${escape(hour(item.endsAt))}</small></div><a class="subtle-link" href="/calendar">Ver agenda →</a></div>`).join(""):'<p class="muted small">Nenhum bloco foi adicionado ao calendário ainda.</p>';
  }
  async function load(){
    $("#intelligenceStatus").textContent="Carregando planejamento...";
    try{state=await request("/api/intelligence");render();}
    catch(error){$("#intelligenceStatus").textContent=error.message;}
  }
  function openConfirm(id){
    selected=state.suggestions.find(x=>x.id===id);
    if(!selected)return;
    $("#intelligenceConfirmTitle").textContent=`Reservar tempo para “${selected.taskTitle}”?`;
    $("#intelligenceConfirmDate").textContent=`${format(selected.startsAt)} · ${hour(selected.startsAt)} às ${hour(selected.endsAt)}`;
    $("#intelligenceConfirmNote").textContent=selected.reason;
    $("#intelligenceConfirmError").hidden=true;
    const category=$("#intelligenceCategory");
    category.innerHTML=state.categories.map(item=>`<option value="${escape(item.id)}">${escape(item.name)}</option>`).join("");
    const personal=state.categories.find(x=>x.name.toLowerCase()==="pessoal");
    if(personal)category.value=personal.id;
    $("#intelligenceConfirmDialog").showModal();
  }
  $("#intelligenceGenerate").addEventListener("click",async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{const result=await request("/api/intelligence/generate","POST",{});state=result;render();notice(result.added?`${result.added} nova(s) sugestão(ões) preparada(s).`:"Nenhum horário adicional disponível para as tarefas selecionadas.");}
    catch(error){notice(error.message);}
    finally{button.disabled=false;}
  });
  document.addEventListener("click",async event=>{
    const target=event.target.closest("button");if(!target)return;
    if(target.dataset.planAccept){openConfirm(target.dataset.planAccept);return;}
    if(target.dataset.intelligenceClose){$("#intelligenceConfirmDialog").close();selected=null;return;}
    if(target.dataset.planDismiss){target.disabled=true;try{await request(`/api/intelligence/${target.dataset.planDismiss}/dismiss`,"POST",{});await load();notice("Sugestão dispensada.");}catch(error){notice(error.message);target.disabled=false;}return;}
    if(target.id==="intelligenceConfirmSubmit"&&selected){
      target.disabled=true;$("#intelligenceConfirmError").hidden=true;
      try{
        await request(`/api/intelligence/${selected.id}/accept`,"POST",{categoryId:$("#intelligenceCategory").value});
        $("#intelligenceConfirmDialog").close();selected=null;await load();notice("Bloco adicionado ao calendário. A tarefa original foi preservada.");
      }catch(error){const el=$("#intelligenceConfirmError");el.textContent=error.message;el.hidden=false;}
      finally{target.disabled=false;}
    }
  });
  load();
})();
