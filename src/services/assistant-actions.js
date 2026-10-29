"use strict";
const {randomUUID}=require("node:crypto");
const {z}=require("zod");
const {dateString}=require("../validation/common");
const createEventService=require("./events");

const taskArguments=z.object({
  title:z.string().trim().min(1).max(160),
  due_date:dateString.nullable(),
  priority:z.enum(["low","medium","high"]),
  notes:z.string().max(1000).nullable()
}).strict();
const eventArguments=z.object({
  title:z.string().trim().min(1).max(160),
  starts_at:z.string().datetime({offset:true}),
  ends_at:z.string().datetime({offset:true}),
  category:z.enum(["study","work","personal","health","other"]),
  notes:z.string().max(1000).nullable()
}).strict();
const allowed={create_task:taskArguments,create_event:eventArguments};
const tools=[
  {
    type:"function",name:"create_task",strict:true,
    description:"Proponha criar uma tarefa não recorrente quando a pessoa pedir explicitamente uma tarefa. Nunca execute: a pessoa confirma na interface.",
    parameters:{type:"object",additionalProperties:false,properties:{
      title:{type:"string",description:"Nome da tarefa, máximo de 160 caracteres"},
      due_date:{type:["string","null"],description:"Data YYYY-MM-DD ou null quando não informada"},
      priority:{type:"string",enum:["low","medium","high"],description:"Prioridade; use medium quando não informada"},
      notes:{type:["string","null"],description:"Observações opcionais, até 1000 caracteres"}
    },required:["title","due_date","priority","notes"]}
  },
  {
    type:"function",name:"create_event",strict:true,
    description:"Proponha criar um compromisso de horário específico, não recorrente, quando a pessoa informar dia e horário suficiente; pergunte se faltar informação. Use America/Sao_Paulo (offset -03:00 quando aplicável). Nunca execute: a pessoa confirma na interface.",
    parameters:{type:"object",additionalProperties:false,properties:{
      title:{type:"string",description:"Nome do compromisso, máximo 160 caracteres"},
      starts_at:{type:"string",description:"Início RFC3339 com fuso horário explícito"},
      ends_at:{type:"string",description:"Término RFC3339 com fuso horário explícito"},
      category:{type:"string",enum:["study","work","personal","health","other"],description:"Bloco do calendário"},
      notes:{type:["string","null"],description:"Observações opcionais, até 1000 caracteres"}
    },required:["title","starts_at","ends_at","category","notes"]}
  }
];

class ActionError extends Error{
  constructor(message,status=400){super(message);this.status=status;}
}
function normalizedAction(name,raw){
  const schema=allowed[name];
  if(!schema)throw new ActionError("A IA sugeriu uma ação não disponível.");
  let parsed;
  try{parsed=typeof raw==="string"?JSON.parse(raw):raw;}catch(_){throw new ActionError("A IA retornou parâmetros inválidos.");}
  const result=schema.safeParse(parsed);
  if(!result.success)throw new ActionError("A IA sugeriu dados inválidos. Peça novamente com mais detalhes.");
  if(name==="create_event"){
    const start=Date.parse(result.data.starts_at);
    const end=Date.parse(result.data.ends_at);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>12*3600000){
      throw new ActionError("O horário do compromisso é inválido ou excede 12 horas.");
    }
    if(start<Date.now()-5*60000||start>Date.now()+366*86400000){
      throw new ActionError("Escolha um horário futuro, dentro de um ano.");
    }
  }
  return {type:name,args:result.data};
}
function details(action){
  const args=action.args;
  if(action.type==="create_task")return {type:action.type,label:"Criar tarefa",title:args.title,notes:args.notes||"",priority:args.priority,dueDate:args.due_date};
  return {type:action.type,label:"Criar compromisso",title:args.title,notes:args.notes||"",category:args.category,startsAt:args.starts_at,endsAt:args.ends_at};
}
async function saveProposal(db,userId,action){
  const id=randomUUID();
  await db.query("DELETE FROM ai_action_proposals WHERE user_id=$1 AND expires_at<NOW()-INTERVAL '1 day'",[userId]);
  await db.query("INSERT INTO ai_action_proposals(id,user_id,action_type,arguments,expires_at) VALUES($1,$2,$3,$4::jsonb,NOW()+INTERVAL '15 minutes')",[id,userId,action.type,JSON.stringify(action.args)]);
  return {id,...details(action),expiresInMinutes:15};
}
async function decideProposal(db,userId,id,decision){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const row=(await client.query("SELECT action_type,arguments,status,expires_at FROM ai_action_proposals WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,userId])).rows[0];
    if(!row){throw new ActionError("Proposta não encontrada na sua conta.",404);}
    if(row.status!=="pending")throw new ActionError("Esta proposta já foi utilizada ou descartada.",409);
    if(new Date(row.expires_at).getTime()<=Date.now())throw new ActionError("A proposta expirou. Peça uma nova sugestão.",409);
    if(decision==="reject"){
      await client.query("UPDATE ai_action_proposals SET status='rejected',decided_at=NOW() WHERE id=$1 AND user_id=$2",[id,userId]);
      await client.query("COMMIT");
      return {status:"rejected"};
    }
    const action=normalizedAction(row.action_type,row.arguments);
    let created;
    if(action.type==="create_task"){
      const {args}=action;const newId=randomUUID();
      const result=await client.query("INSERT INTO tasks(id,user_id,title,notes,due_date,priority,recurrence_type,recurrence_days) VALUES($1,$2,$3,$4,$5,$6,'none','{}'::smallint[]) RETURNING id,title,to_char(due_date,'YYYY-MM-DD') AS \"dueDate\"",[newId,userId,args.title,args.notes||"",args.due_date,args.priority]);
      created={id:result.rows[0].id,title:result.rows[0].title,href:"/tasks"};
    }else{
      const {args}=action;
      const category=(await client.query("SELECT id,legacy_key FROM event_categories WHERE user_id=$1 AND legacy_key=$2 LIMIT 1",[userId,args.category])).rows[0];
      if(!category)throw new ActionError("O bloco escolhido não existe mais. Crie a proposta novamente.",409);
      const existing=await createEventService(client).fetchEvents(userId,args.starts_at,args.ends_at);
      if(existing.some(item=>new Date(item.startsAt)<new Date(args.ends_at)&&new Date(item.endsAt)>new Date(args.starts_at))){
        throw new ActionError("Esse horário está ocupado. Revise o calendário e peça outra sugestão.",409);
      }
      const newId=randomUUID();
      await client.query("INSERT INTO events(id,user_id,title,starts_at,ends_at,notes,category,category_id,recurrence_type,recurrence_days,time_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'none','{}'::smallint[],'exact')",[newId,userId,args.title,args.starts_at,args.ends_at,args.notes||"",category.legacy_key||"other",category.id]);
      created={id:newId,title:args.title,href:"/calendar"};
    }
    await client.query("UPDATE ai_action_proposals SET status='executed',decided_at=NOW(),created_id=$3 WHERE id=$1 AND user_id=$2",[id,userId,created.id]);
    await client.query("COMMIT");
    return {status:"executed",created};
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
module.exports={tools,ActionError,normalizedAction,details,saveProposal,decideProposal};
