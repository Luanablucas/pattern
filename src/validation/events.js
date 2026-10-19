"use strict";
const { z } = require("zod");
const { safeText,recurrenceFields,recurrenceValid } = require("./common");
const { localDate } = require("../../recurrence-utils");
const { validEventWindow } = require("../../event-time-utils");
const eventFields = `e.id,e.title,e.starts_at AS "startsAt",e.ends_at AS "endsAt",e.notes,e.category_id AS "categoryId",c.name AS "categoryName",c.color AS "categoryColor",e.time_mode AS "timeMode",e.recurrence_type AS "repeat",e.recurrence_days AS "repeatDays",to_char(e.recurrence_until,'YYYY-MM-DD') AS "repeatUntil"`;
const eventQueryBase=`SELECT ${eventFields} FROM events e LEFT JOIN event_categories c ON c.id=e.category_id`;
const eventSchema=z.object({
  title:safeText(160),startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),
  notes:z.string().max(2000).default(''),categoryId:z.string().uuid(),timeMode:z.enum(['exact','all_day','morning','afternoon','night']).default('exact'),...recurrenceFields
}).strict().refine(v=>new Date(v.endsAt)>new Date(v.startsAt),{message:'O término deve ser depois do início.'})
.refine(v=>validEventWindow(v),{message:'Os horários não correspondem ao período escolhido.'})
.refine(v=>recurrenceValid(v,localDate(v.startsAt)),{message:'Escolha uma repetição válida.'});
const eventRangeSchema=z.object({from:z.string().datetime({offset:true}),to:z.string().datetime({offset:true})}).strict();

module.exports={eventSchema,eventFields,eventQueryBase,eventRangeSchema};
