"use strict";

const { z } = require("zod");
const { addDays, localDate, occurrences } = require("../../recurrence-utils");
const { rangeDates, combineDaily, summarize, compare, summarizeCategories } = require("../services/analytics");
const createEventService = require("../services/events");
const createFocusService = require("../services/focus");

module.exports = function createAnalyticsController(db) {
  const { fetchEvents } = createEventService(db);
  const { finishExpired } = createFocusService(db);
  const list = async (req, res) => {
    const input = z.object({ days: z.coerce.number().int().refine(value => [7, 14, 30, 90].includes(value)).default(30) }).strict().safeParse(req.query);
    if (!input.success) return res.status(400).json({ error: "Escolha 7, 14, 30 ou 90 dias." });
    const days = input.data.days;
    const today = localDate(new Date());
    const dates = rangeDates(today, days * 2);
    const from = dates[0];
    await finishExpired(req.user.id);

    const taskRows = await db.query(`WITH completions AS (
      SELECT (completed_at AT TIME ZONE 'America/Sao_Paulo')::date AS date FROM tasks
      WHERE user_id=$1 AND recurrence_type='none' AND completed_at IS NOT NULL
      UNION ALL
      SELECT (o.completed_at AT TIME ZONE 'America/Sao_Paulo')::date AS date
      FROM task_occurrences o JOIN tasks t ON t.id=o.task_id
      WHERE t.user_id=$1 AND o.completed=TRUE AND o.cancelled=FALSE AND o.completed_at IS NOT NULL
    ) SELECT to_char(date,'YYYY-MM-DD') AS date,COUNT(*)::int AS completed
      FROM completions WHERE date BETWEEN $2::date AND $3::date GROUP BY date`, [req.user.id, from, today]);

    const focusRows = await db.query(`SELECT to_char((finished_at AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM-DD') AS date,
      COALESCE(SUM(elapsed_seconds),0)::bigint AS seconds,COUNT(*)::int AS sessions
      FROM focus_sessions WHERE user_id=$1 AND status='completed'
      AND (finished_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
      GROUP BY 1`, [req.user.id, from, today]);

    const habitRows = await db.query(`SELECT id,schedule_days AS days,
      to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS created
      FROM habits WHERE user_id=$1`, [req.user.id]);
    const entryRows = await db.query(`SELECT e.habit_id AS id,to_char(e.entry_date,'YYYY-MM-DD') AS date
      FROM habit_entries e JOIN habits h ON h.id=e.habit_id
      WHERE h.user_id=$1 AND e.entry_date BETWEEN $2::date AND $3::date`, [req.user.id, from, today]);

    const combined = combineDaily(dates, taskRows.rows, focusRows.rows, habitRows.rows, entryRows.rows);
    const currentDays = combined.slice(-days);
    const previousDays = combined.slice(0, days);
    const summary = summarize(currentDays);
    const previous = summarize(previousDays);

    const recurringTasks = await db.query(`SELECT id,to_char(due_date,'YYYY-MM-DD') AS start,
      recurrence_type AS repeat,recurrence_days AS days,to_char(recurrence_until,'YYYY-MM-DD') AS until
      FROM tasks WHERE user_id=$1 AND recurrence_type<>'none' AND due_date<=$2::date`, [req.user.id, today]);
    const recurringEntries = await db.query(`SELECT o.task_id AS id,to_char(o.occurrence_date,'YYYY-MM-DD') AS date,
      o.completed,o.cancelled FROM task_occurrences o JOIN tasks t ON t.id=o.task_id
      WHERE t.user_id=$1 AND o.occurrence_date BETWEEN $2::date AND $3::date`,
      [req.user.id, currentDays[0].date, today]);
    const recorded = new Map(recurringEntries.rows.map(row => [`${row.id}@${row.date}`, row]));
    let recurringPlanned = 0;
    let recurringCompleted = 0;
    for (const task of recurringTasks.rows) {
      for (const date of occurrences({ start: task.start, until: task.until, type: task.repeat, days: task.days, from: currentDays[0].date, to: today })) {
        const entry = recorded.get(`${task.id}@${date}`);
        if (entry?.cancelled) continue;
        recurringPlanned++;
        if (entry?.completed) recurringCompleted++;
      }
    }

    const status = await db.query(`SELECT
      COUNT(*) FILTER (WHERE recurrence_type='none' AND completed=FALSE)::int AS pending,
      COUNT(*) FILTER (WHERE recurrence_type='none' AND completed=FALSE AND due_date<(NOW() AT TIME ZONE 'America/Sao_Paulo')::date)::int AS overdue
      FROM tasks WHERE user_id=$1`, [req.user.id]);

    const focusHours = await db.query(`SELECT EXTRACT(HOUR FROM started_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour,
      COALESCE(SUM(elapsed_seconds),0)::bigint AS seconds
      FROM focus_sessions WHERE user_id=$1 AND status='completed'
      AND (finished_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
      GROUP BY 1 ORDER BY 1`, [req.user.id, currentDays[0].date, today]);

    const focusTasks = await db.query(`SELECT COALESCE(NULLIF(task_title,''),'Sem tarefa vinculada') AS title,
      COALESCE(SUM(elapsed_seconds),0)::bigint AS seconds,COUNT(*)::int AS sessions
      FROM focus_sessions WHERE user_id=$1 AND status='completed'
      AND (finished_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
      GROUP BY 1 ORDER BY seconds DESC LIMIT 6`, [req.user.id, currentDays[0].date, today]);

    const chunks = [];
    for (let index = 0; index < days; index += 28) {
      const start = addDays(currentDays[0].date, index);
      const end = addDays(start, Math.min(28, days - index));
      const fromInstant = new Date(`${start}T00:00:00-03:00`).toISOString();
      const toInstant = new Date(`${end}T00:00:00-03:00`).toISOString();
      chunks.push({ from: fromInstant, to: toInstant, events: await fetchEvents(req.user.id, fromInstant, toInstant) });
    }
    const categories = summarizeCategories(chunks);
    let insight = null;
    let pythonOnline = false;
    try {
      const response = await fetch(`${process.env.PYTHON_API_URL || "http://127.0.0.1:8001"}/analyze-dashboard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: combined, periodDays: days }),
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        insight = await response.json();
        pythonOnline = true;
      }
    } catch (_) {}
    res.json({
      period: { from: currentDays[0].date, to: today, days },
      daily: currentDays,
      summary: { ...summary, pending: status.rows[0]?.pending || 0, overdue: status.rows[0]?.overdue || 0, recurringPlanned, recurringCompleted, recurringRate: recurringPlanned ? Math.round(recurringCompleted / recurringPlanned * 100) : null },
      comparison: compare(summary, previous),
      focusHours: focusHours.rows.map(row => ({ hour: Number(row.hour), seconds: Number(row.seconds) })),
      focusTasks: focusTasks.rows.map(row => ({ ...row, seconds: Number(row.seconds) })),
      categories,
      insight,
      pythonOnline
    });
  };
  return { list };
};
