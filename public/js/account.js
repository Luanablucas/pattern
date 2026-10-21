"use strict";
const $=id=>document.getElementById(id);
const notice=(message,isError=false)=>{
  const el=$("accountStatus");el.textContent=message;el.classList.toggle("account-error",isError);
};
const esc=value=>String(value||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
async function api(url,{method="GET",body}={}){
  const response=await fetch(url,{method,headers:body!==undefined?{"content-type":"application/json"}:{},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(response.status===401){window.location.assign("/login");throw new Error("Sua sessão terminou.");}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"Não foi possível concluir a operação.");
  return data;
}
async function loadProfile(){
  const profile=await api("/api/account");
  $("accountNameForm").elements.name.value=profile.name;
  $("accountEmail").textContent=profile.email;
  $("accountVerification").textContent=profile.emailVerifiedAt?"✓ E-mail confirmado":"E-mail ainda não confirmado";
  $("resendVerification").hidden=Boolean(profile.emailVerifiedAt);
  $("pendingEmail").hidden=!profile.pendingEmail;
  if(profile.pendingEmail)$("pendingEmail").textContent=`Aguardando confirmação: ${profile.pendingEmail}`;
}
async function loadSessions(){
  const sessions=await api("/api/account/sessions");
  $("accountSessions").innerHTML=sessions.length?sessions.map(s=>`<article class="account-session"><div><strong>${esc(s.userAgent)}</strong><p class="muted small">Iniciada em ${new Date(s.createdAt).toLocaleString("pt-BR")}</p><span class="muted small">${s.current?"● Este dispositivo":"Outro dispositivo"}</span></div><button class="btn btn-soft" type="button" data-revoke="${esc(s.id)}">${s.current?"Sair deste dispositivo":"Encerrar sessão"}</button></article>`).join(""):'<p class="muted small">Nenhuma sessão ativa.</p>';
}
async function submit(formId,path,success){
  const form=$(formId);
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const data=await api(path,{method:formId==="accountNameForm"?"PATCH":"POST",body:Object.fromEntries(new FormData(form))});
      notice(data.message||success);
      if(formId==="accountPasswordForm"||formId==="accountEmailForm")form.reset();
      await Promise.all([loadProfile(),loadSessions()]);
    }catch(error){notice(error.message,true);}
    finally{button.disabled=false;}
  });
}
submit("accountNameForm","/api/account/profile","Nome atualizado com sucesso.");
submit("accountEmailForm","/api/account/change-email","Solicitação enviada.");
submit("accountPasswordForm","/api/account/change-password","Senha atualizada.");
$("resendVerification").addEventListener("click",async()=>{
  try{const result=await api("/api/auth/resend-verification",{method:"POST",body:{}});notice(result.message);}
  catch(error){notice(error.message,true);}
});
$("accountSessions").addEventListener("click",async(event)=>{
  const button=event.target.closest("[data-revoke]");if(!button)return;
  if(!window.confirm("Deseja encerrar esta sessão?"))return;
  try{
    const result=await api(`/api/account/sessions/${button.dataset.revoke}`,{method:"DELETE"});
    if(result.current){window.location.assign("/login");return;}
    notice("Sessão encerrada.");await loadSessions();
  }catch(error){notice(error.message,true);}
});
$("revokeOtherSessions").addEventListener("click",async()=>{
  if(!window.confirm("Encerrar todos os outros dispositivos?"))return;
  try{const result=await api("/api/account/sessions/revoke-others",{method:"POST",body:{}});notice(`${result.ended} sessão(ões) encerrada(s).`);await loadSessions();}
  catch(error){notice(error.message,true);}
});
Promise.all([loadProfile(),loadSessions()]).then(()=>notice("Sua conta está atualizada.")).catch(error=>notice(error.message,true));
