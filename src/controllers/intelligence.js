"use strict";
const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const { localDate,occurrences } = require("../../recurrence-utils");
const { validate } = require("../middleware/api");
const planner = require("../services/planning");
const createEventService = require("../services/events");
const uuid = z.string().uuid();
const categorySchema=z.object({categoryId:uuid}).strict();

module.exports=function createIntelligenceController(db){
  const {fetchEvents}=createEventService(db);
  function windowFor(period){
    return {from:new Date(`${period.start}T00:00:00-03:00`).toISOString(),to:new Date(`${period.end}T23:59:59-03:00`).toISOString()};
  }
  async function suggestionRows(user,period){
    return (await db.query(`SELECT p.id,p.task_id AS "taskId",t.title AS "taskTitle",to_char(p.occurrence_date,'YYYY-MM-DD') AS "occurrenceDate",
      p.goal_id AS "goalId",g.title AS "goalTitle",p.starts_at AS "startsAt",p.ends_at AS "endsAt",
      p.minutes,p.reason,p.status,p.event_id AS "eventId" FROM planning_suggestions p
      JOIN tasks t ON t.id=p.task_id LEFT JOIN goals g ON g.id=p.goal_id
      WHERE p.user_id=$1 AND p.starts_at>=$2::timestamptz AND p.starts_at<$3::timestamptz
      ORDER BY p.starts_at,p.created_at`,[user,`${period.start}T00:00:00-03:00`,`${period.end}T23:59:59-03:00`])).rows;
  }
  async function summary(user,period){
    const [rows,cat,focus]=await Promise.all([
      suggestionRows(user,period),
      db.query(`SELECT id,name,color FROM event_categories WHERE user_id=$1 ORDER BY lower(name)`,[user]),
      db.query(`SELECT COUNT(*)::int AS samples FROM focus_sessions WHERE user_id=$1 AND status='completed' AND finished_at>=NOW()-INTERVAL '90 days'`,[user])
    ]);
    return {period,suggestions:rows,categories:cat.rows,historySamples:focus.rows[0]?.samples||0,
      method:"Sugestões baseadas em prioridade, prazos, objetivos, horários livres e sessões de foco registradas. Nada é agendado sem aprovação."};
  }
  const list=async(req,res)=>res.json(await summary(req.user.id,planner.nextWeek()));
  const generate=async(req,res)=>{
    const user=req.user.id,period=planner.nextWeek();
    const window=windowFor(period);
    const [tasks,records,links,focus,previous]=await Promise.all([
      db.query(`SELECT id,title,priority,completed,to_char(due_date,'YYYY-MM-DD') AS "dueDate",recurrence_type AS repeat,
        recurrence_days AS "repeatDays",to_char(recurrence_until,'YYYY-MM-DD') AS "repeatUntil"
        FROM tasks WHERE user_id=$1 AND (completed=FALSE OR recurrence_type<>'none') ORDER BY created_at DESC LIMIT 300`,[user]),
      db.query(`SELECT o.task_id AS id,to_char(o.occurrence_date,'YYYY-MM-DD') AS date,o.completed,o.cancelled
        FROM task_occurrences o JOIN tasks t ON t.id=o.task_id
        WHERE t.user_id=$1 AND o.occurrence_date BETWEEN $2::date AND $3::date`,[user,period.start,period.end]),
      db.query(`SELECT l.task_id AS "taskId",g.id,g.title,g.priority,g.status,to_char(g.due_date,'YYYY-MM-DD') AS "dueDate"
        FROM goal_task_links l JOIN goals g ON g.id=l.goal_id WHERE g.user_id=$1`,[user]),
      db.query(`SELECT task_id AS "taskId",elapsed_seconds AS seconds,
        EXTRACT(HOUR FROM started_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour
        FROM focus_sessions WHERE user_id=$1 AND status='completed' AND finished_at>=NOW()-INTERVAL '90 days'
        ORDER BY finished_at DESC LIMIT 1200`,[user]),
      suggestionRows(user,period)
    ]);
    const events=await fetchEvents(user,window.from,window.to);
    let rankedHours=null;
    let analysisSource="Regras locais";
    if(focus.rows.length>=5){
      try{
        const response=await fetch(`${process.env.PYTHON_API_URL||"http://127.0.0.1:8001"}/planning-patterns`,{
          method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({sessions:focus.rows.map(x=>({hour:Number(x.hour),seconds:Number(x.seconds)}))}),
          signal:AbortSignal.timeout(2200)
        });
        if(response.ok){
          const data=await response.json();
          if(data.sampleCount>=5&&Array.isArray(data.preferredHours)&&data.preferredHours.every(h=>Number.isInteger(h)&&h>=8&&h<=19)){
            rankedHours=[...new Set([...data.preferredHours,9,10,14,15,16,17])];
            analysisSource="Python + Pandas";
          }
        }
      }catch(_){}
    }
    const existing=previous.filter(s=>s.status!=="dismissed");
    const candidates=planner.plan(tasks.rows.filter(t=>t.repeat==="none"),tasks.rows.filter(t=>t.repeat!=="none"),
      records.rows,links.rows,focus.rows,events,existing,period,Math.max(0,6-existing.length),rankedHours);
    let added=0;
    for(const item of candidates){
      const inserted=await db.query(`INSERT INTO planning_suggestions(id,user_id,task_id,occurrence_date,goal_id,starts_at,ends_at,minutes,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,[
        randomUUID(),user,item.taskId,item.occurrenceDate,item.goalId,item.startsAt,item.endsAt,item.minutes,item.reason]);
      added+=inserted.rowCount;
    }
    res.json({...await summary(user,period),added,analysisSource});
  };
  const dismiss=async(req,res)=>{
    const done=await db.query(`UPDATE planning_suggestions SET status='dismissed',updated_at=NOW()
      WHERE id=$1 AND user_id=$2 AND status='proposed' RETURNING id`,[req.params.id,req.user.id]);
    if(!done.rowCount)return res.status(404).json({error:"Sugestão não encontrada ou já decidida."});
    res.json({ok:true});
  };
  const accept=async(req,res)=>{
    const body=validate(categorySchema,req,res);
    if(!body)return;
    const user=req.user.id;
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[user]);
      const row=(await client.query(`SELECT p.id,p.task_id,to_char(p.occurrence_date,'YYYY-MM-DD') AS occurrence_date,p.starts_at,p.ends_at,p.minutes,p.status,
        t.title,t.completed,t.recurrence_type,t.recurrence_days,
        to_char(t.due_date,'YYYY-MM-DD') AS "taskStart",to_char(t.recurrence_until,'YYYY-MM-DD') AS "taskUntil"
        FROM planning_suggestions p
        JOIN tasks t ON t.id=p.task_id AND t.user_id=p.user_id
        WHERE p.id=$1 AND p.user_id=$2 FOR UPDATE OF p`,[req.params.id,user])).rows[0];
      if(!row||row.status!=="proposed"){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"Essa sugestão já foi utilizada ou não está disponível."});
      }
      const period=planner.nextWeek();
      const date=localDate(row.starts_at);
      if(date<period.start||date>period.end||new Date(row.starts_at)<=new Date()){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"Essa sugestão está desatualizada. Gere uma nova."});
      }
      if(row.recurrence_type==="none"&&row.completed){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"A tarefa já foi concluída."});
      }
      if(Boolean(row.occurrence_date)!==(row.recurrence_type!=="none") ||
        (row.occurrence_date&&occurrences({
          start:row.taskStart,until:row.taskUntil,type:row.recurrence_type,days:row.recurrence_days||[],
          from:row.occurrence_date,to:row.occurrence_date
        }).length!==1)){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"A tarefa recorrente foi modificada. Gere um novo planejamento."});
      }
      if(row.occurrence_date){
        const mark=(await client.query("SELECT completed,cancelled FROM task_occurrences WHERE task_id=$1 AND occurrence_date=$2",[row.task_id,row.occurrence_date])).rows[0];
        if(mark?.completed||mark?.cancelled){
          await client.query("ROLLBACK");
          return res.status(409).json({error:"Esta ocorrência já foi concluída ou cancelada."});
        }
      }
      const category=(await client.query("SELECT id,legacy_key FROM event_categories WHERE id=$1 AND user_id=$2",[body.categoryId,user])).rows[0];
      if(!category){
        await client.query("ROLLBACK");
        return res.status(400).json({error:"Selecione um bloco válido."});
      }
      const window=windowFor(period);
      const events=await fetchEvents(user,window.from,window.to);
      const others=(await client.query(`SELECT starts_at AS "startsAt",ends_at AS "endsAt" FROM planning_suggestions
        WHERE user_id=$1 AND status='accepted' AND event_id IS NULL AND id<>$2`,[user,row.id])).rows;
      if(planner.hasConflict([...events,...others],row.starts_at,row.ends_at)){
        await client.query("ROLLBACK");
        return res.status(409).json({error:"Esse horário ficou ocupado. Descarte a sugestão e gere um novo planejamento."});
      }
      const eventId=randomUUID();
      await client.query(`INSERT INTO events(id,user_id,title,starts_at,ends_at,notes,category,category_id,recurrence_type,recurrence_days,time_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'none',ARRAY[]::smallint[],'exact')`,[
        eventId,user,`Foco: ${row.title}`.slice(0,160),row.starts_at,row.ends_at,"Bloco sugerido pelo Planejamento Inteligente. A tarefa permanece independente.",category.legacy_key||"other",category.id]);
      await client.query("UPDATE planning_suggestions SET status='accepted',event_id=$1,updated_at=NOW() WHERE id=$2",[eventId,row.id]);
      await client.query("COMMIT");
      res.json({ok:true,eventId});
    }catch(error){
      try{await client.query("ROLLBACK");}catch(_){}
      throw error;
    }finally{client.release();}
  };
  return {list,generate,dismiss,accept};
};
