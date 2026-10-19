"use strict";
const { z } = require("zod");
const { safeText } = require("./common");
const daysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine(
    (days) => new Set(days).size === days.length,
    "Escolha dias diferentes.",
  );
const habitSchema = z
  .object({
    name: safeText(100),
    scheduleDays: daysSchema,
    preferredTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido.")
      .nullable()
      .default(null),
    goalPerWeek: z.number().int().min(1).max(7),
    routineId: z.string().uuid().nullable().default(null),
  })
  .strict()
  .refine((v) => v.goalPerWeek <= v.scheduleDays.length, {
    message: "A meta semanal não pode superar a quantidade de dias planejados.",
  });
const habitFields = `id,name,schedule_days AS "scheduleDays",to_char(preferred_time,'HH24:MI') AS "preferredTime",goal_per_week AS "goalPerWeek",routine_id AS "routineId",position,to_char(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS "createdDate"`;
const routineSchema = z
  .object({
    name: safeText(100),
    period: z.enum(["morning", "evening", "flexible"]).default("flexible"),
    description: z.string().trim().max(240).default(""),
  })
  .strict();

module.exports={habitSchema,habitFields,routineSchema};
