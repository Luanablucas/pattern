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

  async function check(){
    try{
      const data=await jsonRequest("/api/assistant/status");
      model.textContent=data.available?`IA configurada · ${data.model}`:"IA não configurada";
      send.disabled=!data.available;
      status.textContent=data.available?"A chave está configurada. Envie uma pergunta para testar a conexão com a IA.":"Para ativar as respostas, configure OPENAI_API_KEY no .env e reinicie o Node.js.";
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
      status.textContent=data.usedContext?"Resposta com resumo autorizado da rotina.":"Resposta sem consultar os registros da sua conta.";
    }catch(error){bubble("ai",error.message);status.textContent="A pergunta não foi respondida. Você pode tentar novamente.";question.value=message;}
    finally{busy=false;send.disabled=false;question.focus();}
  });

  document.querySelectorAll("[data-assistant-prompt]").forEach(button=>button.addEventListener("click",()=>{
    question.value=button.dataset.assistantPrompt;
    question.focus();
  }));
  check();
})();
