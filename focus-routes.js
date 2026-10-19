"use strict";

const { randomUUID } = require("node:crypto");
const { z } = require("zod");

module.exports = function registerFocusRoutes(app, db, asyncRoute, uuidRoute) {
  const startSchema = z.object({
    mode: z.enum(["pomodoro", "free"]),
    durationMinutes: z.number().int().min(5).max(180).nullable(),
    taskId: z.string().uuid().nullable()
  }).strict().superRefine((value, context) => {
    if (value.mode === "pomodoro" && value.durationMinutes === null) {
      context.addIssue({ code: "custom", message: "Defina a duração do Pomodoro." });
    }
    if (value.mode === "free" && value.durationMinutes !== null) {
      context.addIssue({ code: "custom", message: "O cronômetro livre não usa duração fixa." });
    }
  });

  const fields = `id,task_id AS "taskId",task_title AS "taskTitle",mode,planned_seconds AS "plannedSeconds",status,started_at AS "startedAt",active_since AS "activeSince",paused_at AS "pausedAt",elapsed_seconds AS "elapsedSeconds",pause_seconds AS "pauseSeconds",finished_at AS "finishedAt"`;
  const activeQuery = `SELECT ${fields} FROM focus_sessions WHERE user_id=$1 AND status IN ('running','paused') LIMIT 1`;

  async function finishExpired(userId) {
    await db.query(`UPDATE focus_sessions
      SET elapsed_seconds=planned_seconds,status='completed',
      finished_at=active_since+(planned_seconds-elapsed_seconds)*INTERVAL '1 second',
      active_since=NULL,paused_at=NULL
      WHERE user_id=$1 AND status='running' AND mode='pomodoro' AND planned_seconds IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW()-active_since)) >= GREATEST(0,planned_seconds-elapsed_seconds)`, [userId]);
  }

  const respond = (res, session, status = 200) => res.status(status).json({ session, serverNow: new Date().toISOString() });

  app.get("/api/focus/active", asyncRoute(async (req, res) => {
    await finishExpired(req.user.id);
    const { rows } = await db.query(activeQuery, [req.user.id]);
    respond(res, rows[0] || null);
  }));

  app.post("/api/focus/start", asyncRoute(async (req, res) => {
    const result = startSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });
    await finishExpired(req.user.id);
    const { mode, durationMinutes, taskId } = result.data;
    let taskTitle = null;
    if (taskId) {
      const task = await db.query("SELECT title FROM tasks WHERE id=$1 AND user_id=$2", [taskId, req.user.id]);
      if (!task.rowCount) return res.status(400).json({ error: "Tarefa não encontrada." });
      taskTitle = task.rows[0].title;
    }
    try {
      const { rows } = await db.query(`INSERT INTO focus_sessions
        (id,user_id,task_id,task_title,mode,planned_seconds,status,started_at,active_since)
        VALUES($1,$2,$3,$4,$5,$6,'running',NOW(),NOW()) RETURNING ${fields}`,
      [randomUUID(), req.user.id, taskId, taskTitle, mode, mode === "pomodoro" ? durationMinutes * 60 : null]);
      respond(res, rows[0], 201);
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Você já possui uma sessão de foco em andamento." });
      throw error;
    }
  }));

  app.post("/api/focus/:id/pause", uuidRoute, asyncRoute(async (req, res) => {
    await finishExpired(req.user.id);
    const { rows } = await db.query(`UPDATE focus_sessions SET
      elapsed_seconds=LEAST(COALESCE(planned_seconds,2147483647),elapsed_seconds+GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-active_since)))::int)),
      active_since=NULL,paused_at=NOW(),status='paused'
      WHERE id=$1 AND user_id=$2 AND status='running' RETURNING ${fields}`,
    [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(409).json({ error: "A sessão não está em andamento." });
    respond(res, rows[0]);
  }));

  app.post("/api/focus/:id/resume", uuidRoute, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`UPDATE focus_sessions SET
      pause_seconds=pause_seconds+GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-paused_at)))::int),
      paused_at=NULL,active_since=NOW(),status='running'
      WHERE id=$1 AND user_id=$2 AND status='paused' RETURNING ${fields}`,
    [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(409).json({ error: "A sessão não está pausada." });
    respond(res, rows[0]);
  }));

  app.post("/api/focus/:id/finish", uuidRoute, asyncRoute(async (req, res) => {
    const { rows } = await db.query(`UPDATE focus_sessions SET
      elapsed_seconds=LEAST(COALESCE(planned_seconds,2147483647),elapsed_seconds+
        CASE WHEN status='running' THEN GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-active_since)))::int) ELSE 0 END),
      pause_seconds=pause_seconds+
        CASE WHEN status='paused' THEN GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-paused_at)))::int) ELSE 0 END,
      active_since=NULL,paused_at=NULL,status='completed',finished_at=NOW()
      WHERE id=$1 AND user_id=$2 AND status IN ('running','paused') RETURNING ${fields}`,
    [req.params.id, req.user.id]);
    if (!rows[0]) {
      const found = await db.query(`SELECT ${fields} FROM focus_sessions WHERE id=$1 AND user_id=$2 AND status='completed'`, [req.params.id, req.user.id]);
      if (!found.rows[0]) return res.status(404).json({ error: "Sessão não encontrada." });
      return respond(res, found.rows[0]);
    }
    respond(res, rows[0]);
  }));

  app.get("/api/focus/history", asyncRoute(async (req, res) => {
    const parsed = z.object({ days: z.coerce.number().int().refine(v => [7, 14, 30].includes(v)).default(7) }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Período inválido." });
    await finishExpired(req.user.id);
    const days = parsed.data.days;
    const base = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
    const dailyResult = await db.query(`WITH dates AS (
      SELECT generate_series(${base}-($2::int-1),${base},INTERVAL '1 day')::date AS day
      ) SELECT to_char(dates.day,'YYYY-MM-DD') AS date,
      COALESCE(SUM(f.elapsed_seconds),0)::int AS seconds,
      COUNT(f.id)::int AS sessions
      FROM dates LEFT JOIN focus_sessions f ON f.user_id=$1 AND f.status='completed'
      AND (f.finished_at AT TIME ZONE 'America/Sao_Paulo')::date=dates.day
      GROUP BY dates.day ORDER BY dates.day`, [req.user.id, days]);
    const { rows: sessions } = await db.query(`SELECT ${fields} FROM focus_sessions
      WHERE user_id=$1 AND status='completed'
      AND (finished_at AT TIME ZONE 'America/Sao_Paulo')::date>=${base}-($2::int-1)
      ORDER BY finished_at DESC LIMIT 30`, [req.user.id, days]);
    const daily = dailyResult.rows;
    res.json({ days: daily, sessions, summary: {
      seconds: daily.reduce((sum, day) => sum + day.seconds, 0),
      sessions: daily.reduce((sum, day) => sum + day.sessions, 0),
      activeDays: daily.filter(day => day.seconds > 0).length
    }});
  }));
};
