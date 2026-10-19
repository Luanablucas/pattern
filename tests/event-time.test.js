'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validEventWindow}=require('../event-time-utils');
const row=(timeMode,startsAt,endsAt)=>({timeMode,startsAt,endsAt});
test('dia inteiro ocupa exatamente um dia',()=>{
 assert.equal(validEventWindow(row('all_day','2026-10-19T03:00:00Z','2026-10-20T03:00:00Z')),true);
 assert.equal(validEventWindow(row('all_day','2026-10-19T03:00:00Z','2026-10-19T23:00:00Z')),false);
});
test('manhã de 06 até 12',()=>{
 assert.equal(validEventWindow(row('morning','2026-10-19T09:00:00Z','2026-10-19T15:00:00Z')),true);
 assert.equal(validEventWindow(row('morning','2026-10-19T10:00:00Z','2026-10-19T15:00:00Z')),false);
});
test('tarde de 12 até 18',()=>{
 assert.equal(validEventWindow(row('afternoon','2026-10-19T15:00:00Z','2026-10-19T21:00:00Z')),true);
 assert.equal(validEventWindow(row('afternoon','2026-10-19T15:00:00Z','2026-10-19T22:00:00Z')),false);
});
test('noite de 18 até meia-noite do dia seguinte',()=>{
 assert.equal(validEventWindow(row('night','2026-10-19T21:00:00Z','2026-10-20T03:00:00Z')),true);
 assert.equal(validEventWindow(row('night','2026-10-19T21:00:00Z','2026-10-19T23:59:00Z')),false);
});
test('horário exato mantém duração customizada',()=>{
 assert.equal(validEventWindow(row('exact','2026-10-19T17:00:00Z','2026-10-19T17:30:00Z')),true);
 assert.equal(validEventWindow(row('exact','2026-10-19T17:30:00Z','2026-10-19T17:00:00Z')),false);
});
