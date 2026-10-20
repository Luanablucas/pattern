"use strict";

const { addDays } = require("../../recurrence-utils");

const rangeDates = (end, days) => Array.from({ length: days }, (_, index) => addDays(end, index - days + 1));

function combineDaily(dates, taskRows, focusRows, habits, entries) {
  const tasks = new Map(taskRows.map(row => [row.date, Number(row.completed)]));
  const focus = new Map(focusRows.map(row => [row.date, { seconds: Number(row.seconds), sessions: Number(row.sessions) }]));
  const marked = new Set(entries.map(row => `${row.id}@${row.date}`));
  return dates.map(date => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const scheduled = habits.filter(habit => habit.created <= date && habit.days.includes(weekday));
    return {
      date,
      tasksCompleted: tasks.get(date) || 0,
      focusSeconds: focus.get(date)?.seconds || 0,
      focusSessions: focus.get(date)?.sessions || 0,
      habitsPlanned: scheduled.length,
      habitsCompleted: scheduled.filter(habit => marked.has(`${habit.id}@${date}`)).length
    };
  });
}

function summarize(days) {
  const sum = field => days.reduce((total, day) => total + day[field], 0);
  const focusSeconds = sum("focusSeconds");
  const habitsPlanned = sum("habitsPlanned");
  const habitsCompleted = sum("habitsCompleted");
  return {
    tasksCompleted: sum("tasksCompleted"),
    focusSeconds,
    focusSessions: sum("focusSessions"),
    focusDays: days.filter(day => day.focusSeconds > 0).length,
    habitsPlanned,
    habitsCompleted,
    habitRate: habitsPlanned ? Math.round(habitsCompleted / habitsPlanned * 100) : null
  };
}

function compare(current, previous) {
  const fields = ["tasksCompleted", "focusSeconds", "focusSessions"];
  return Object.fromEntries(fields.map(field => [field, previous[field] ? Math.round((current[field] - previous[field]) / previous[field] * 100) : null]));
}

function overlapSeconds(start, end, windowStart, windowEnd) {
  const first = Math.max(new Date(start).getTime(), new Date(windowStart).getTime());
  const last = Math.min(new Date(end).getTime(), new Date(windowEnd).getTime());
  return Math.max(0, (last - first) / 1000);
}

function summarizeCategories(chunks) {
  const sums = new Map();
  const seen = new Set();
  for (const { events, from, to } of chunks) {
    for (const event of events) {
      const seconds = overlapSeconds(event.startsAt, event.endsAt, from, to);
      if (!seconds) continue;
      const name = event.categoryName || "Sem bloco";
      const color = /^#[0-9a-fA-F]{6}$/.test(event.categoryColor || "") ? event.categoryColor : "#a89ab6";
      const key = event.categoryId || "no-category";
      const current = sums.get(key) || { id: key, name, color, seconds: 0, events: 0 };
      current.seconds += seconds;
      const eventKey = `${key}@${event.id}`;
      if (!seen.has(eventKey)) {
        seen.add(eventKey);
        current.events += 1;
      }
      sums.set(key, current);
    }
  }
  return [...sums.values()].sort((a, b) => b.seconds - a.seconds);
}

module.exports = { rangeDates, combineDaily, summarize, compare, overlapSeconds, summarizeCategories };
