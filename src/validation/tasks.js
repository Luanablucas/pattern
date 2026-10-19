"use strict";
const { z } = require("zod");
const { dateString,safeText,recurrenceFields,recurrenceValid } = require("./common");
const taskSchema = z.object({
  title: safeText(160),
  notes:z.string().max(2000).default(''),
  dueDate:dateString.nullable().default(null),
  priority:z.enum(['low','medium','high']).default('medium'),
  ...recurrenceFields
}).strict().refine(v=>recurrenceValid(v,v.dueDate),{message:'Escolha uma data inicial e dias válidos para a repetição.'});
const taskColumns = `id,title,notes,to_char(due_date,'YYYY-MM-DD') AS "dueDate",priority,completed,created_at AS "createdAt",recurrence_type AS "repeat",recurrence_days AS "repeatDays",to_char(recurrence_until,'YYYY-MM-DD') AS "repeatUntil"`;

module.exports={taskSchema,taskColumns};
