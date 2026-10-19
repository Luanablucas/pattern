"use strict";
const {z}=require("zod");
const {randomUUID}=require("node:crypto");
const {dateString}=require("../validation/common");
const {eventSchema,eventQueryBase,eventRangeSchema}=require("../validation/events");
const {validate}=require("../middleware/api");
const createEventService=require("../services/events");

module.exports = function createEventsController(db) {
const {ownedCategory,fetchEvents}=createEventService(db);
const list = async(req,res)=>{
  if(Object.keys(req.query).length){
    const parsed=eventRangeSchema.safeParse(req.query);
    if(!parsed.success)return res.status(400).json({error:'Período do calendário inválido.'});
    const from=new Date(parsed.data.from),to=new Date(parsed.data.to);
    if(to<=from || to-from>70*86400000)return res.status(400).json({error:'Informe um intervalo de até 70 dias.'});
    return res.json(await fetchEvents(req.user.id,from.toISOString(),to.toISOString()));
  }
  const from=new Date();from.setDate(from.getDate()-1);
  const to=new Date();to.setDate(to.getDate()+10);
  res.json(await fetchEvents(req.user.id,from.toISOString(),to.toISOString()));
};
const create = async(req,res)=>{
  const b=validate(eventSchema,req,res);if(!b)return;
  const category=await ownedCategory(b.categoryId,req.user.id);
  if(!category)return res.status(400).json({error:'Bloco inválido.'});
  const id=randomUUID();
  await db.query(`INSERT INTO events(id,user_id,title,starts_at,ends_at,notes,category,category_id,recurrence_type,recurrence_days,recurrence_until,time_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,req.user.id,b.title,b.startsAt,b.endsAt,b.notes,category.legacy_key||'other',b.categoryId,b.repeat,b.repeatDays,b.repeatUntil,b.timeMode]);
  const row=(await db.query(`${eventQueryBase} WHERE e.id=$1 AND e.user_id=$2`,[id,req.user.id])).rows[0];
  res.status(201).json(row);
};
const update = async(req,res)=>{
  const b=validate(eventSchema,req,res);if(!b)return;
  const category=await ownedCategory(b.categoryId,req.user.id);
  if(!category)return res.status(400).json({error:'Bloco inválido.'});
  const updated=await db.query(`UPDATE events SET title=$1,starts_at=$2,ends_at=$3,notes=$4,category=$5,category_id=$6,recurrence_type=$7,recurrence_days=$8,recurrence_until=$9,time_mode=$10 WHERE id=$11 AND user_id=$12`,[b.title,b.startsAt,b.endsAt,b.notes,category.legacy_key||'other',b.categoryId,b.repeat,b.repeatDays,b.repeatUntil,b.timeMode,req.params.id,req.user.id]);
  if(!updated.rowCount)return res.status(404).json({error:'Compromisso não encontrado.'});
  res.json((await db.query(`${eventQueryBase} WHERE e.id=$1 AND e.user_id=$2`,[req.params.id,req.user.id])).rows[0]);
};
const cancelOccurrence = async(req,res)=>{
  const date=dateString.safeParse(req.params.date);
  if(!date.success)return res.status(400).json({error:'Data inválida.'});
  const found=(await db.query(`SELECT e.id FROM events e WHERE e.id=$1 AND e.user_id=$2 AND e.recurrence_type<>'none'`,[req.params.id,req.user.id])).rowCount;
  if(!found)return res.status(404).json({error:'Série não encontrada.'});
  await db.query('INSERT INTO event_cancellations(event_id,occurrence_date) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,date.data]);
  res.json({ok:true});
};
const remove = async(req,res)=>{
  const result=await db.query('DELETE FROM events WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
  if(!result.rowCount)return res.status(404).json({error:'Compromisso não encontrado.'});
  res.json({ok:true});
};
return {list,create,update,cancelOccurrence,remove};
};
