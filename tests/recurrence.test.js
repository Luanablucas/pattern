'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {occurrences,addDays,localDate,occurrenceTimestamp,validISO}=require('../recurrence-utils');
const generate=(type,start,from,to,days=[],until=null)=>occurrences({type,start,from,to,days,until});
test('diária dentro do intervalo, sem dias anteriores ao início',()=>{
 assert.deepEqual(generate('daily','2026-10-19','2026-10-17','2026-10-21'),['2026-10-19','2026-10-20','2026-10-21']);
});
test('semanal respeita a seleção de dias',()=>{
 assert.deepEqual(generate('weekly','2026-10-19','2026-10-19','2026-10-25',[1,3,5]),['2026-10-19','2026-10-21','2026-10-23']);
});
test('mensal mantém o mesmo dia e não move 31 para 30',()=>{
 assert.deepEqual(generate('monthly','2026-01-31','2026-01-01','2026-04-30'),['2026-01-31','2026-03-31']);
});
test('fim de repetição é inclusivo',()=>{
 assert.deepEqual(generate('daily','2026-10-19','2026-10-19','2026-10-25',[],'2026-10-21'),['2026-10-19','2026-10-20','2026-10-21']);
});
test('não há geração de ocorrências inválidas, intervalos invertidos ou fora da série',()=>{
 assert.deepEqual(generate('daily','2026-10-19','2026-10-25','2026-10-21'),[]);
 assert.deepEqual(generate('weekly','2026-10-19','2026-10-19','2026-10-31',[]),[]);
 assert.deepEqual(generate('daily','2026-10-19','2026-10-19','2026-10-31',[],'2026-10-18'),[]);
});
test('evento de múltiplas horas mantém a duração a cada ocorrência',()=>{
 const start='2026-10-19T17:00:00.000Z',end='2026-10-19T18:30:00.000Z';
 const next=occurrenceTimestamp(start,'2026-10-19','2026-10-26');
 const nextEnd=occurrenceTimestamp(end,'2026-10-19','2026-10-26');
 assert.equal((new Date(nextEnd)-new Date(next))/60000,90);
 assert.equal(localDate(next),'2026-10-26');
});
test('cálculos de data atravessam meses e ano',()=>{
 assert.equal(addDays('2026-12-31',1),'2027-01-01');
 assert.equal(addDays('2026-03-01',-1),'2026-02-28');
 assert.equal(validISO('2026-02-30'),false);
});
