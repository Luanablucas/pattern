"use strict";
const { randomUUID } = require("node:crypto");
const { addDays, localDate, occurrences, occurrenceTimestamp } = require("../../recurrence-utils");
const { dateString } = require("../validation/common");
const { eventSchema, eventConflictSchema, eventQueryBase, eventRangeSchema } = require("../validation/events");
const { validate } = require("../middleware/api");
const createEventService = require("../services/events");

module.exports = function createEventsController(db) {
  const { ownedCategory, fetchEvents, getSeries, validOccurrence } = createEventService(db);

  const list = async (req, res) => {
    if (Object.keys(req.query).length) {
      const parsed = eventRangeSchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: "Período do calendário inválido." });
      const from = new Date(parsed.data.from), to = new Date(parsed.data.to);
      if (to <= from || to - from > 70 * 86400000) return res.status(400).json({ error: "Informe um intervalo de até 70 dias." });
      return res.json(await fetchEvents(req.user.id, from.toISOString(), to.toISOString()));
    }
    const from = new Date(); from.setDate(from.getDate() - 1);
    const to = new Date(); to.setDate(to.getDate() + 10);
    res.json(await fetchEvents(req.user.id, from.toISOString(), to.toISOString()));
  };

  const create = async (req, res) => {
    const b = validate(eventSchema, req, res); if (!b) return;
    const category = await ownedCategory(b.categoryId, req.user.id);
    if (!category) return res.status(400).json({ error: "Bloco inválido." });
    const id = randomUUID();
    await db.query("INSERT INTO events(id,user_id,title,starts_at,ends_at,notes,category,category_id,recurrence_type,recurrence_days,recurrence_until,time_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [id,req.user.id,b.title,b.startsAt,b.endsAt,b.notes,category.legacy_key || "other",b.categoryId,b.repeat,b.repeatDays,b.repeatUntil,b.timeMode]);
    res.status(201).json(await getSeries(req.user.id, id));
  };

  const update = async (req, res) => {
    const b = validate(eventSchema, req, res); if (!b) return;
    const category = await ownedCategory(b.categoryId, req.user.id);
    if (!category) return res.status(400).json({ error: "Bloco inválido." });
    const changed = await db.query("UPDATE events SET title=$1,starts_at=$2,ends_at=$3,notes=$4,category=$5,category_id=$6,recurrence_type=$7,recurrence_days=$8,recurrence_until=$9,time_mode=$10 WHERE id=$11 AND user_id=$12", [b.title,b.startsAt,b.endsAt,b.notes,category.legacy_key || "other",b.categoryId,b.repeat,b.repeatDays,b.repeatUntil,b.timeMode,req.params.id,req.user.id]);
    if (!changed.rowCount) return res.status(404).json({ error: "Compromisso não encontrado." });
    res.json(await getSeries(req.user.id, req.params.id));
  };

  const editOccurrence = async (req, res) => {
    const day = dateString.safeParse(req.params.date);
    if (!day.success) return res.status(400).json({ error: "Data inválida." });
    const b = validate(eventSchema, req, res); if (!b) return;
    const series = await getSeries(req.user.id, req.params.id);
    if (!validOccurrence(series, day.data)) return res.status(404).json({ error: "Ocorrência não encontrada na série." });
    if (!await ownedCategory(b.categoryId, req.user.id)) return res.status(400).json({ error: "Bloco inválido." });
    if (b.repeat !== "none") return res.status(400).json({ error: "Uma ocorrência individual não possui repetição." });
    const { rows } = await db.query(`INSERT INTO event_overrides(event_id,occurrence_date,title,starts_at,ends_at,notes,category_id,time_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_id,occurrence_date) DO UPDATE SET title=EXCLUDED.title,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,notes=EXCLUDED.notes,category_id=EXCLUDED.category_id,time_mode=EXCLUDED.time_mode RETURNING event_id`, [req.params.id,day.data,b.title,b.startsAt,b.endsAt,b.notes,b.categoryId,b.timeMode]);
    await db.query("DELETE FROM event_cancellations WHERE event_id=$1 AND occurrence_date=$2", [req.params.id, day.data]);
    res.json({ ok: Boolean(rows[0]), seriesId: req.params.id, occurrenceDate: day.data });
  };

  const editFuture = async (req, res) => {
    const day = dateString.safeParse(req.params.date);
    if (!day.success) return res.status(400).json({ error: "Data inválida." });
    const b = validate(eventSchema, req, res); if (!b) return;
    const old = await getSeries(req.user.id, req.params.id);
    if (!validOccurrence(old, day.data)) return res.status(404).json({ error: "Ocorrência não encontrada na série." });
    const category = await ownedCategory(b.categoryId, req.user.id);
    if (!category) return res.status(400).json({ error: "Bloco inválido." });
    if (b.repeat === "none") return res.status(400).json({ error: "Para interromper a repetição, edite toda a série." });
    if (localDate(b.startsAt) !== day.data) return res.status(400).json({ error: "Mantenha a data da primeira ocorrência futura; ajuste apenas os horários e demais campos." });
    if (day.data === localDate(old.startsAt)) {
      req.params.id = old.id;
      return update(req, res);
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const locked = (await client.query("SELECT id,recurrence_type FROM events WHERE id=$1 AND user_id=$2 FOR UPDATE", [old.id,req.user.id])).rows[0];
      if (!locked || locked.recurrence_type === "none") { await client.query("ROLLBACK"); return res.status(409).json({ error: "A série foi alterada. Atualize o calendário." }); }
      const newId = randomUUID();
      await client.query("UPDATE events SET recurrence_until=$1 WHERE id=$2 AND user_id=$3", [addDays(day.data, -1),old.id,req.user.id]);
      await client.query("INSERT INTO events(id,user_id,title,starts_at,ends_at,notes,category,category_id,recurrence_type,recurrence_days,recurrence_until,time_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [newId,req.user.id,b.title,b.startsAt,b.endsAt,b.notes,category.legacy_key || "other",b.categoryId,b.repeat,b.repeatDays,b.repeatUntil,b.timeMode]);
      await client.query("INSERT INTO event_cancellations(event_id,occurrence_date) SELECT $1,occurrence_date FROM event_cancellations WHERE event_id=$2 AND occurrence_date>=$3 ON CONFLICT DO NOTHING", [newId,old.id,day.data]);
      await client.query("INSERT INTO event_overrides(event_id,occurrence_date,title,starts_at,ends_at,notes,category_id,time_mode) SELECT $1,occurrence_date,title,starts_at,ends_at,notes,category_id,time_mode FROM event_overrides WHERE event_id=$2 AND occurrence_date>=$3 ON CONFLICT DO NOTHING", [newId,old.id,day.data]);
      await client.query("DELETE FROM event_cancellations WHERE event_id=$1 AND occurrence_date>=$2", [old.id,day.data]);
      await client.query("DELETE FROM event_overrides WHERE event_id=$1 AND occurrence_date>=$2", [old.id,day.data]);
      await client.query("COMMIT");
      res.status(201).json(await getSeries(req.user.id,newId));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  };

  const cancelOccurrence = async (req, res) => {
    const date = dateString.safeParse(req.params.date);
    if (!date.success) return res.status(400).json({ error: "Data inválida." });
    const series = await getSeries(req.user.id, req.params.id);
    if (!validOccurrence(series,date.data)) return res.status(404).json({ error: "Ocorrência não encontrada." });
    await db.query("INSERT INTO event_cancellations(event_id,occurrence_date) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.params.id,date.data]);
    res.json({ ok: true });
  };

  const conflicts = async (req,res) => {
    const parse = eventConflictSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
    const b = parse.data;
    const base = localDate(b.startsAt);
    const start = new Date(b.startsAt);
    const until = new Date(start.getTime() + 45 * 86400000);
    const dates = occurrences({ start:base, until:b.repeatUntil, type:b.repeat, days:b.repeatDays, from:base, to:localDate(until.toISOString()) });
    const candidate = (b.repeat === "none" ? [base] : dates).map(day => ({
      startsAt: occurrenceTimestamp(b.startsAt,base,day),
      endsAt: occurrenceTimestamp(b.endsAt,base,day)
    }));
    if (!candidate.length) return res.json({count:0,conflicts:[]});
    const from = new Date(Math.min(...candidate.map(e=>Date.parse(e.startsAt))));
    const to = new Date(Math.max(...candidate.map(e=>Date.parse(e.endsAt))));
    if (to-from > 70*86400000) return res.status(400).json({ error:"Período de análise muito longo." });
    const existing = await fetchEvents(req.user.id,from.toISOString(),to.toISOString());
    const excludedOccurrence = b.excludeId && b.excludeOccurrence ? `${b.excludeId}@${b.excludeOccurrence}` : null;
    const overlap = existing.filter(ev => (excludedOccurrence ? ev.id !== excludedOccurrence : ev.id !== b.excludeId && ev.seriesId !== b.excludeId) && candidate.some(x => Date.parse(x.startsAt) < Date.parse(ev.endsAt) && Date.parse(x.endsAt) > Date.parse(ev.startsAt)));
    const unique = [...new Map(overlap.map(e => [e.id, { id:e.id,title:e.title,startsAt:e.startsAt,endsAt:e.endsAt }])).values()];
    res.json({ count:unique.length,conflicts:unique.slice(0,8) });
  };

  const remove = async (req,res) => {
    const result = await db.query("DELETE FROM events WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Compromisso não encontrado." });
    res.json({ok:true});
  };
  return { list, create, update, editOccurrence, editFuture, cancelOccurrence, conflicts, remove };
};
