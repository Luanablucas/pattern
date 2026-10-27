"use strict";
const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const { dateString, safeText } = require("../validation/common");
const { validate } = require("../middleware/api");

const goalSchema = z.object({
  title: safeText(140),
  description: z.string().trim().max(1200).default(""),
  category: safeText(40).default("Pessoal"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  dueDate: dateString.nullable().default(null),
  status: z.enum(["active", "paused", "completed", "archived"]).default("active")
}).strict();
const stepSchema = z.object({ title: safeText(160) }).strict();
const stepUpdateSchema = z.object({ title: safeText(160).optional(), completed: z.boolean().optional() }).strict()
  .refine(value => value.title !== undefined || value.completed !== undefined, "Informe uma alteração.");
const linkSchema = z.object({ type: z.enum(["task", "habit"]), entityId: z.string().uuid() }).strict();

module.exports = function createGoalsController(db) {
  const list = async (req, res) => {
    const user = req.user.id;
    const goals = (await db.query(`SELECT id,title,description,category,priority,to_char(due_date,'YYYY-MM-DD') AS "dueDate",
      status,created_at AS "createdAt",completed_at AS "completedAt"
      FROM goals WHERE user_id=$1 ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
      due_date ASC NULLS LAST,created_at DESC LIMIT 250`, [user])).rows;
    const steps = (await db.query(`SELECT s.id,s.goal_id AS "goalId",s.title,s.position,s.completed,
      s.completed_at AS "completedAt" FROM goal_steps s JOIN goals g ON g.id=s.goal_id
      WHERE g.user_id=$1 ORDER BY s.position,s.created_at`, [user])).rows;
    const tasks = (await db.query(`SELECT l.goal_id AS "goalId",t.id,t.title,t.completed,t.recurrence_type AS "repeat"
      FROM goal_task_links l JOIN goals g ON g.id=l.goal_id JOIN tasks t ON t.id=l.task_id
      WHERE g.user_id=$1 AND t.user_id=$1 ORDER BY t.title`, [user])).rows;
    const habits = (await db.query(`SELECT l.goal_id AS "goalId",h.id,h.name
      FROM goal_habit_links l JOIN goals g ON g.id=l.goal_id JOIN habits h ON h.id=l.habit_id
      WHERE g.user_id=$1 AND h.user_id=$1 ORDER BY h.name`, [user])).rows;
    res.json(goals.map(goal => {
      const stages = steps.filter(s => s.goalId === goal.id);
      const completed = stages.filter(s => s.completed).length;
      return { ...goal, steps: stages, tasks: tasks.filter(t => t.goalId === goal.id),
        habits: habits.filter(h => h.goalId === goal.id),
        progress: stages.length ? Math.round(completed / stages.length * 100) : 0,
        completedSteps: completed, totalSteps: stages.length };
    }));
  };
  const options = async (req, res) => {
    const tasks = (await db.query(`SELECT id,title FROM tasks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 300`, [req.user.id])).rows;
    const habits = (await db.query(`SELECT id,name FROM habits WHERE user_id=$1 ORDER BY created_at DESC LIMIT 150`, [req.user.id])).rows;
    res.json({ tasks, habits });
  };
  const create = async (req, res) => {
    const body = validate(goalSchema, req, res);
    if (!body) return;
    const id = randomUUID();
    const { rows } = await db.query(`INSERT INTO goals(id,user_id,title,description,category,priority,due_date,status,completed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN NOW() ELSE NULL END)
      RETURNING id`, [id,req.user.id,body.title,body.description,body.category,body.priority,body.dueDate,body.status,body.status === "completed"]);
    res.status(201).json({ id: rows[0].id });
  };
  const update = async (req, res) => {
    const body = validate(goalSchema, req, res);
    if (!body) return;
    const { rows } = await db.query(`UPDATE goals SET title=$1,description=$2,category=$3,priority=$4,due_date=$5,
      status=$6,completed_at=CASE WHEN $9 THEN COALESCE(completed_at,NOW()) ELSE NULL END,updated_at=NOW()
      WHERE id=$7 AND user_id=$8 RETURNING id`, [body.title,body.description,body.category,body.priority,body.dueDate,body.status,req.params.id,req.user.id,body.status === "completed"]);
    if (!rows[0]) return res.status(404).json({ error: "Objetivo não encontrado." });
    res.json({ id: rows[0].id });
  };
  const remove = async (req, res) => {
    const result = await db.query(`DELETE FROM goals WHERE id=$1 AND user_id=$2`, [req.params.id,req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Objetivo não encontrado." });
    res.json({ ok: true });
  };
  const addStep = async (req, res) => {
    const body = validate(stepSchema,req,res);
    if (!body) return;
    const id = randomUUID();
    const { rows } = await db.query(`INSERT INTO goal_steps(id,goal_id,title,position)
      SELECT $1,g.id,$2,COALESCE((SELECT MAX(position)+1 FROM goal_steps WHERE goal_id=g.id),0)
      FROM goals g WHERE g.id=$3 AND g.user_id=$4 RETURNING id`, [id,body.title,req.params.id,req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "Objetivo não encontrado." });
    res.status(201).json({ id });
  };
  const updateStep = async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.stepId).success) return res.status(400).json({ error: "Etapa inválida." });
    const body = validate(stepUpdateSchema,req,res);
    if (!body) return;
    const { rows } = await db.query(`UPDATE goal_steps s SET
      title=COALESCE($1,s.title),completed=COALESCE($2,s.completed),
      completed_at=CASE WHEN $2 IS NULL THEN s.completed_at WHEN $2 THEN COALESCE(s.completed_at,NOW()) ELSE NULL END
      FROM goals g WHERE s.goal_id=g.id AND s.goal_id=$3 AND s.id=$4 AND g.user_id=$5
      RETURNING s.id,s.completed,s.completed_at AS "completedAt"`,
      [body.title??null,body.completed??null,req.params.id,req.params.stepId,req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "Etapa não encontrada." });
    if (body.completed === true) {
      const wasCompleted = await db.query(`SELECT COUNT(*)::int AS count FROM goal_step_events
        WHERE step_id=$1 AND happened_at=$2`, [rows[0].id,rows[0].completedAt]);
      if (!wasCompleted.rows[0]?.count) {
        await db.query(`INSERT INTO goal_step_events(id,step_id,happened_at)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [randomUUID(),rows[0].id,rows[0].completedAt]);
      }
    }
    res.json({ ok: true });
  };
  const removeStep = async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.stepId).success) return res.status(400).json({ error: "Etapa inválida." });
    const result = await db.query(`DELETE FROM goal_steps s USING goals g
      WHERE s.goal_id=g.id AND g.user_id=$1 AND s.goal_id=$2 AND s.id=$3`,
      [req.user.id,req.params.id,req.params.stepId]);
    if (!result.rowCount) return res.status(404).json({ error: "Etapa não encontrada." });
    res.json({ ok: true });
  };
  const addLink = async (req, res) => {
    const body = validate(linkSchema,req,res);
    if (!body) return;
    const table = body.type === "task" ? "goal_task_links" : "goal_habit_links";
    const entityTable = body.type === "task" ? "tasks" : "habits";
    const key = body.type === "task" ? "task_id" : "habit_id";
    const { rows } = await db.query(`INSERT INTO ${table}(goal_id,${key})
      SELECT g.id,e.id FROM goals g JOIN ${entityTable} e ON e.id=$1 AND e.user_id=g.user_id
      WHERE g.id=$2 AND g.user_id=$3 ON CONFLICT DO NOTHING RETURNING goal_id`,
      [body.entityId,req.params.id,req.user.id]);
    if (!rows[0]) {
      const exists = await db.query(`SELECT 1 FROM ${table} WHERE goal_id=$1 AND ${key}=$2
        AND EXISTS(SELECT 1 FROM goals WHERE id=$1 AND user_id=$3)`, [req.params.id,body.entityId,req.user.id]);
      if (!exists.rowCount) return res.status(404).json({ error: "Objetivo ou vínculo inválido." });
    }
    res.json({ ok: true });
  };
  const removeLink = async (req, res) => {
    const type = z.enum(["task","habit"]).safeParse(req.params.type);
    const entity = z.string().uuid().safeParse(req.params.entityId);
    if (!type.success || !entity.success) return res.status(400).json({ error: "Vínculo inválido." });
    const table = type.data === "task" ? "goal_task_links" : "goal_habit_links";
    const key = type.data === "task" ? "task_id" : "habit_id";
    const result = await db.query(`DELETE FROM ${table} l USING goals g
      WHERE l.goal_id=g.id AND g.user_id=$1 AND l.goal_id=$2 AND l.${key}=$3`,
      [req.user.id,req.params.id,entity.data]);
    if (!result.rowCount) return res.status(404).json({ error: "Vínculo não encontrado." });
    res.json({ ok: true });
  };
  return {list,options,create,update,remove,addStep,updateStep,removeStep,addLink,removeLink};
};
