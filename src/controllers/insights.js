"use strict";

module.exports = function createInsightsController(db) {
const list = async (req, res) => {
    const sql = `WITH days AS (
    SELECT generate_series((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 13,
    (NOW() AT TIME ZONE 'America/Sao_Paulo')::date, INTERVAL '1 day')::date AS day
  ), completions AS (
    SELECT (t.completed_at AT TIME ZONE 'America/Sao_Paulo')::date AS day
    FROM tasks t WHERE t.user_id=$1 AND t.completed_at IS NOT NULL AND t.recurrence_type='none'
    UNION ALL
    SELECT (o.completed_at AT TIME ZONE 'America/Sao_Paulo')::date AS day
    FROM task_occurrences o JOIN tasks t ON t.id=o.task_id
    WHERE t.user_id=$1 AND o.completed=TRUE AND o.cancelled=FALSE AND o.completed_at IS NOT NULL
  ) SELECT to_char(days.day,'YYYY-MM-DD') AS date,COUNT(c.day)::int AS completed
    FROM days LEFT JOIN completions c ON c.day=days.day
    GROUP BY days.day ORDER BY days.day`;
    const { rows: days } = await db.query(sql, [req.user.id]);
    let analysis = null;
    let pythonOnline = false;
    try {
      const response = await fetch(
        `${process.env.PYTHON_API_URL || "http://127.0.0.1:8001"}/analyze`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ days }),
          signal: AbortSignal.timeout(1800),
        },
      );
      if (response.ok) {
        analysis = await response.json();
        pythonOnline = true;
      }
    } catch (_) {
      
    }

    const habitRows = await db.query(
      `SELECT id,schedule_days AS days,
    to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS created
    FROM habits WHERE user_id=$1`,
      [req.user.id],
    );
    const entryRows = await db.query(
      `SELECT habit_id AS id,to_char(entry_date,'YYYY-MM-DD') AS day
    FROM habit_entries WHERE habit_id IN (SELECT id FROM habits WHERE user_id=$1)
    AND entry_date >= ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 27)`,
      [req.user.id],
    );
    const marked = new Set(entryRows.rows.map((e) => `${e.id}:${e.day}`));
    const localToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const anchor = new Date(`${localToday}T12:00:00Z`);
    const habitDays = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(anchor);
      d.setUTCDate(d.getUTCDate() - 27 + i);
      const date = d.toISOString().slice(0, 10);
      const day = d.getUTCDay();
      const planned = habitRows.rows.filter(
        (h) => h.created <= date && h.days.includes(day),
      );
      return {
        date,
        scheduled: planned.length,
        completed: planned.filter((h) => marked.has(`${h.id}:${date}`)).length,
      };
    });
    let habitAnalysis = null,
      habitPythonOnline = false;
    try {
      const response = await fetch(
        `${process.env.PYTHON_API_URL || "http://127.0.0.1:8001"}/analyze-habits`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ days: habitDays }),
          signal: AbortSignal.timeout(1800),
        },
      );
      if (response.ok) {
        habitAnalysis = await response.json();
        habitPythonOnline = true;
      }
    } catch (_) {
      
    }
    res.json({
      days,
      analysis,
      pythonOnline,
      habitDays,
      habitAnalysis,
      habitPythonOnline,
    });
  };
return {list};
};
