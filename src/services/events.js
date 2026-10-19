"use strict";
const { addDays, localDate, occurrenceTimestamp, occurrences } = require("../../recurrence-utils");
const { recurringDates } = require("../validation/common");
const { eventQueryBase } = require("../validation/events");

module.exports = function createEventService(db) {
  async function ownedCategory(categoryId, userId) {
    return (await db.query("SELECT id,legacy_key FROM event_categories WHERE id=$1 AND user_id=$2", [categoryId, userId])).rows[0];
  }

  async function fetchEvents(userId, fromInstant, toInstant) {
    const from = localDate(fromInstant);
    const to = localDate(toInstant);
    const rows = (await db.query(`${eventQueryBase} WHERE e.user_id=$1 AND ((e.recurrence_type='none' AND e.starts_at<$3 AND e.ends_at>$2) OR (e.recurrence_type<>'none' AND e.starts_at<$3 AND (e.recurrence_until IS NULL OR e.recurrence_until>=$4))) ORDER BY e.starts_at ASC LIMIT 500`, [userId, fromInstant, toInstant, addDays(from, -2)])).rows;
    const repeating = rows.filter(e => e.repeat !== "none");
    const overrides = (await db.query(`SELECT o.event_id AS "seriesId",to_char(o.occurrence_date,'YYYY-MM-DD') AS "occurrenceDate",o.title,o.starts_at AS "startsAt",o.ends_at AS "endsAt",o.notes,o.category_id AS "categoryId",c.name AS "categoryName",c.color AS "categoryColor",o.time_mode AS "timeMode",e.recurrence_type AS "repeat",e.recurrence_days AS "repeatDays",to_char(e.recurrence_until,'YYYY-MM-DD') AS "repeatUntil",e.starts_at AS "seriesStartsAt",e.ends_at AS "seriesEndsAt" FROM event_overrides o JOIN events e ON e.id=o.event_id LEFT JOIN event_categories c ON c.id=o.category_id LEFT JOIN event_cancellations x ON x.event_id=o.event_id AND x.occurrence_date=o.occurrence_date WHERE x.event_id IS NULL AND e.user_id=$1 AND ((o.starts_at<$3 AND o.ends_at>$2) OR (o.occurrence_date BETWEEN $4 AND $5)) LIMIT 500`, [userId, fromInstant, toInstant,addDays(from,-2),to])).rows;
    const ids = [...new Set([...repeating.map(e => e.id),...overrides.map(e => e.seriesId)])];
    const cancellations = ids.length ? (await db.query("SELECT event_id AS id,to_char(occurrence_date,'YYYY-MM-DD') AS date FROM event_cancellations WHERE event_id=ANY($1::uuid[]) AND occurrence_date BETWEEN $2 AND $3", [ids, addDays(from, -2), to])) .rows : [];
    const cancelled = new Set(cancellations.map(e => `${e.id}@${e.date}`));
    const overrideKeys = new Set(overrides.map(e => `${e.seriesId}@${e.occurrenceDate}`));
    const output = [];
    for (const e of rows) {
      if (e.repeat === "none") {
        output.push({ ...e, isRecurring: false });
        continue;
      }
      const base = localDate(e.startsAt);
      for (const day of recurringDates(e, base, addDays(from, -2), to)) {
        const key = `${e.id}@${day}`;
        if (cancelled.has(key) || overrideKeys.has(key)) continue;
        const startsAt = occurrenceTimestamp(e.startsAt, base, day);
        const endsAt = occurrenceTimestamp(e.endsAt, base, day);
        if (new Date(startsAt) >= new Date(toInstant) || new Date(endsAt) <= new Date(fromInstant)) continue;
        output.push({ ...e, id: key, seriesId: e.id, occurrenceDate: day, seriesStartsAt: e.startsAt, seriesEndsAt: e.endsAt, startsAt, endsAt, isRecurring: true, isOverride: false });
        if (output.length >= 1200) break;
      }
      if (output.length >= 1200) break;
    }
    for (const event of overrides) {
      if (cancelled.has(`${event.seriesId}@${event.occurrenceDate}`) || new Date(event.startsAt) >= new Date(toInstant) || new Date(event.endsAt) <= new Date(fromInstant)) continue;
      if (output.length >= 1200) break;
      output.push({ ...event, id: `${event.seriesId}@${event.occurrenceDate}`, isRecurring: true, isOverride: true });
    }
    return output.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  }

  async function getSeries(userId, id) {
    return (await db.query(`${eventQueryBase} WHERE e.id=$1 AND e.user_id=$2`, [id, userId])).rows[0];
  }

  function validOccurrence(series, day) {
    if (!series || series.repeat === "none") return false;
    return occurrences({ start: localDate(series.startsAt), until: series.repeatUntil, type: series.repeat, days: series.repeatDays || [], from: day, to: day }).length === 1;
  }

  return { ownedCategory, fetchEvents, getSeries, validOccurrence };
};
