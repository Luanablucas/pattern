'use strict';
// Gregorian dates in YYYY-MM-DD. Day-of-week follows JavaScript (Sunday = 0).
const DAY_MS = 86400000;
const validISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s;
const asUTC = s => new Date(s+'T12:00:00Z');
const toISO = d => d.toISOString().slice(0,10);
function addDays(s,n) { const d=asUTC(s); d.setUTCDate(d.getUTCDate()+n); return toISO(d); }
function localDate(instant, timeZone='America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));
}
function occurrences({start,until=null,type='none',days=[],from,to}) {
  if (![start,from,to].every(validISO) || (until && !validISO(until)) || from>to || (until && until<start)) return [];
  const left = from>start ? from : start;
  const right = until && until<to ? until : to;
  if (left>right) return [];
  const startDay = asUTC(start).getUTCDate();
  const beginMonth = start.slice(0,7);
  const result=[];
  for (let d=left,limit=0;d<=right && limit<370;d=addDays(d,1),limit++) {
    const date=asUTC(d); const weekday=date.getUTCDay();
    const matched= type==='daily' ||
      (type==='weekly' && days.includes(weekday)) ||
      (type==='monthly' && date.getUTCDate()===startDay) ||
      (type==='none' && d===start);
    if (matched) result.push(d);
  }
  return result;
}
function occurrenceTimestamp(baseInstant,originalDay,targetDay) {
  const delta=Math.round((asUTC(targetDay)-asUTC(originalDay))/DAY_MS);
  return new Date(new Date(baseInstant).getTime()+delta*DAY_MS).toISOString();
}
module.exports={validISO,addDays,localDate,occurrences,occurrenceTimestamp};
