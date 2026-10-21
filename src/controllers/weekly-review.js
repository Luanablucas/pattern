"use strict";
const { z } = require("zod");
const { dateString } = require("../validation/common");
const { addDays, localDate } = require("../../recurrence-utils");
const { monday,daysBetween,summarizeWeek,weekComparison,weeklyNotes,recurringCandidates } = require("../services/weekly-review");

module.exports = function createWeeklyController(db) {
  const list = async (req,res) => {
    const input = z.object({week:dateString.optional()}).strict().safeParse(req.query);
    if (!input.success) return res.status(400).json({error:"Semana inválida."});
    const today = localDate(new Date());
    const currentMonday=monday(today);
    const start=input.data.week || currentMonday;
    if(monday(start)!==start || start>currentMonday || start<addDays(currentMonday,-364))
      return res.status(400).json({error:"Escolha uma segunda-feira das últimas 52 semanas."});
    const end=addDays(start,6);
    const limit=end<today?end:today;
    const previousStart=addDays(start,-7);
    const previousEnd=addDays(start,-1);
    const from=previousStart;
    const to=limit;
    const user=req.user.id;
    const [taskRows,focusRows,habitRows,entryRows,eventRows,goalRows,pendingRows,seriesRows]=await Promise.all([
      db.query(`WITH completed AS (
        SELECT (completed_at AT TIME ZONE 'America/Sao_Paulo')::date AS day FROM tasks
        WHERE user_id=$1 AND recurrence_type='none' AND completed_at IS NOT NULL
        UNION ALL
        SELECT (o.completed_at AT TIME ZONE 'America/Sao_Paulo')::date
        FROM task_occurrences o JOIN tasks t ON t.id=o.task_id
        WHERE t.user_id=$1 AND o.completed=TRUE AND o.cancelled=FALSE AND o.completed_at IS NOT NULL
      ) SELECT to_char(day,'YYYY-MM-DD') AS date,COUNT(*)::int AS count
      FROM completed WHERE day BETWEEN $2::date AND $3::date GROUP BY day`,[user,from,to]),
      db.query(`SELECT to_char((finished_at AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM-DD') AS date,
        SUM(elapsed_seconds)::bigint AS seconds,COUNT(*)::int AS sessions FROM focus_sessions
        WHERE user_id=$1 AND status='completed' AND
        (finished_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
        GROUP BY 1`,[user,from,to]),
      db.query(`SELECT id,schedule_days AS days,to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS created
        FROM habits WHERE user_id=$1`,[user]),
      db.query(`SELECT e.habit_id AS id,to_char(e.entry_date,'YYYY-MM-DD') AS date
        FROM habit_entries e JOIN habits h ON h.id=e.habit_id
        WHERE h.user_id=$1 AND e.entry_date BETWEEN $2::date AND $3::date`,[user,from,to]),
      db.query(`SELECT to_char(e.happened_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date,
        g.id AS "goalId",g.title AS "goalTitle" FROM goal_step_events e
        JOIN goal_steps s ON s.id=e.step_id JOIN goals g ON g.id=s.goal_id
        WHERE g.user_id=$1 AND (e.happened_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date`,[user,from,to]),
      db.query(`SELECT g.id,g.title,g.status,COUNT(s.id)::int AS "totalSteps",
        COUNT(s.id) FILTER(WHERE s.completed)::int AS "doneSteps" FROM goals g
        LEFT JOIN goal_steps s ON s.goal_id=g.id WHERE g.user_id=$1 AND g.status<>'archived'
        GROUP BY g.id ORDER BY g.updated_at DESC LIMIT 50`,[user]),
      db.query(`SELECT id,title,to_char(due_date,'YYYY-MM-DD') AS "dueDate",priority
        FROM tasks WHERE user_id=$1 AND recurrence_type='none' AND completed=FALSE
        ORDER BY due_date ASC NULLS LAST,created_at DESC LIMIT 40`,[user]),
      db.query(`SELECT id,title,to_char(due_date,'YYYY-MM-DD') AS start,
        recurrence_type AS repeat,recurrence_days AS days,to_char(recurrence_until,'YYYY-MM-DD') AS until
        FROM tasks WHERE user_id=$1 AND recurrence_type<>'none' LIMIT 100`,[user])
    ]);
    const current=summarizeWeek(daysBetween(start,limit),taskRows.rows,focusRows.rows,habitRows.rows,entryRows.rows,eventRows.rows);
    const previous=summarizeWeek(daysBetween(previousStart,previousEnd),taskRows.rows,focusRows.rows,habitRows.rows,entryRows.rows,eventRows.rows);
    const nextStart=addDays(currentMonday,7);
    const nextEnd=addDays(nextStart,6);
    const occurrences=await db.query(`SELECT o.task_id AS id,to_char(o.occurrence_date,'YYYY-MM-DD') AS date,o.completed,o.cancelled
      FROM task_occurrences o JOIN tasks t ON t.id=o.task_id
      WHERE t.user_id=$1 AND o.occurrence_date BETWEEN $2::date AND $3::date`,[user,nextStart,nextEnd]);
    const recurring=recurringCandidates(seriesRows.rows,occurrences.rows,nextStart,nextEnd);
    const remaining=pendingRows.rows.map(row=>({...row,recurring:false}));
    const pendingNext=[...remaining.filter(t=>!t.dueDate || t.dueDate<=nextEnd),...recurring].sort((a,b)=>(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31')).slice(0,30);
    const partial=end>today;
    res.json({period:{start,end,through:limit,partial},current,previous,comparison:weekComparison(current,previous),
      highlights:weeklyNotes(current,previous,remaining.length,partial),
      goalProgress:goalRows.rows.map(g=>({...g,progress:g.totalSteps?Math.round(g.doneSteps/g.totalSteps*100):0,
        advances:eventRows.rows.filter(e=>e.goalId===g.id && e.date>=start && e.date<=limit).length})),
      nextWeek:{start:nextStart,end:nextEnd,tasks:pendingNext},pendingCount:remaining.length,
      note:"Hábitos de semanas passadas usam os dias atualmente configurados. Etapas excluídas deixam de compor o histórico."});
  };
  return {list};
};
