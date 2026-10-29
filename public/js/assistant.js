"use strict";
(() => {
  const form=document.querySelector("#assistantForm");
  if(!form)return;
  const question=document.querySelector("#assistantQuestion");
  const chat=document.querySelector("#assistantChat");
  const status=document.querySelector("#assistantStatus");
  const send=document.querySelector("#assistantSend");
  const consent=document.querySelector("#assistantIncludeContext");
  const model=document.querySelector("#assistantModel");
  const history=[];
  let busy=false;

  function bubble(role,text){
    const row=document.createElement("div");
    row.className=`assistant-message assistant-message-${role}`;
    if(role==="ai"){
      const avatar=document.createElement("span");
      avatar.className="assistant-avatar";
      avatar.setAttribute("aria-hidden","true");
      avatar.textContent="✳";
      row.appendChild(avatar);
    }
    const content=document.createElement("div");
    content.className="assistant-bubble";
    content.textContent=text;
    row.appendChild(content);
    chat.appendChild(row);
    chat.scrollTop=chat.scrollHeight;
    return row;
  }

  async function jsonRequest(url,options){
    const response=await fetch(url,options);
    if(response.status===401){location.assign("/login");throw new Error("Sua sessão terminou.");}
    const data=await response.json().catch(()=>({error:"Resposta inesperada do servidor."}));
    if(!response.ok)throw new Error(data.error||"Não foi possível conversar com a IA.");
    return data;
  }

  function proposalCard(proposal){
    const card=document.createElement("section");
    card.className="assistant-action-card";
    card.setAttribute("aria-label","Ação aguardando sua confirmação");
    const eyebrow=document.createElement("p");
    eyebrow.className="eyebrow";
    eyebrow.textContent="AÇÃO SUGERIDA · AINDA NÃO EXECUTADA";
    const heading=document.createElement("h3");
    heading.textContent=proposal.label;
    const title=document.createElement("strong");
    title.textContent=proposal.title;
    const detail=document.createElement("p");
    detail.className="muted small";
    const priorities={low:"Baixa",medium:"Média",high:"Alta"};
    const categories={study:"Estudos",work:"Trabalho",personal:"Pessoal",health:"Saúde",other:"Outros"};
    if(proposal.type==="create_task"){
      detail.textContent=`${proposal.dueDate?`Prazo: ${proposal.dueDate}`:"Sem data limite"} · Prioridade: ${priorities[proposal.priority]||"Média"}`;
    }else{
      const format=value=>new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(new Date(value));
      detail.textContent=`${format(proposal.startsAt)} até ${format(proposal.endsAt)} · ${categories[proposal.category]||"Pessoal"}`;
    }
    const note=document.createElement("p");
    note.className="muted small";
    note.textContent=proposal.notes||"Revise os dados antes de confirmar. A proposta expira em 15 minutos.";
    const actions=document.createElement("div");
    actions.className="assistant-action-buttons";
    const reject=document.createElement("button");
    reject.type="button";
    reject.className="btn btn-soft";
    reject.textContent="Cancelar";
    const confirm=document.createElement("button");
    confirm.type="button";
    confirm.className="btn btn-primary";
    confirm.textContent="Confirmar e salvar";
    const feedback=document.createElement("p");
    feedback.className="assistant-action-feedback muted small";
    feedback.setAttribute("role","status");
    actions.append(reject,confirm);
    card.append(eyebrow,heading,title,detail,note,actions,feedback);
    chat.appendChild(card);
    chat.scrollTop=chat.scrollHeight;
    const decide=async decision=>{
      if(busy)return;
      busy=true;
      confirm.disabled=true;
      reject.disabled=true;
      feedback.textContent=decision==="confirm"?"Salvando no Pattern...":"Cancelando proposta...";
      try{
        const result=await jsonRequest(`/api/assistant/proposals/${encodeURIComponent(proposal.id)}`,{
          method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision})
        });
        if(result.status==="executed"){
          feedback.textContent="Salvo com sucesso no Pattern.";
          const link=document.createElement("a");
          link.href=result.created.href;
          link.className="subtle-link";
          link.textContent=result.created.href==="/calendar"?"Ver no calendário":"Ver nas tarefas";
          card.append(link);
          history.push({role:"assistant",content:`Ação confirmada pelo usuário: ${result.created.title} salva com sucesso.`});
        }else feedback.textContent="Proposta cancelada. Nenhuma alteração foi feita.";
        card.dataset.finished="true";
        status.textContent=feedback.textContent;
      }catch(error){
        feedback.textContent=error.message;
        if(!/expirou|já foi|não encontrada/.test(error.message)){
          confirm.disabled=false;reject.disabled=false;
        }
      }finally{busy=false;}
    };
    confirm.addEventListener("click",()=>decide("confirm"));
    reject.addEventListener("click",()=>decide("reject"));
  }

  async function check(){
    try{
      const data=await jsonRequest("/api/assistant/status");
      model.textContent=data.available?`IA configurada · ${data.model}`:"IA não configurada";
      send.disabled=!data.available;
      status.textContent=data.available?"A IA pode responder e propor ações. Nenhuma alteração acontece sem sua confirmação.":"Para ativar as respostas, configure OPENAI_API_KEY no .env e reinicie o Node.js.";
    }catch(error){model.textContent="IA indisponível";send.disabled=true;status.textContent=error.message;}
  }

  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(busy||send.disabled)return;
    const message=question.value.trim();
    if(message.length<2)return;
    busy=true;send.disabled=true;
    status.textContent="A IA está pensando na resposta...";
    bubble("user",message);
    question.value="";
    try{
      const data=await jsonRequest("/api/assistant/chat",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({message,includeContext:consent.checked,history:history.slice(-6)})
      });
      bubble("ai",data.answer);
      history.push({role:"user",content:message},{role:"assistant",content:data.answer.slice(0,1200)});
      if(history.length>6)history.splice(0,history.length-6);
      if(data.proposal)proposalCard(data.proposal);
      status.textContent=data.proposal?"A IA preparou uma ação que precisa da sua confirmação.":data.usedContext?"Resposta com resumo autorizado da rotina.":"Resposta sem consultar os registros da sua conta.";
    }catch(error){bubble("ai",error.message);status.textContent="A pergunta não foi respondida. Você pode tentar novamente.";question.value=message;}
    finally{busy=false;send.disabled=false;question.focus();}
  });

  document.querySelectorAll("[data-assistant-prompt]").forEach(button=>button.addEventListener("click",()=>{
    question.value=button.dataset.assistantPrompt;
    question.focus();
  }));
  check();
})();
