"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { rangeDates, combineDaily, summarize, compare, overlapSeconds, summarizeCategories } = require("../src/services/analytics");

test("períodos preservam datas contínuas mesmo na mudança de ano", () => {
  assert.deepEqual(rangeDates("2026-01-02", 4), ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
});

test("composição inclui tarefas recorrentes registradas e foco concluído", () => {
  const dates = ["2026-10-18", "2026-10-19"];
  const rows = combineDaily(dates, [{ date: dates[0], completed: 2 }], [{ date: dates[0], seconds: "3660", sessions: 2 }], [{ id: "a", created: "2026-10-01", days: [0, 1] }], [{ id: "a", date: dates[1] }]);
  assert.deepEqual(rows.map(row => [row.tasksCompleted, row.focusSeconds, row.habitsPlanned, row.habitsCompleted]), [[2, 3660, 1, 0], [0, 0, 1, 1]]);
  assert.deepEqual(summarize(rows), { tasksCompleted: 2, focusSeconds: 3660, focusSessions: 2, focusDays: 1, habitsPlanned: 2, habitsCompleted: 1, habitRate: 50 });
});

test("dia sem hábito planejado não vira falha nem divisão por zero", () => {
  const result = summarize(combineDaily(["2026-10-19"], [], [], [], []));
  assert.equal(result.habitRate, null);
  assert.equal(result.focusSeconds, 0);
});

test("período anterior vazio não vira crescimento infinito", () => {
  assert.equal(compare({ focusSeconds: 600, focusSessions: 2, tasksCompleted: 3 }, { focusSeconds: 0, focusSessions: 0, tasksCompleted: 0 }).focusSeconds, null);
  assert.equal(compare({ focusSeconds: 300, focusSessions: 1, tasksCompleted: 1 }, { focusSeconds: 600, focusSessions: 2, tasksCompleted: 2 }).focusSeconds, -50);
});

test("compromissos distribuídos em blocos respeitam os limites do período", () => {
  const chunks = [
    { from: "2026-10-19T03:00:00Z", to: "2026-10-20T03:00:00Z", events: [{ id: "x", categoryId: "b", categoryName: "Amigos", categoryColor: "#abcDEF", startsAt: "2026-10-19T00:00:00Z", endsAt: "2026-10-20T06:00:00Z" }] },
    { from: "2026-10-20T03:00:00Z", to: "2026-10-21T03:00:00Z", events: [{ id: "x", categoryId: "b", categoryName: "Amigos", categoryColor: "#abcDEF", startsAt: "2026-10-19T00:00:00Z", endsAt: "2026-10-20T06:00:00Z" }] }
  ];
  assert.equal(overlapSeconds("2026-10-19T00:00:00Z", "2026-10-20T06:00:00Z", chunks[0].from, chunks[0].to), 86400);
  assert.deepEqual(summarizeCategories(chunks), [{ id: "b", name: "Amigos", color: "#abcDEF", seconds: 97200, events: 1 }]);
});
