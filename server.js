"use strict";
require("dotenv").config();

const express = require("express");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { rateLimit } = require("express-rate-limit");
const { Pool } = require("pg");
const { addDays,localDate,occurrences,occurrenceTimestamp } = require("./recurrence-utils");
const { validEventWindow } = require("./event-time-utils");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error(
    "Configure JWT_SECRET com pelo menos 32 caracteres no arquivo .env",
  );
}
if (!process.env.DATABASE_URL)
  throw new Error("Configure DATABASE_URL no arquivo .env");

const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 3000);
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida");
const safeText = (max) => z.string().trim().min(1).max(max);
const weekdaysSchema = z.array(z.number().int().min(0).max(6)).max(7)
  .refine(v=>new Set(v).size===v.length,'Não repita dias da semana.');
const recurrenceFields = {
  repeat: z.enum(['none','daily','weekly','monthly']).default('none'),
  repeatDays: weekdaysSchema.default([]),
  repeatUntil: dateString.nullable().default(null)
};
function recurrenceValid(v,start) {
  return (v.repeat==='none' || Boolean(start)) &&
    (v.repeat!=='weekly' || v.repeatDays.length>0) &&
    (!v.repeatUntil || (start && v.repeatUntil>=start));
}
function recurringDates(row,baseDate,from,to) {
  return occurrences({start:baseDate,until:row.repeatUntil,type:row.repeat,days:row.repeatDays||[],from,to});
}
const ISO_DATE_RE=/^\d{4}-\d{2}-\d{2}$/;


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "24kb" }));
app.use(cookieParser());
app.use(
  "/static",
  express.static(path.join(__dirname, "public"), { maxAge: "2h" }),
);

app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    if (req.method !== "DELETE" && !req.is("application/json"))
      return res.status(415).json({ error: "Envie JSON." });
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.get("host"))
          return res.status(403).json({ error: "Origem inválida." });
      } catch (_) {
        return res.status(403).json({ error: "Origem inválida." });
      }
    }
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
function getUser(req) {
  const token = req.cookies.pattern_token;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (_) {
    return null;
  }
}
function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user)
    return res.status(401).json({ error: "Faça login para continuar." });
  req.user = user;
  next();
}
function requirePageAuth(req, res, next) {
  req.user = getUser(req);
  if (!req.user) return res.redirect("/login");
  res.set("Cache-Control", "no-store");
  next();
}
function issueCookie(res, user) {
  const token = jwt.sign(
    { id: user.id, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "7d", algorithm: "HS256" },
  );
  res.cookie("pattern_token", token, cookieOptions);
}
function validate(schema, req, res) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res
      .status(400)
      .json({ error: result.error.issues[0]?.message || "Dados inválidos." });
    return null;
  }
  return result.data;
}
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const uuidRoute = (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success)
    return res.status(400).json({ error: "Identificador inválido." });
  next();
};

app.get("/", (req, res) => res.redirect(getUser(req) ? "/app" : "/login"));
app.get("/login", (req, res) => res.render("auth", { mode: "login" }));
app.get("/register", (req, res) => res.render("auth", { mode: "register" }));
const pages = ["app", "tasks", "calendar", "habits", "insights", "focus"];
app.get("/:page", requirePageAuth, (req, res, next) => {
  if (!pages.includes(req.params.page)) return next();
  res.render("app", { page: req.params.page, name: req.user.name });
});

app.post(
  "/api/auth/register",
  authLimiter,
  asyncRoute(async (req, res) => {
    const body = validate(
      z
        .object({
          name: safeText(80),
          email: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z
            .string()
            .min(8, "A senha precisa ter 8 caracteres ou mais.")
            .max(72),
        })
        .strict(),
      req,
      res,
    );
    if (!body) return;
    const user = { id: randomUUID(), name: body.name, email: body.email };
    const hash = await bcrypt.hash(body.password, 12);
    try {
      await db.query(
        "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
        [user.id, user.name, user.email, hash],
      );
      await db.query(`INSERT INTO event_categories(id,user_id,name,color,legacy_key)
        SELECT gen_random_uuid(),$1,v.name,v.color,v.key
        FROM (VALUES ('study','Estudos','#8e77d2'),('work','Trabalho','#73a1cf'),
          ('personal','Pessoal','#d68bab'),('health','Saúde','#75aa96'),
          ('other','Outros','#d5a26b')) AS v(key,name,color)
        ON CONFLICT DO NOTHING`,[user.id]);
    } catch (err) {
      if (err.code === "23505")
        return res
          .status(409)
          .json({ error: "Este e-mail já está cadastrado." });
      throw err;
    }
    issueCookie(res, user);
    res.status(201).json({ ok: true });
  }),
);
app.post(
  "/api/auth/login",
  authLimiter,
  asyncRoute(async (req, res) => {
    const body = validate(
      z
        .object({
          email: z
            .string()
            .trim()
            .email()
            .transform((v) => v.toLowerCase()),
          password: z.string(),
        })
        .strict(),
      req,
      res,
    );
    if (!body) return;
    const { rows } = await db.query(
      "SELECT id,name,password_hash FROM users WHERE email=$1",
      [body.email],
    );
    const valid =
      rows[0] && (await bcrypt.compare(body.password, rows[0].password_hash));
    if (!valid)
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    issueCookie(res, rows[0]);
    res.json({ ok: true });
  }),
);
app.post("/api/auth/logout", requireAuth, (req, res) => {
  res.clearCookie("pattern_token", {
    path: "/",
    sameSite: cookieOptions.sameSite,
    secure: cookieOptions.secure,
    httpOnly: true,
  });
  res.json({ ok: true });
});

