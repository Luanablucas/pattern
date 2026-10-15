'use strict';
require('dotenv').config();

const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres no arquivo .env');
}
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no arquivo .env');

const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 3000);
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000
};
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Data inválida');
const safeText = (max) => z.string().trim().min(1).max(max);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '24kb' }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '2h' }));

// Restrição adicional para alterações autenticadas por cookie.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' });
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origem inválida.' });
      } catch (_) { return res.status(403).json({ error: 'Origem inválida.' }); }
    }
  }
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
function getUser(req) {
  const token = req.cookies.pattern_token;
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch (_) { return null; }
}
function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = user;
  next();
}
function requirePageAuth(req, res, next) {
  req.user = getUser(req);
  if (!req.user) return res.redirect('/login');
  res.set('Cache-Control', 'no-store');
  next();
}
function issueCookie(res, user) {
  const token = jwt.sign({ id: user.id, name: user.name }, process.env.JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
  res.cookie('pattern_token', token, cookieOptions);
}
function validate(schema, req, res) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0]?.message || 'Dados inválidos.' });
    return null;
  }
  return result.data;
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const uuidRoute = (req, res, next) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Identificador inválido.' });
  next();
};

app.get('/', (req, res) => res.redirect(getUser(req) ? '/app' : '/login'));
app.get('/login', (req, res) => res.render('auth', { mode: 'login' }));
app.get('/register', (req, res) => res.render('auth', { mode: 'register' }));
const pages = ['app', 'tasks', 'calendar', 'habits', 'insights'];
app.get('/:page', requirePageAuth, (req, res, next) => {
  if (!pages.includes(req.params.page)) return next();
  res.render('app', { page: req.params.page, name: req.user.name });
});

app.post('/api/auth/register', authLimiter, asyncRoute(async (req, res) => {
  const body = validate(z.object({
    name: safeText(80),
    email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
    password: z.string().min(8, 'A senha precisa ter 8 caracteres ou mais.').max(72)
  }).strict(), req, res);
  if (!body) return;
  const user = { id: randomUUID(), name: body.name, email: body.email };
  const hash = await bcrypt.hash(body.password, 12);
  try {
    await db.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)', [user.id, user.name, user.email, hash]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    throw err;
  }
  issueCookie(res, user);
  res.status(201).json({ ok: true });
}));
app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const body = validate(z.object({ email: z.string().trim().email().transform((v) => v.toLowerCase()), password: z.string() }).strict(), req, res);
  if (!body) return;
  const { rows } = await db.query('SELECT id,name,password_hash FROM users WHERE email=$1', [body.email]);
  const valid = rows[0] && await bcrypt.compare(body.password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  issueCookie(res, rows[0]);
  res.json({ ok: true });
}));
app.post('/api/auth/logout', requireAuth, (req, res) => {
  res.clearCookie('pattern_token', { path: '/', sameSite: cookieOptions.sameSite, secure: cookieOptions.secure, httpOnly: true });
  res.json({ ok: true });
});

app.use('/api', requireAuth);

