"use strict";
const baseUrl=()=>String(process.env.APP_BASE_URL||"http://localhost:3000").replace(/\/$/,"");
const configured=()=>Boolean(process.env.RESEND_API_KEY&&process.env.MAIL_FROM&&process.env.APP_BASE_URL);
const links={verify_email:"verify-email",reset_password:"reset-password",change_email:"verify-email"};
const emailLink=(purpose,token)=>`${baseUrl()}/${links[purpose]}?token=${encodeURIComponent(token)}${purpose==="change_email"?"&purpose=change_email":""}`;

async function sendAccountEmail(address,purpose,token){
  if(!configured())return false;
  const link=emailLink(purpose,token);
  const isReset=purpose==="reset_password";
  const subject=isReset?"Pattern — redefinir senha":purpose==="change_email"?"Pattern — confirmar novo e-mail":"Pattern — confirmar seu e-mail";
  const message=isReset?"Para redefinir sua senha":"Para confirmar seu endereço de e-mail";
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({from:process.env.MAIL_FROM,to:[address],subject,text:`${message}, acesse o link abaixo:\n\n${link}\n\nSe você não solicitou, ignore esta mensagem. O link tem prazo de validade.`}),
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error(`Falha no provedor de e-mail (${response.status}).`);
  return true;
}
module.exports={sendAccountEmail,emailLink,configured};
