"use strict";
const form=document.querySelector("#authForm");
const params=new URLSearchParams(window.location.search);
const mode=form?.dataset.mode;
const notify=(element,message)=>{element.textContent=message;element.hidden=false;};
async function request(path,body){
  let response;
  try{
    response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  }catch(error){
    throw new Error("Não foi possível conectar ao servidor. Verifique sua conexão e se o Node.js está em execução.");
  }
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.error||`Não foi possível concluir a ação (HTTP ${response.status}). Confira o terminal do Node.js.`);
  if(!data)throw new Error("O servidor retornou uma resposta inesperada. Confira o terminal do Node.js.");
  return data;
}
if(form){
  if(mode==="reset")form.elements.token.value=params.get("token")||"";
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const error=document.querySelector("#formError");
    const success=document.querySelector("#formSuccess");
    const button=document.querySelector("#submitButton");
    error.hidden=true;success.hidden=true;button.disabled=true;
    const body=Object.fromEntries(new FormData(form));
    const paths={login:"/api/auth/login",register:"/api/auth/register",forgot:"/api/auth/forgot-password",reset:"/api/auth/reset-password"};
    try{
      const result=await request(paths[mode],body);
      if(mode==="login"||mode==="register")window.location.assign(mode==="register"?"/settings":"/app");
      else{
        notify(success,result.message||"Solicitação realizada.");
        if(mode==="reset"){button.hidden=true;form.elements.password.value="";}
      }
    }catch(error){notify(document.querySelector("#formError"),error.message);}
    finally{button.disabled=false;}
  });
}
if(document.querySelector("#verifyStatus")){
  const status=document.querySelector("#verifyStatus");
  const button=document.querySelector("#verifyButton");
  async function verify(){
    const token=params.get("token");
    if(!token){notify(status,"Link incompleto. Solicite um novo e-mail nas configurações.");return;}
    const endpoint=params.get("purpose")==="change_email"?"/api/auth/confirm-new-email":"/api/auth/verify-email";
    try{
      const result=await request(endpoint,{token});
      notify(status,result.message+" Você pode entrar no Pattern.");
      button.hidden=true;
      window.history.replaceState({},"",window.location.pathname);
    }catch(error){notify(status,error.message);button.hidden=false;}
  }
  button.addEventListener("click",verify);
  verify();
}
