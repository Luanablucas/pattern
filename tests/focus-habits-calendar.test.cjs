"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const habits = require("../public/js/habit-utils");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root,name),"utf8");

test("hábito aparece apenas nos dias programados e depois da criação", () => {
  const gym = {name:"Academia",scheduleDays:[1,3,5],createdDate:"2026-10-26",preferredTime:"18:00"};
  assert.equal(habits.isScheduled(gym,"2026-10-25"),false);
  assert.equal(habits.isScheduled(gym,"2026-10-26"),true);
  assert.equal(habits.isScheduled(gym,"2026-10-27"),false);
  assert.equal(habits.isScheduled(gym,"2026-10-28"),true);
});

test("hábito sem horário mantém programação e não ocupa o dia inteiro", () => {
  const reading = {name:"Leitura",scheduleDays:[0,1,2,3,4,5,6],createdDate:"2026-10-29",preferredTime:null};
  assert.equal(habits.isScheduled(reading,"2026-10-29"),true);
  const calendar = read("public/js/app.js");
  assert.match(calendar,/const time = habit\.preferredTime \|\| "Sem horário"/);
  assert.match(calendar,/habits\.map\(habit => habitCalendarCard/);
  assert.doesNotMatch(calendar,/kind:'habit',startsAt:/);
});

test("cronômetro distingue tarefas, hábitos e sessão sem vínculo", () => {
  const focus = read("public/js/focus.js");
  assert.match(focus,/value="habit:\$\{safe\(habit\.id\)\}"/);
  assert.match(focus,/value="task:\$\{safe\(id\)\}"/);
  assert.match(focus,/habitId: type === "habit" \? id : null/);
  assert.match(focus,/taskId: type === "task" \? id : null/);
  const controller = read("src/controllers/focus.js");
  assert.match(controller,/value\.taskId && value\.habitId/);
  assert.match(controller,/SELECT name FROM habits WHERE id=\$1 AND user_id=\$2/);
  assert.match(controller,/habit_title AS "habitTitle"/);
});

test("migração incremental mantém sessões antigas e vincula hábitos sem excluir históricos", () => {
  const sql = read("sql/schema.sql");
  assert.match(sql,/ADD COLUMN IF NOT EXISTS habit_id UUID REFERENCES habits\(id\) ON DELETE SET NULL/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS habit_title VARCHAR\(100\)/);
  assert.match(sql,/CONSTRAINT focus_single_target_check CHECK \(task_id IS NULL OR habit_id IS NULL\)/);
  assert.match(read("views/app.ejs"),/id="focusTarget"/);
});
