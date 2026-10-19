'use strict';
const { addDays } = require('./recurrence-utils');
const modes=['exact','all_day','morning','afternoon','night'];
function validEventWindow(event,timeZone='America/Sao_Paulo'){
  if(!modes.includes(event.timeMode))return false;
  const start=new Date(event.startsAt),end=new Date(event.endsAt);
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)return false;
  if(event.timeMode==='exact')return true;
  const partsOf=(value)=>{
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(value);
    const get=type=>parts.find(p=>p.type===type)?.value;
    return {day:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
  };
  const a=partsOf(start),b=partsOf(end),next=addDays(a.day,1);
  const windows={all_day:['00:00','00:00',next],morning:['06:00','12:00',a.day],afternoon:['12:00','18:00',a.day],night:['18:00','00:00',next]};
  const [startTime,endTime,endDay]=windows[event.timeMode];
  return a.time===startTime&&b.time===endTime&&b.day===endDay;
}
module.exports={validEventWindow};
