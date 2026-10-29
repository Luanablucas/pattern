"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { eventSchema, eventConflictSchema } = require("../src/validation/events");
const createEventsController = require("../src/controllers/events");

const example = {
  title: "Aniversário",
  startsAt: "2026-11-07T14:00:00-03:00",
  endsAt: "2026-11-07T23:00:00-03:00",
  notes: "",
  categoryId: "651ea5af-5424-4b54-8d8d-6c7dbef1c83a",
  timeMode: "exact",
  repeat: "none",
  repeatDays: [],
  repeatUntil: null
};

test("compromisso válido continua aceito para criação", () => {
  assert.equal(eventSchema.safeParse(example).success, true);
});

test("verificação de conflitos aceita os campos opcionais de edição", () => {
  const newEvent = eventConflictSchema.safeParse({ ...example, excludeId: null, excludeOccurrence: null });
  assert.equal(newEvent.success, true);
  const editedEvent = eventConflictSchema.safeParse({ ...example, excludeId: example.categoryId, excludeOccurrence: "2026-11-07" });
  assert.equal(editedEvent.success, true);
  const omitted = eventConflictSchema.safeParse(example);
  assert.equal(omitted.success, true);
  assert.equal(omitted.data.excludeId, null);
  assert.equal(omitted.data.excludeOccurrence, null);
});

test("regras de horário e recorrência permanecem iguais nas duas validações", () => {
  const invalidWindows = [
    { ...example, startsAt: example.endsAt, endsAt: example.startsAt },
    { ...example, repeat: "weekly", repeatDays: [] },
    { ...example, unexpected: true }
  ];
  for (const value of invalidWindows) {
    assert.equal(eventSchema.safeParse(value).success, false);
    assert.equal(eventConflictSchema.safeParse(value).success, false);
  }
  assert.equal(eventConflictSchema.safeParse({ ...example, excludeOccurrence: "2026-02-30" }).success, false);
});

test("rota de conflitos retorna lista vazia quando não há sobreposição", async () => {
  const db = { query: async () => ({ rows: [], rowCount: 0 }) };
  const controller = createEventsController(db);
  let statusCode = 200;
  let response;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { response = data; return this; }
  };
  await controller.conflicts({ body: { ...example, excludeId: null, excludeOccurrence: null }, user: { id: "user-id" } }, res);
  assert.equal(statusCode, 200);
  assert.deepEqual(response, { count: 0, conflicts: [] });
});