const taskSchema = z.object({
  title: safeText(160),
  notes: z.string().max(2000).default(''),
  dueDate: dateString.nullable().default(null),
  priority: z.enum(['low', 'medium', 'high']).default('medium')
}).strict();
const taskColumns = `id, title, notes, to_char(due_date,'YYYY-MM-DD') AS "dueDate", priority, completed, created_at AS "createdAt"`;
app.get('/api/tasks', asyncRoute(async (req, res) => {
  const { rows } = await db.query(`SELECT ${taskColumns} FROM tasks WHERE user_id=$1 ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC LIMIT 500`, [req.user.id]);
  res.json(rows);
}));
app.post('/api/tasks', asyncRoute(async (req, res) => {
  const body = validate(taskSchema, req, res);
  if (!body) return;
  const { rows } = await db.query(
    `INSERT INTO tasks(id,user_id,title,notes,due_date,priority) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${taskColumns}`,
    [randomUUID(), req.user.id, body.title, body.notes, body.dueDate, body.priority]);
  res.status(201).json(rows[0]);
}));
app.put('/api/tasks/:id', uuidRoute, asyncRoute(async (req, res) => {
  const body = validate(taskSchema, req, res);
  if (!body) return;
  const { rows } = await db.query(
    `UPDATE tasks SET title=$1,notes=$2,due_date=$3,priority=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING ${taskColumns}`,
    [body.title, body.notes, body.dueDate, body.priority, req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  res.json(rows[0]);
}));
// Alteração de data isolada: ideal para arrastar tarefas sem sobrescrever outros campos.
app.patch('/api/tasks/:id/date', uuidRoute, asyncRoute(async (req, res) => {
  const body = validate(z.object({ dueDate: dateString.nullable() }).strict(), req, res);
  if (!body) return;
  const { rows } = await db.query(
    `UPDATE tasks SET due_date=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING ${taskColumns}`,
    [body.dueDate, req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  res.json(rows[0]);
}));
app.patch('/api/tasks/:id/toggle', uuidRoute, asyncRoute(async (req, res) => {
  const { rows } = await db.query(
    `UPDATE tasks SET completed=NOT completed, completed_at=CASE WHEN completed THEN NULL ELSE NOW() END, updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING ${taskColumns}`,
    [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  res.json(rows[0]);
}));
app.delete('/api/tasks/:id', uuidRoute, asyncRoute(async (req, res) => {
  const result = await db.query('DELETE FROM tasks WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  res.json({ ok: true });
}));

app.get('/api/habits', asyncRoute(async (req, res) => {
  const { rows } = await db.query('SELECT id,name FROM habits WHERE user_id=$1 ORDER BY created_at ASC LIMIT 100', [req.user.id]);
  const entries = await db.query(
    `SELECT e.habit_id AS "habitId", to_char(e.entry_date,'YYYY-MM-DD') AS date FROM habit_entries e INNER JOIN habits h ON h.id=e.habit_id WHERE h.user_id=$1 AND e.entry_date >= (CURRENT_DATE - INTERVAL '90 days')`,
    [req.user.id]);
  res.json({ habits: rows, entries: entries.rows });
}));
app.post('/api/habits', asyncRoute(async (req, res) => {
  const body = validate(z.object({ name: safeText(100) }).strict(), req, res);
  if (!body) return;
  const { rows } = await db.query('INSERT INTO habits(id,user_id,name) VALUES($1,$2,$3) RETURNING id,name', [randomUUID(), req.user.id, body.name]);
  res.status(201).json(rows[0]);
}));
app.post('/api/habits/:id/check', uuidRoute, asyncRoute(async (req, res) => {
  const body = validate(z.object({ date: dateString }).strict(), req, res);
  if (!body) return;
  const checkDate = new Date(`${body.date}T12:00:00Z`);
  const today = new Date();
  const daysApart = Math.abs(checkDate - today) / (1000 * 60 * 60 * 24);
  if (daysApart > 92) return res.status(400).json({ error: 'Data fora do período permitido.' });
  const userHabit = await db.query('SELECT id FROM habits WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!userHabit.rowCount) return res.status(404).json({ error: 'Hábito não encontrado.' });
  const removed = await db.query('DELETE FROM habit_entries WHERE habit_id=$1 AND entry_date=$2 RETURNING habit_id', [req.params.id, body.date]);
  if (removed.rowCount) return res.json({ checked: false });
  await db.query('INSERT INTO habit_entries(habit_id,entry_date) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.params.id, body.date]);
  res.json({ checked: true });
}));
app.delete('/api/habits/:id', uuidRoute, asyncRoute(async (req, res) => {
  const result = await db.query('DELETE FROM habits WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Hábito não encontrado.' });
  res.json({ ok: true });
}));

const eventFields = 'id,title,starts_at AS "startsAt",ends_at AS "endsAt",notes,category';
const eventSchema = z.object({
  title: safeText(160),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).default(''),
  category: z.enum(['study', 'work', 'personal', 'health', 'other']).default('personal')
}).strict().refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'O término deve ser depois do início.' });

// A navegação por meses consulta somente o período visível, incluindo eventos que cruzam dias.
app.get('/api/events', asyncRoute(async (req, res) => {
  const { from, to } = req.query;
  if (from !== undefined || to !== undefined) {
    const range = z.object({
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true })
    }).strict().safeParse(req.query);
    if (!range.success) return res.status(400).json({ error: 'Período do calendário inválido.' });
    const start = new Date(range.data.from);
    const end = new Date(range.data.to);
    if (end <= start || (end - start) > 70 * 86400000) return res.status(400).json({ error: 'Informe um intervalo de até 70 dias.' });
    const { rows } = await db.query(
      `SELECT ${eventFields} FROM events WHERE user_id=$1 AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at ASC LIMIT 500`,
      [req.user.id, start.toISOString(), end.toISOString()]);
    return res.json(rows);
  }
  // Mantém o comportamento anterior para a página Hoje.
  const { rows } = await db.query(
    `SELECT ${eventFields} FROM events WHERE user_id=$1 AND ends_at > NOW()-INTERVAL '120 days' ORDER BY starts_at ASC LIMIT 500`,
    [req.user.id]);
  res.json(rows);
}));
app.post('/api/events', asyncRoute(async (req, res) => {
  const body = validate(eventSchema, req, res);
  if (!body) return;
  const { rows } = await db.query(
    `INSERT INTO events(id,user_id,title,starts_at,ends_at,notes,category) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${eventFields}`,
    [randomUUID(), req.user.id, body.title, body.startsAt, body.endsAt, body.notes, body.category]);
  res.status(201).json(rows[0]);
}));
app.put('/api/events/:id', uuidRoute, asyncRoute(async (req, res) => {
  const body = validate(eventSchema, req, res);
  if (!body) return;
  const { rows } = await db.query(
    `UPDATE events SET title=$1,starts_at=$2,ends_at=$3,notes=$4,category=$5 WHERE id=$6 AND user_id=$7 RETURNING ${eventFields}`,
    [body.title, body.startsAt, body.endsAt, body.notes, body.category, req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Compromisso não encontrado.' });
  res.json(rows[0]);
}));
app.delete('/api/events/:id', uuidRoute, asyncRoute(async (req, res) => {
  const result = await db.query('DELETE FROM events WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Compromisso não encontrado.' });
  res.json({ ok: true });
}));

app.get('/api/insights', asyncRoute(async (req, res) => {
  const sql = `WITH days AS (
    SELECT generate_series((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 13,
    (NOW() AT TIME ZONE 'America/Sao_Paulo')::date, INTERVAL '1 day')::date AS day
  ) SELECT to_char(days.day,'YYYY-MM-DD') AS date, COUNT(t.id)::int AS completed
  FROM days LEFT JOIN tasks t ON t.user_id=$1 AND (t.completed_at AT TIME ZONE 'America/Sao_Paulo')::date = days.day
  GROUP BY days.day ORDER BY days.day`;
  const { rows: days } = await db.query(sql, [req.user.id]);
  let analysis = null;
  let pythonOnline = false;
  try {
    const response = await fetch(`${process.env.PYTHON_API_URL || 'http://127.0.0.1:8001'}/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days }), signal: AbortSignal.timeout(1800)
    });
    if (response.ok) { analysis = await response.json(); pythonOnline = true; }
  } catch (_) { /* O app continua funcionando sem serviço de análises. */ }
  res.json({ days, analysis, pythonOnline });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((_req, res) => res.status(404).send('Página não encontrada.'));
app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Ocorreu um erro inesperado.' });
  return res.status(500).send('Ocorreu um erro inesperado.');
});

app.listen(PORT, () => console.log(`Pattern disponível em http://localhost:${PORT}`));
