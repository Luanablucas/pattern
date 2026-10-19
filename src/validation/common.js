"use strict";
const { z } = require("zod");
const { occurrences } = require("../../recurrence-utils");
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida");
const safeText = (max) => z.string().trim().min(1).max(max);
const weekdaysSchema = z.array(z.number().int().min(0).max(6)).max(7)
  .refine(v=>new Set(v).size===v.length,'Não repita dias da semana.');
const recurrenceFields = {
  repeat: z.enum(['none','daily','weekly','monthly']).default('none'),
  repeatDays: weekdaysSchema.default([]),
  repeatUntil: dateString.nullable().default(null)
};
function recurrenceValid(v,start) {
  return (v.repeat==='none' || Boolean(start)) &&
    (v.repeat!=='weekly' || v.repeatDays.length>0) &&
    (!v.repeatUntil || (start && v.repeatUntil>=start));
}
function recurringDates(row,baseDate,from,to) {
  return occurrences({start:baseDate,until:row.repeatUntil,type:row.repeat,days:row.repeatDays||[],from,to});
}

module.exports = { dateString,safeText,recurrenceFields,recurrenceValid,recurringDates };
