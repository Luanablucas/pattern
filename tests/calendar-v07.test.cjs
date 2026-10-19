"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.join(__dirname,"..");
const id = "55555555-5555-4555-8555-555555555555";
const category = "11111111-1111-4111-8111-111111111111";
const at = (day,hour) => new Date(`${day}T${String(hour).padStart(2,"0")}:00:00-03:00`).toISOString();
const series = {id,title:"Aula",startsAt:at("2026-10-19",9),endsAt:at("2026-10-19",10),repeat:"daily",repeatDays:[],repeatUntil:null,timeMode:"exact",notes:"",categoryId:category};

function mocked(run) {
  const original=Module._load;
  const chain=new Proxy(function(){return chain;},{get(_,prop){if(prop==="safeParse")return data=>({success:true,data});return chain;},apply(){return chain;}});
  try {
    Module._load=function(request,parent,isMain){if(request==="zod")return {z:chain};return original.apply(this,arguments);};
    return run();
  } finally {Module._load=original;}
}

function service(rows,overrides=[],cancels=[]) {
  const query=async(sql)=>{
    if(sql.includes('FROM event_overrides o JOIN events'))return {rows:overrides};
    if(sql.includes('FROM event_cancellations WHERE'))return {rows:cancels};
    if(sql.includes('SELECT')&&sql.includes('FROM events e'))return {rows};
    return {rows:[]};
  };
  return mocked(()=>require('../src/services/events')({query}));
}

test('uma ocorrência movida não duplica o evento na data original',async()=>{
  const override={...series,seriesId:id,occurrenceDate:"2026-10-19",startsAt:at("2026-10-20",11),endsAt:at("2026-10-20",12)};
  const events=await service([series], [override]).fetchEvents('user',at('2026-10-19',0),at('2026-10-22',0));
  assert.equal(events.filter(e=>e.occurrenceDate==='2026-10-19').length,1);
  assert.equal(events.find(e=>e.occurrenceDate==='2026-10-19').startsAt,at('2026-10-20',11));
  assert.equal(events.length,3);
});

test('a data original é suprimida mesmo se a edição foi movida para fora do intervalo',async()=>{
  const override={...series,seriesId:id,occurrenceDate:'2026-10-19',startsAt:at('2026-11-12',10),endsAt:at('2026-11-12',11)};
  const events=await service([series],[override]).fetchEvents('user',at('2026-10-19',0),at('2026-10-21',0));
  assert.ok(!events.some(e=>e.occurrenceDate==='2026-10-19'));
  assert.equal(events.length,1);
});

test('exclusões de ocorrência também ocultam edições individuais',async()=>{
  const override={...series,seriesId:id,occurrenceDate:'2026-10-19',startsAt:at('2026-10-20',11),endsAt:at('2026-10-20',12)};
  const events=await service([series],[override],[{id,date:'2026-10-19'}]).fetchEvents('user',at('2026-10-19',0),at('2026-10-22',0));
  assert.ok(!events.some(e=>e.occurrenceDate==='2026-10-19'));
});

test('a edição individual exige uma data pertencente à série',()=>{
  const valid=service([]).validOccurrence;
  assert.ok(valid(series,'2026-10-20'));
  assert.ok(!valid({...series,repeat:'weekly',repeatDays:[1]},'2026-10-20'));
  assert.ok(!valid({...series,repeatUntil:'2026-10-21'},'2026-10-22'));
});

test('a migração e a interface de calendário estão no pacote',()=>{
  const schema=fs.readFileSync(path.join(root,'sql/schema.sql'),'utf8');
  const view=fs.readFileSync(path.join(root,'views/app.ejs'),'utf8');
  const app=fs.readFileSync(path.join(root,'public/js/app.js'),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS event_overrides/);
  assert.match(view,/data-calendar-view="day"/);
  assert.match(view,/id="eventEditScope"/);
  assert.match(app,/data-event-drag/);
  assert.match(app,/\/api\/focus\/calendar/);
  assert.match(app,/\/api\/events\/conflicts/);
});