app.use("/api", requireAuth);

const taskSchema = z.object({
  title: safeText(160),
  notes:z.string().max(2000).default(''),
  dueDate:dateString.nullable().default(null),
  priority:z.enum(['low','medium','high']).default('medium'),
  ...recurrenceFields
}).strict().refine(v=>recurrenceValid(v,v.dueDate),{message:'Escolha uma data inicial e dias válidos para a repetição.'});
const taskColumns = `id,title,notes,to_char(due_date,'YYYY-MM-DD') AS "dueDate",priority,completed,created_at AS "createdAt",recurrence_type AS "repeat",recurrence_days AS "repeatDays",to_char(recurrence_until,'YYYY-MM-DD') AS "repeatUntil"`;

app.get('/api/tasks',asyncRoute(async(req,res)=>{
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
}));

app.patch('/api/recurring-tasks/:id/:date/toggle',uuidRoute,asyncRoute(async(req,res)=>{
  const date=dateString.safeParse(req.params.date);
  if(!date.success) return res.status(400).json({error:'Data inválida.'});
  const found=(await db.query(`SELECT to_char(due_date,'YYYY-MM-DD') AS start,recurrence_type AS "repeat",recurrence_days AS "repeatDays",to_char(recurrence_until,'YYYY-MM-DD') AS "repeatUntil" FROM tasks WHERE id=$1 AND user_id=$2`,[req.params.id,req.user.id])).rows[0];
  if(!found || found.repeat==='none' || !recurringDates(found,found.start,date.data,date.data).length) return res.status(404).json({error:'Ocorrência não encontrada.'});
  const row=(await db.query(`INSERT INTO task_occurrences(task_id,occurrence_date,completed,completed_at) VALUES($1,$2,TRUE,NOW()) ON CONFLICT(task_id,occurrence_date) DO UPDATE SET completed=NOT task_occurrences.completed,completed_at=CASE WHEN NOT task_occurrences.completed THEN NOW() ELSE NULL END RETURNING completed`,[req.params.id,date.data])).rows[0];
  res.json({completed:row.completed});
}));
app.delete('/api/recurring-tasks/:id/:date',uuidRoute,asyncRoute(async(req,res)=>{
  const date=dateString.safeParse(req.params.date);
  if(!date.success) return res.status(400).json({error:'Data inválida.'});
  const found=(await db.query("SELECT id FROM tasks WHERE id=$1 AND user_id=$2 AND recurrence_type<>'none'",[req.params.id,req.user.id])).rowCount;
  if(!found) return res.status(404).json({error:'Série não encontrada.'});
  await db.query(`INSERT INTO task_occurrences(task_id,occurrence_date,cancelled) VALUES($1,$2,TRUE) ON CONFLICT(task_id,occurrence_date) DO UPDATE SET cancelled=TRUE`,[req.params.id,date.data]);
  res.json({ok:true});
}));

app.post(
  "/api/tasks",
  asyncRoute(async (req, res) => {
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
  }),
);
app.put(
  "/api/tasks/:id",
  uuidRoute,
  asyncRoute(async (req, res) => {
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
  }),
);
app.patch(
  "/api/tasks/:id/date",
  uuidRoute,
  asyncRoute(async (req, res) => {
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
  }),
);
app.patch(
  "/api/tasks/:id/toggle",
  uuidRoute,
  asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      `UPDATE tasks SET completed=NOT completed, completed_at=CASE WHEN completed THEN NULL ELSE NOW() END, updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING ${taskColumns}`,
      [req.params.id, req.user.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Tarefa não encontrada." });
    res.json(rows[0]);
  }),
);
app.delete(
  "/api/tasks/:id",
  uuidRoute,
  asyncRoute(async (req, res) => {
    const result = await db.query(
      "DELETE FROM tasks WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Tarefa não encontrada." });
    res.json({ ok: true });
  }),
);

const daysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine(
    (days) => new Set(days).size === days.length,
    "Escolha dias diferentes.",
  );
const habitSchema = z
  .object({
    name: safeText(100),
    scheduleDays: daysSchema,
    preferredTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido.")
      .nullable()
      .default(null),
    goalPerWeek: z.number().int().min(1).max(7),
    routineId: z.string().uuid().nullable().default(null),
  })
  .strict()
  .refine((v) => v.goalPerWeek <= v.scheduleDays.length, {
    message: "A meta semanal não pode superar a quantidade de dias planejados.",
  });
const habitFields = `id,name,schedule_days AS "scheduleDays",to_char(preferred_time,'HH24:MI') AS "preferredTime",goal_per_week AS "goalPerWeek",routine_id AS "routineId",position,to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS "createdDate"`;
const routineSchema = z
  .object({
    name: safeText(100),
    period: z.enum(["morning", "evening", "flexible"]).default("flexible"),
    description: z.string().trim().max(240).default(""),
  })
  .strict();

async function ensureUserRoutine(routineId, userId) {
  if (!routineId) return true;
  const found = await db.query(
    "SELECT 1 FROM routines WHERE id=$1 AND user_id=$2",
    [routineId, userId],
  );
  return found.rowCount > 0;
}

app.get(
  "/api/routines",
  asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      "SELECT id,name,period,description FROM routines WHERE user_id=$1 ORDER BY created_at ASC",
      [req.user.id],
    );
    res.json(rows);
  }),
);
app.post(
  "/api/routines",
  asyncRoute(async (req, res) => {
    const body = validate(routineSchema, req, res);
    if (!body) return;
    const { rows } = await db.query(
      "INSERT INTO routines(id,user_id,name,period,description) VALUES($1,$2,$3,$4,$5) RETURNING id,name,period,description",
      [randomUUID(), req.user.id, body.name, body.period, body.description],
    );
    res.status(201).json(rows[0]);
  }),
);
app.put(
  "/api/routines/:id",
  uuidRoute,
  asyncRoute(async (req, res) => {
    const body = validate(routineSchema, req, res);
    if (!body) return;
    const { rows } = await db.query(
      "UPDATE routines SET name=$1,period=$2,description=$3 WHERE id=$4 AND user_id=$5 RETURNING id,name,period,description",
      [body.name, body.period, body.description, req.params.id, req.user.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Rotina não encontrada." });
    res.json(rows[0]);
  }),
);
app.delete(
  "/api/routines/:id",
  uuidRoute,
  asyncRoute(async (req, res) => {
    const result = await db.query(
      "DELETE FROM routines WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Rotina não encontrada." });
    res.json({ ok: true });
  }),
);

app.get(
  "/api/habits",
  asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${habitFields} FROM habits WHERE user_id=$1 ORDER BY position ASC,created_at ASC LIMIT 100`,
      [req.user.id],
    );
    const entries = await db.query(
      `SELECT e.habit_id AS "habitId", to_char(e.entry_date,'YYYY-MM-DD') AS date FROM habit_entries e INNER JOIN habits h ON h.id=e.habit_id WHERE h.user_id=$1 AND e.entry_date >= (CURRENT_DATE - INTERVAL '90 days')`,
      [req.user.id],
    );
    res.json({ habits: rows, entries: entries.rows });
  }),
);
app.post(
  "/api/habits",
  asyncRoute(async (req, res) => {
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
  }),
);
app.put(
  "/api/habits/:id",
  uuidRoute,
  asyncRoute(async (req, res) => {
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
  }),
);
app.post(
  "/api/habits/:id/check",
  uuidRoute,
  asyncRoute(async (req, res) => {
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
  }),
);
app.delete(
  "/api/habits/:id",
  uuidRoute,
  asyncRoute(async (req, res) => {
    const result = await db.query(
      "DELETE FROM habits WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Hábito não encontrado." });
    res.json({ ok: true });
  }),
);

const categoryName = safeText(40);
const categoryColor = z.string().regex(/^#[0-9a-fA-F]{6}$/,'Cor inválida.');
const categorySchema = z.object({name:categoryName,color:categoryColor}).strict();
const categoryFields = `id,name,color,legacy_key AS "legacyKey"`;
app.get('/api/event-categories',asyncRoute(async(req,res)=>{
  const {rows}=await db.query(`SELECT ${categoryFields} FROM event_categories WHERE user_id=$1 ORDER BY created_at ASC`,[req.user.id]);
  res.json(rows);
}));
app.post('/api/event-categories',asyncRoute(async(req,res)=>{
  const b=validate(categorySchema,req,res); if(!b)return;
  try{
    const {rows}=await db.query(`INSERT INTO event_categories(id,user_id,name,color) VALUES($1,$2,$3,$4) RETURNING ${categoryFields}`,[randomUUID(),req.user.id,b.name,b.color]);
    res.status(201).json(rows[0]);
  } catch(e) {if(e.code==='23505') return res.status(409).json({error:'Você já tem um bloco com esse nome.'});throw e;}
}));
app.put('/api/event-categories/:id',uuidRoute,asyncRoute(async(req,res)=>{
  const b=validate(categorySchema,req,res);if(!b)return;
  try{
    const {rows}=await db.query(`UPDATE event_categories SET name=$1,color=$2 WHERE id=$3 AND user_id=$4 RETURNING ${categoryFields}`,[b.name,b.color,req.params.id,req.user.id]);
    if(!rows[0])return res.status(404).json({error:'Bloco não encontrado.'});
    res.json(rows[0]);
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'Você já tem um bloco com esse nome.'});throw e;}
}));
app.delete('/api/event-categories/:id',uuidRoute,asyncRoute(async(req,res)=>{
  const used=(await db.query('SELECT 1 FROM events WHERE user_id=$1 AND category_id=$2 LIMIT 1',[req.user.id,req.params.id])).rowCount;
  if(used)return res.status(409).json({error:'Este bloco possui compromissos. Mova-os para outro bloco antes de excluir.'});
  const result=await db.query('DELETE FROM event_categories WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
  if(!result.rowCount)return res.status(404).json({error:'Bloco não encontrado.'});
  res.json({ok:true});
}));

const eventFields = `e.id,e.title,e.starts_at AS "startsAt",e.ends_at AS "endsAt",e.notes,e.category_id AS "categoryId",c.name AS "categoryName",c.color AS "categoryColor",e.time_mode AS "timeMode",e.recurrence_type AS "repeat",e.recurrence_days AS "repeatDays",to_char(e.recurrence_until,'YYYY-MM-DD') AS "repeatUntil"`;
const eventQueryBase=`SELECT ${eventFields} FROM events e LEFT JOIN event_categories c ON c.id=e.category_id`;
const eventSchema=z.object({
  title:safeText(160),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),
  notes:z.string().max(2000).default(''),categoryId:z.string().uuid(),timeMode:z.enum(['exact','all_day','morning','afternoon','night']).default('exact'),...recurrenceFields
}).strict().refine(v=>new Date(v.endsAt)>new Date(v.startsAt),{message:'O término deve ser depois do início.'})
.refine(v=>validEventWindow(v),{message:'Os horários não correspondem ao período escolhido.'})
.refine(v=>recurrenceValid(v,localDate(v.startsAt)),{message:'Escolha uma repetição válida.'});
async function ownedCategory(categoryId,userId){
  return (await db.query('SELECT id,legacy_key FROM event_categories WHERE id=$1 AND user_id=$2',[categoryId,userId])).rows[0];
}
const eventRangeSchema=z.object({from:z.string().datetime({offset:true}),to:z.string().datetime({offset:true})}).strict();
async function fetchEvents(userId,fromInstant,toInstant){
  const from=localDate(fromInstant); const to=localDate(toInstant);
  const rows=(await db.query(`${eventQueryBase} WHERE e.user_id=$1 AND ((e.recurrence_type='none' AND e.starts_at<$3 AND e.ends_at>$2) OR (e.recurrence_type<>'none' AND e.starts_at<$3 AND (e.recurrence_until IS NULL OR e.recurrence_until>=$4))) ORDER BY e.starts_at ASC LIMIT 500`,[userId,fromInstant,toInstant,from])).rows;
  const repeating=rows.filter(e=>e.repeat!=='none');
  const cancellations=repeating.length?(await db.query(`SELECT event_id AS id,to_char(occurrence_date,'YYYY-MM-DD') AS date FROM event_cancellations WHERE event_id=ANY($1::uuid[]) AND occurrence_date BETWEEN $2 AND $3`,[repeating.map(e=>e.id),addDays(from,-2),to])).rows:[];
  const cancelled=new Set(cancellations.map(e=>`${e.id}@${e.date}`));
  const output=[];
  for(const e of rows){
    if(e.repeat==='none'){output.push({...e,isRecurring:false});continue;}
    const base=localDate(e.startsAt);
    for(const day of recurringDates(e,base,addDays(from,-2),to)){
      if(cancelled.has(`${e.id}@${day}`))continue;
      const startsAt=occurrenceTimestamp(e.startsAt,base,day);
      const endsAt=occurrenceTimestamp(e.endsAt,base,day);
      if(new Date(startsAt)>=new Date(toInstant)||new Date(endsAt)<=new Date(fromInstant))continue;
      output.push({...e,id:`${e.id}@${day}`,seriesId:e.id,occurrenceDate:day,seriesStartsAt:e.startsAt,seriesEndsAt:e.endsAt,startsAt,endsAt,isRecurring:true});
      if(output.length>=1200)break;
    }
    if(output.length>=1200)break;
  }
  return output.sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
}
app.get('/api/events',asyncRoute(async(req,res)=>{
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
}));
app.post('/api/events',asyncRoute(async(req,res)=>{
  const b=validate(eventSchema,req,res);if(!b)return;
  const category=await ownedCategory(b.categoryId,req.user.id);
  if(!category)return res.status(400).json({error:'Bloco inválido.'});
  const id=randomUUID();
  await db.query(`INSERT INTO events(id,user_id,title,starts_at,ends_at,notes,category,category_id,recurrence_type,recurrence_days,recurrence_until,time_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,req.user.id,b.title,b.startsAt,b.endsAt,b.notes,category.legacy_key||'other',b.categoryId,b.repeat,b.repeatDays,b.repeatUntil,b.timeMode]);
  const row=(await db.query(`${eventQueryBase} WHERE e.id=$1 AND e.user_id=$2`,[id,req.user.id])).rows[0];
  res.status(201).json(row);
}));
app.put('/api/events/:id',uuidRoute,asyncRoute(async(req,res)=>{
  const b=validate(eventSchema,req,res);if(!b)return;
  const category=await ownedCategory(b.categoryId,req.user.id);
  if(!category)return res.status(400).json({error:'Bloco inválido.'});
  const updated=await db.query(`UPDATE events SET title=$1,starts_at=$2,ends_at=$3,notes=$4,category=$5,category_id=$6,recurrence_type=$7,recurrence_days=$8,recurrence_until=$9,time_mode=$10 WHERE id=$11 AND user_id=$12`,[b.title,b.startsAt,b.endsAt,b.notes,category.legacy_key||'other',b.categoryId,b.repeat,b.repeatDays,b.repeatUntil,b.timeMode,req.params.id,req.user.id]);
  if(!updated.rowCount)return res.status(404).json({error:'Compromisso não encontrado.'});
  res.json((await db.query(`${eventQueryBase} WHERE e.id=$1 AND e.user_id=$2`,[req.params.id,req.user.id])).rows[0]);
}));
app.delete('/api/events/:id/occurrences/:date',uuidRoute,asyncRoute(async(req,res)=>{
  const date=dateString.safeParse(req.params.date);
  if(!date.success)return res.status(400).json({error:'Data inválida.'});
  const found=(await db.query(`SELECT e.id FROM events e WHERE e.id=$1 AND e.user_id=$2 AND e.recurrence_type<>'none'`,[req.params.id,req.user.id])).rowCount;
  if(!found)return res.status(404).json({error:'Série não encontrada.'});
  await db.query('INSERT INTO event_cancellations(event_id,occurrence_date) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,date.data]);
  res.json({ok:true});
}));
app.delete('/api/events/:id',uuidRoute,asyncRoute(async(req,res)=>{
  const result=await db.query('DELETE FROM events WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
  if(!result.rowCount)return res.status(404).json({error:'Compromisso não encontrado.'});
  res.json({ok:true});
}));

app.get(
  "/api/insights",
  asyncRoute(async (req, res) => {
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
  }),
);

require("./focus-routes")(app, db, asyncRoute, uuidRoute);

app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Rota não encontrada." }),
);
app.use((_req, res) => res.status(404).send("Página não encontrada."));
app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith("/api/"))
    return res.status(500).json({ error: "Ocorreu um erro inesperado." });
  return res.status(500).send("Ocorreu um erro inesperado.");
});

app.listen(PORT, () =>
  console.log(`Pattern disponível em http://localhost:${PORT}`),
);
