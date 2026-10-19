const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../public/js/habit-utils.js');

test('dias de semana seguem domingo=0, segunda=1',()=>{
  assert.equal(rules.weekday('2026-10-15'),4);
  assert.equal(rules.weekday('2026-10-18'),0);
  assert.deepEqual(rules.weekDates('2026-10-15'),[
    '2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'
  ]);
});
test('frequência personalizada respeita criação do hábito',()=>{
  const h={scheduleDays:[1,3,5],createdDate:'2026-10-13'};
  assert.equal(rules.isScheduled(h,'2026-10-12'),false);
  assert.equal(rules.isScheduled(h,'2026-10-14'),true);
  assert.equal(rules.isScheduled(h,'2026-10-15'),false);
});
test('streak não penaliza hoje ainda aberto e ignora dias de folga',()=>{
  const h={scheduleDays:[1,3,5],createdDate:'2026-10-01'};
  const marks=new Set(['2026-10-09','2026-10-12','2026-10-14']);
  assert.equal(rules.streak(h,marks,'2026-10-15'),3);
  assert.equal(rules.streak(h,marks,'2026-10-16'),3); 
  assert.equal(rules.streak(h,marks,'2026-10-17'),0); 
});
test('resumo contabiliza só dias planejados já decorridos na semana',()=>{
  const h={scheduleDays:[1,3,5],goalPerWeek:2,createdDate:'2026-10-01'};
  const s=rules.weekSummary(h,new Set(['2026-10-12']), '2026-10-15');
  assert.deepEqual(s,{checked:1,planned:2,goal:2});
});
