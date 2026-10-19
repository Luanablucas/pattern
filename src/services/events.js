"use strict";
const { addDays,localDate,occurrenceTimestamp } = require("../../recurrence-utils");
const { recurringDates } = require("../validation/common");
const { eventQueryBase } = require("../validation/events");
module.exports = function createEventService(db) {
async function ownedCategory(categoryId,userId){
  return (await db.query('SELECT id,legacy_key FROM event_categories WHERE id=$1 AND user_id=$2',[categoryId,userId])).rows[0];
}
async function fetchEvents(userId,fromInstant,toInstant){
  const from=localDate(fromInstant); const to=localDate(toInstant);
  const rows=(await db.query(`${eventQueryBase} WHERE e.user_id=$1 AND ((e.recurrence_type='none' AND e.starts_at<$3 AND e.ends_at>$2) OR (e.recurrence_type<>'none' AND e.starts_at<$3 AND (e.recurrence_until IS NULL OR e.recurrence_until>=$4))) ORDER BY e.starts_at ASC LIMIT 500`,[userId,fromInstant,toInstant,from])).rows;
  const repeating=rows.filter(e=>e.repeat!=='none');
  const cancellations=repeating.length?(await db.query(`SELECT event_id AS id,to_char(occurrence_date,'YYYY-MM-DD') AS date FROM event_cancellations WHERE event_id=ANY($1::uuid[]) AND occurrence_date BETWEEN $2 AND $3`,[repeating.map(e=>e.id),addDays(from,-2),to])).rows:[];
  const cancelled=new Set(cancellations.map(e=>`${e.id}@${e.date}`));
  const output=[];
  for(const e of rows){
    if(e.repeat==='none'){output.push({...e,isRecurring:false});continue;}
    const base=localDate(e.startsAt);
    for(const day of recurringDates(e,base,addDays(from,-2),to)){
      if(cancelled.has(`${e.id}@${day}`))continue;
      const startsAt=occurrenceTimestamp(e.startsAt,base,day);
      const endsAt=occurrenceTimestamp(e.endsAt,base,day);
      if(new Date(startsAt)>=new Date(toInstant)||new Date(endsAt)<=new Date(fromInstant))continue;
      output.push({...e,id:`${e.id}@${day}`,seriesId:e.id,occurrenceDate:day,seriesStartsAt:e.startsAt,seriesEndsAt:e.endsAt,startsAt,endsAt,isRecurring:true});
      if(output.length>=1200)break;
    }
    if(output.length>=1200)break;
  }
  return output.sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
}

return {ownedCategory,fetchEvents};
};
