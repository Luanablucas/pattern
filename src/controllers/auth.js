"use strict";
const {z}=require("zod");
const bcrypt=require("bcryptjs");
const {randomUUID}=require("node:crypto");
const {safeText}=require("../validation/common");
const {validate}=require("../middleware/api");
const {issueCookie,clearCookie,getUser}=require("../middleware/auth");
const {createSession,createToken,consumeToken,normalizeEmail}=require("../services/account-security");
const {sendAccountEmail}=require("../services/email");

const email=z.string().trim().email().max(254).transform(normalizeEmail);
const password=z.string().min(10,"Use uma senha com pelo menos 10 caracteres.").max(72);
const genericReset="Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.";
const genericVerification="Se a conta precisar de confirmação, enviaremos um e-mail com as instruções.";

module.exports=function createAuthController(db){
  async function replaceBrowserSession(req,userId){
    const previous=await getUser(req,db);
    if(previous?.id===userId){
      await db.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",[previous.sid,userId]);
    }
  }
  async function deliver(address,purpose,userId,emailValue=null){
    const token=await createToken(db,userId,purpose,emailValue);
    try{return await sendAccountEmail(address,purpose,token);}
    catch(error){console.error("Falha ao enviar e-mail do Pattern:",error.message);return false;}
  }
  async function register(req,res){
    const body=validate(z.object({name:safeText(80),email,password}).strict(),req,res);
    if(!body)return;
    const user={id:randomUUID(),name:body.name,email:body.email};
    const hash=await bcrypt.hash(body.password,12);
    try{
      await db.query("INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",[user.id,user.name,user.email,hash]);
    }catch(error){
      if(error.code==="23505")return res.status(409).json({error:"Este e-mail já está cadastrado."});
      throw error;
    }
    await db.query(`INSERT INTO event_categories(id,user_id,name,color,legacy_key)
      SELECT gen_random_uuid(),$1,v.name,v.color,v.key FROM (VALUES
      ('study','Estudos','#8e77d2'),('work','Trabalho','#73a1cf'),
      ('personal','Pessoal','#d68bab'),('health','Saúde','#75aa96'),
      ('other','Outros','#d5a26b')) AS v(key,name,color) ON CONFLICT DO NOTHING`,[user.id]);
    const emailSent=await deliver(user.email,"verify_email",user.id);
    await replaceBrowserSession(req,user.id);
    const sid=await createSession(db,user,req);
    issueCookie(res,user,sid);
    res.status(201).json({ok:true,emailSent,verified:false,redirect:"/verify-pending"});
  }
  async function login(req,res){
    const body=validate(z.object({email,password:z.string()}).strict(),req,res);
    if(!body)return;
    const {rows}=await db.query("SELECT id,name,password_hash,email_verified_at FROM users WHERE email=$1",[body.email]);
    const valid=rows[0]?await bcrypt.compare(body.password,rows[0].password_hash):await bcrypt.compare(body.password,"$2a$12$8sJNJVTSyxYypqgrTvIGc.etNCJUazmfVCY2tkrwepYXXo5cfZNqS");
    if(!rows[0]||!valid)return res.status(401).json({error:"E-mail ou senha incorretos."});
    await replaceBrowserSession(req,rows[0].id);
    const sid=await createSession(db,rows[0],req);
    issueCookie(res,rows[0],sid);
    const verified=Boolean(rows[0].email_verified_at);
    res.json({ok:true,verified,redirect:verified?"/app":"/verify-pending"});
  }
  async function logout(req,res){
    await db.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2",[req.user.sid,req.user.id]);
    clearCookie(res);
    res.json({ok:true});
  }
  async function requestReset(req,res){
    const body=validate(z.object({email}).strict(),req,res);
    if(!body)return;
    const {rows}=await db.query("SELECT id,email FROM users WHERE email=$1",[body.email]);
    if(rows[0])await deliver(rows[0].email,"reset_password",rows[0].id);
    res.json({ok:true,message:genericReset});
  }
  async function resetPassword(req,res){
    const body=validate(z.object({token:z.string(),password}).strict(),req,res);
    if(!body)return;
    const hash=await bcrypt.hash(body.password,12);
    const result=await consumeToken(db,body.token,"reset_password",async(client,token)=>{
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2",[hash,token.user_id]);
      await client.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL",[token.user_id]);
      await client.query("UPDATE auth_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL",[token.user_id]);
      return true;
    });
    if(!result.ok)return res.status(400).json({error:"Link inválido ou expirado. Solicite outro."});
    clearCookie(res);
    res.json({ok:true,message:"Senha redefinida. Entre novamente."});
  }
  async function verifyEmail(req,res){
    const body=validate(z.object({token:z.string()}).strict(),req,res);
    if(!body)return;
    const previous=await getUser(req,db);
    let verifiedUser=null;
    let sid=null;
    const result=await consumeToken(db,body.token,"verify_email",async(client,token)=>{
      const {rows}=await client.query("UPDATE users SET email_verified_at=NOW() WHERE id=$1 AND email_verified_at IS NULL RETURNING id,name,email",[token.user_id]);
      if(!rows[0])return false;
      verifiedUser=rows[0];
      await client.query("UPDATE auth_tokens SET used_at=NOW() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL",[verifiedUser.id,"verify_email"]);
      if(previous?.id===verifiedUser.id){
        await client.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",[previous.sid,verifiedUser.id]);
      }
      sid=await createSession(client,verifiedUser,req);
      return true;
    });
    if(!result.ok)return res.status(400).json({error:"Link inválido ou expirado. Solicite outro."});
    issueCookie(res,verifiedUser,sid);
    res.json({ok:true,message:"E-mail confirmado com sucesso.",redirect:"/app"});
  }
  async function verifyChangedEmail(req,res){
    const body=validate(z.object({token:z.string()}).strict(),req,res);
    if(!body)return;
    try{
      const result=await consumeToken(db,body.token,"change_email",async(client,token)=>{
        const user=await client.query("SELECT id,pending_email FROM users WHERE id=$1 FOR UPDATE",[token.user_id]);
        if(!user.rows[0]||user.rows[0].pending_email!==token.email_value)return false;
        await client.query("UPDATE users SET email=$1,pending_email=NULL,email_verified_at=NOW() WHERE id=$2",[token.email_value,token.user_id]);
        await client.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1",[token.user_id]);
        return true;
      });
      if(!result.ok)return res.status(400).json({error:"Link inválido ou expirado."});
      clearCookie(res);
      res.json({ok:true,message:"E-mail atualizado. Entre com o novo endereço."});
    }catch(error){
      if(error.code==="23505")return res.status(409).json({error:"Este e-mail já pertence a outra conta."});
      throw error;
    }
  }
  async function resendVerification(req,res){
    if(req.user.email_verified_at)return res.json({ok:true,message:"Seu e-mail já está confirmado."});
    const sent=await deliver(req.user.email,"verify_email",req.user.id);
    if(!sent)return res.status(503).json({error:"Não foi possível enviar o e-mail de confirmação. Verifique o remetente e os registros do serviço de e-mail antes de tentar novamente."});
    res.json({ok:true,emailSent:true,message:"Enviamos um novo link de confirmação."});
  }
  return{register,login,logout,requestReset,resetPassword,verifyEmail,verifyChangedEmail,resendVerification};
};
