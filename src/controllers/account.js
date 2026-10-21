"use strict";
const {z}=require("zod");
const bcrypt=require("bcryptjs");
const {validate}=require("../middleware/api");
const {createToken,normalizeEmail}=require("../services/account-security");
const {sendAccountEmail}=require("../services/email");
const {clearCookie}=require("../middleware/auth");
const email=z.string().trim().email().max(254).transform(normalizeEmail);
const password=z.string().min(10,"Use pelo menos 10 caracteres.").max(72);

module.exports=function createAccountController(db){
  async function profile(req,res){
    const {rows}=await db.query(`SELECT name,email,email_verified_at AS "emailVerifiedAt",pending_email AS "pendingEmail",created_at AS "createdAt" FROM users WHERE id=$1`,[req.user.id]);
    if(!rows[0])return res.status(404).json({error:"Conta não encontrada."});
    res.set("Cache-Control","no-store").json(rows[0]);
  }
  async function updateName(req,res){
    const body=validate(z.object({name:z.string().trim().min(2).max(80)}).strict(),req,res);
    if(!body)return;
    const {rows}=await db.query("UPDATE users SET name=$1 WHERE id=$2 RETURNING name",[body.name,req.user.id]);
    res.json({ok:true,name:rows[0].name});
  }
  async function changePassword(req,res){
    const body=validate(z.object({currentPassword:z.string(),newPassword:password}).strict(),req,res);
    if(!body)return;
    if(body.currentPassword===body.newPassword)return res.status(400).json({error:"Escolha uma senha diferente da atual."});
    const {rows}=await db.query("SELECT password_hash FROM users WHERE id=$1",[req.user.id]);
    if(!rows[0]||!(await bcrypt.compare(body.currentPassword,rows[0].password_hash)))return res.status(400).json({error:"A senha atual está incorreta."});
    const hash=await bcrypt.hash(body.newPassword,12);
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2",[hash,req.user.id]);
      await client.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL",[req.user.id,req.user.sid]);
      await client.query("UPDATE auth_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL",[req.user.id]);
      await client.query("COMMIT");
      res.json({ok:true,message:"Senha alterada. As outras sessões foram encerradas."});
    }catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  }
  async function changeEmail(req,res){
    const body=validate(z.object({email,currentPassword:z.string()}).strict(),req,res);
    if(!body)return;
    const {rows}=await db.query("SELECT email,password_hash FROM users WHERE id=$1",[req.user.id]);
    if(!rows[0]||!(await bcrypt.compare(body.currentPassword,rows[0].password_hash)))return res.status(400).json({error:"A senha atual está incorreta."});
    if(body.email===rows[0].email)return res.status(400).json({error:"Informe um e-mail diferente do atual."});
    const duplicate=await db.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2",[body.email,req.user.id]);
    if(duplicate.rowCount)return res.status(409).json({error:"Este e-mail já pertence a uma conta."});
    await db.query("UPDATE users SET pending_email=$1 WHERE id=$2",[body.email,req.user.id]);
    const token=await createToken(db,req.user.id,"change_email",body.email);
    let sent=false;
    try{sent=await sendAccountEmail(body.email,"change_email",token);}
    catch(error){console.error("Falha ao enviar confirmação de novo e-mail:",error.message);}
    res.json({ok:true,emailSent:sent,message:sent?"Enviamos um link ao novo endereço. O e-mail atual permanece válido até confirmar.":"Novo e-mail pendente. Não foi possível enviar a confirmação; verifique a configuração do serviço de e-mail."});
  }
  async function sessions(req,res){
    const {rows}=await db.query(`SELECT id,user_agent AS "userAgent",created_at AS "createdAt",last_seen_at AS "lastSeenAt",expires_at AS "expiresAt" FROM auth_sessions
      WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC`,[req.user.id]);
    res.set("Cache-Control","no-store").json(rows.map(row=>({...row,current:row.id===req.user.sid})));
  }
  async function revokeSession(req,res){
    const id=z.string().uuid().safeParse(req.params.id);
    if(!id.success)return res.status(400).json({error:"Sessão inválida."});
    const {rowCount}=await db.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",[id.data,req.user.id]);
    if(!rowCount)return res.status(404).json({error:"Sessão não encontrada."});
    if(id.data===req.user.sid)clearCookie(res);
    res.json({ok:true,current:id.data===req.user.sid});
  }
  async function revokeOthers(req,res){
    const {rowCount}=await db.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL",[req.user.id,req.user.sid]);
    res.json({ok:true,ended:rowCount});
  }
  return{profile,updateName,changePassword,changeEmail,sessions,revokeSession,revokeOthers};
};
