"use strict";
const {z}=require("zod");
const {randomUUID}=require("node:crypto");
const {taskSchema,taskColumns}=require("../validation/tasks");
const {dateString,recurringDates}=require("../validation/common");
const {addDays,localDate}=require("../../recurrence-utils");
const {validate}=require("../middleware/api");

module.exports = function createTasksController(db) {
const list = async(req,res)=>{
  const listMode=req.query.list==='1';
  const query=listMode?{}:req.query;
  const range = z.object({from:dateString,to:dateString}).strict().safeParse(query);
  if (Object.keys(query).length && !range.success) return res.status(400).json({error:'Período inválido.'});
  const today=localDate(new Date());
  const from=range.success?range.data.from:addDays(today,listMode?0:-4);
  const to=range.success?range.data.to:addDays(today,listMode?65:15);
  if(from>to || (Date.parse(to)-Date.parse(from))>70*86400000)
    return res.status(400).json({error:'Selecione até 70 dias.'});
  const rows=(await db.query(`SELECT ${taskColumns} FROM tasks WHERE user_id=$1 ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC LIMIT 500`,[req.user.id])).rows;
  const series=rows.filter(t=>t.repeat!=='none');
  const simple=rows.filter(t=>t.repeat==='none').map(t=>({...t,isRecurring:false}));
  if(!series.length) return res.json(simple);
  const ids=series.map(t=>t.id);
  const entries=(await db.query(`SELECT task_id AS id,to_char(occurrence_date,'YYYY-MM-DD') AS date,completed,cancelled FROM task_occurrences WHERE task_id=ANY($1::uuid[]) AND occurrence_date BETWEEN $2 AND $3`,[ids,from,to])).rows;
  const byKey=new Map(entries.map(e=>[`${e.id}@${e.date}`,e]));
  const generated=[];
  for(const t of series){
    for(const date of recurringDates(t,t.dueDate,from,to)){
      const id=`${t.id}@${date}`; const entry=byKey.get(id);
      if(entry?.cancelled) continue;
      generated.push({...t,id,seriesId:t.id,occurrenceDate:date,seriesDueDate:t.dueDate,dueDate:date,completed:entry?.completed??false,isRecurring:true});
      if(generated.length>=1200) break;
    }
    if(generated.length>=1200) break;
  }
  if(listMode){
    const nearest=new Map();
    for(const item of generated){
      const current=nearest.get(item.seriesId);
      if(!current || ((current.completed && !item.completed) || (current.completed===item.completed && item.dueDate<current.dueDate)))
        nearest.set(item.seriesId,item);
    }
    return res.json([...simple,...nearest.values()]);
  }
  return res.json([...simple,...generated]);
};
const toggleOccurrence = async(req,res)=>{
  const date=dateString.safeParse(req.params.date);
  if(!date.success) return res.status(400).json({error:'Data inválida.'});
  const found=(await db.query(`SELECT to_char(due_date,'YYYY-MM-DD') AS start,recurrence_type AS "repeat",recurrence_days AS "repeatDays",to_char(recurrence_until,'YYYY-MM-DD') AS "repeatUntil" FROM tasks WHERE id=$1 AND user_id=$2`,[req.params.id,req.user.id])).rows[0];
  if(!found || found.repeat==='none' || !recurringDates(found,found.start,date.data,date.data).length) return res.status(404).json({error:'Ocorrência não encontrada.'});
  const row=(await db.query(`INSERT INTO task_occurrences(task_id,occurrence_date,completed,completed_at) VALUES($1,$2,TRUE,NOW()) ON CONFLICT(task_id,occurrence_date) DO UPDATE SET completed=NOT task_occurrences.completed,completed_at=CASE WHEN NOT task_occurrences.completed THEN NOW() ELSE NULL END RETURNING completed`,[req.params.id,date.data])).rows[0];
  res.json({completed:row.completed});
};
const cancelOccurrence = async(req,res)=>{
  const date=dateString.safeParse(req.params.date);
  if(!date.success) return res.status(400).json({error:'Data inválida.'});
  const found=(await db.query("SELECT id FROM tasks WHERE id=$1 AND user_id=$2 AND recurrence_type<>'none'",[req.params.id,req.user.id])).rowCount;
  if(!found) return res.status(404).json({error:'Série não encontrada.'});
  await db.query(`INSERT INTO task_occurrences(task_id,occurrence_date,cancelled) VALUES($1,$2,TRUE) ON CONFLICT(task_id,occurrence_date) DO UPDATE SET cancelled=TRUE`,[req.params.id,date.data]);
  res.json({ok:true});
};
const create = async (req, res) => {
    const body = validate(taskSchema, req, res);
    if (!body) return;
    const { rows } = await db.query(
      `INSERT INTO tasks(id,user_id,title,notes,due_date,priority,recurrence_type,recurrence_days,recurrence_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${taskColumns}`,
      [
        randomUUID(),
        req.user.id,
        body.title,
        body.notes,
        body.dueDate,
        body.priority,body.repeat,body.repeatDays,body.repeatUntil,
      ],
    );
    res.status(201).json(rows[0]);
  };
const update = async (req, res) => {
    const body = validate(taskSchema, req, res);
    if (!body) return;
    const { rows } = await db.query(
      `UPDATE tasks SET title=$1,notes=$2,due_date=$3,priority=$4,recurrence_type=$5,recurrence_days=$6,recurrence_until=$7,updated_at=NOW() WHERE id=$8 AND user_id=$9 RETURNING ${taskColumns}`,
      [
        body.title,
        body.notes,
        body.dueDate,
        body.priority,body.repeat,body.repeatDays,body.repeatUntil,
        req.params.id,
        req.user.id,
      ],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Tarefa não encontrada." });
    res.json(rows[0]);
  };
const changeDate = async (req, res) => {
    const body = validate(
      z.object({ dueDate: dateString.nullable() }).strict(),
      req,
      res,
    );
    if (!body) return;
    const { rows } = await db.query(
      `UPDATE tasks SET due_date=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING ${taskColumns}`,
      [body.dueDate, req.params.id, req.user.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Tarefa não encontrada." });
    res.json(rows[0]);
  };
const toggle = async (req, res) => {
    const { rows } = await db.query(
      `UPDATE tasks SET completed=NOT completed, completed_at=CASE WHEN completed THEN NULL ELSE NOW() END, updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING ${taskColumns}`,
      [req.params.id, req.user.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Tarefa não encontrada." });
    res.json(rows[0]);
  };
const remove = async (req, res) => {
    const result = await db.query(
      "DELETE FROM tasks WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Tarefa não encontrada." });
    res.json({ ok: true });
  };
return {list,toggleOccurrence,cancelOccurrence,create,update,changeDate,toggle,remove};
};
