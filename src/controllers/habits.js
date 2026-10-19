"use strict";
const {z}=require("zod");
const {randomUUID}=require("node:crypto");
const {habitSchema,habitFields}=require("../validation/habits");
const {dateString}=require("../validation/common");
const {validate}=require("../middleware/api");
const createHabitService=require("../services/habits");

module.exports = function createHabitsController(db) {
const {ensureUserRoutine}=createHabitService(db);
const list = async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${habitFields} FROM habits WHERE user_id=$1 ORDER BY position ASC,created_at ASC LIMIT 100`,
      [req.user.id],
    );
    const entries = await db.query(
      `SELECT e.habit_id AS "habitId", to_char(e.entry_date,'YYYY-MM-DD') AS date FROM habit_entries e INNER JOIN habits h ON h.id=e.habit_id WHERE h.user_id=$1 AND e.entry_date >= (CURRENT_DATE - INTERVAL '90 days')`,
      [req.user.id],
    );
    res.json({ habits: rows, entries: entries.rows });
  };
const create = async (req, res) => {
    const body = validate(habitSchema, req, res);
    if (!body) return;
    if (!(await ensureUserRoutine(body.routineId, req.user.id)))
      return res.status(400).json({ error: "Rotina inválida." });
    const { rows } = await db.query(
      `INSERT INTO habits(id,user_id,name,schedule_days,preferred_time,goal_per_week,routine_id,position)
  VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(MAX(position),0)+1 FROM habits WHERE user_id=$2)) RETURNING ${habitFields}`,
      [
        randomUUID(),
        req.user.id,
        body.name,
        body.scheduleDays,
        body.preferredTime,
        body.goalPerWeek,
        body.routineId,
      ],
    );
    res.status(201).json(rows[0]);
  };
const update = async (req, res) => {
    const body = validate(habitSchema, req, res);
    if (!body) return;
    if (!(await ensureUserRoutine(body.routineId, req.user.id)))
      return res.status(400).json({ error: "Rotina inválida." });
    const { rows } = await db.query(
      `UPDATE habits SET name=$1,schedule_days=$2,preferred_time=$3,goal_per_week=$4,routine_id=$5 WHERE id=$6 AND user_id=$7 RETURNING ${habitFields}`,
      [
        body.name,
        body.scheduleDays,
        body.preferredTime,
        body.goalPerWeek,
        body.routineId,
        req.params.id,
        req.user.id,
      ],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Hábito não encontrado." });
    res.json(rows[0]);
  };
const check = async (req, res) => {
    const body = validate(z.object({ date: dateString }).strict(), req, res);
    if (!body) return;
    const today = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
    );
    const dateToday = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const selected = Date.parse(`${body.date}T00:00:00Z`);
    if (selected > dateToday || selected < dateToday - 90 * 86400000)
      return res
        .status(400)
        .json({
          error: "É possível marcar apenas os últimos 90 dias, até hoje.",
        });
    const userHabit = await db.query(
      "SELECT id FROM habits WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!userHabit.rowCount)
      return res.status(404).json({ error: "Hábito não encontrado." });
    const removed = await db.query(
      "DELETE FROM habit_entries WHERE habit_id=$1 AND entry_date=$2 RETURNING habit_id",
      [req.params.id, body.date],
    );
    if (removed.rowCount) return res.json({ checked: false });
    await db.query(
      "INSERT INTO habit_entries(habit_id,entry_date) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [req.params.id, body.date],
    );
    res.json({ checked: true });
  };
const remove = async (req, res) => {
    const result = await db.query(
      "DELETE FROM habits WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Hábito não encontrado." });
    res.json({ ok: true });
  };
return {list,create,update,check,remove};
};
