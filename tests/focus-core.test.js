"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { secondsBetween, effectiveSeconds, remainingSeconds, prettySeconds } = require("../public/js/focus-core");

const base = {
  mode: "pomodoro",
  plannedSeconds: 1500,
  elapsedSeconds: 300,
  status: "running",
  activeSince: "2026-10-19T13:00:00.000Z"
};

test("o timer ativo combina tempo já salvo com intervalo corrente", () => {
  assert.equal(effectiveSeconds(base, "2026-10-19T13:02:05.000Z"), 425);
  assert.equal(remainingSeconds(base, "2026-10-19T13:02:05.000Z"), 1075);
});

test("a duração de um Pomodoro não ultrapassa a meta", () => {
  assert.equal(effectiveSeconds(base, "2026-10-19T13:45:00.000Z"), 1500);
  assert.equal(remainingSeconds(base, "2026-10-19T13:45:00.000Z"), 0);
});

test("uma sessão pausada mantém o tempo de foco sem somar a pausa", () => {
  assert.equal(effectiveSeconds({ ...base, status: "paused", activeSince: null }, "2026-10-19T14:15:00.000Z"), 300);
});

test("o cronômetro livre não tem limite de duração", () => {
  const free = { mode: "free", status: "running", activeSince: "2026-10-19T13:00:00.000Z", elapsedSeconds: 7200 };
  assert.equal(effectiveSeconds(free, "2026-10-19T13:30:00.000Z"), 9000);
});

test("datas inválidas e valores negativos não geram tempo incorreto", () => {
  assert.equal(secondsBetween("invalida", "2026-10-19T13:00:00Z"), 0);
  assert.equal(secondsBetween("2026-10-19T13:05:00Z", "2026-10-19T13:00:00Z"), 0);
});

test("o tempo é apresentado em minutos, segundos ou horas", () => {
  assert.equal(prettySeconds(65), "01:05");
  assert.equal(prettySeconds(3661), "01:01:01");
  assert.equal(prettySeconds(-10), "00:00");
});
