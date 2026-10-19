"use strict";

function secondsBetween(start, end) {
  if (!start || !end) return 0;
  const difference = Date.parse(end) - Date.parse(start);
  return Number.isFinite(difference) ? Math.max(0, Math.floor(difference / 1000)) : 0;
}

function effectiveSeconds(session, now) {
  const accumulated = Math.max(0, Number(session.elapsedSeconds) || 0);
  const active = session.status === "running" ? secondsBetween(session.activeSince, now) : 0;
  const sum = accumulated + active;
  return session.mode === "pomodoro"
    ? Math.min(Number(session.plannedSeconds) || 0, sum)
    : sum;
}

function remainingSeconds(session, now) {
  return session.mode === "pomodoro"
    ? Math.max(0, Number(session.plannedSeconds) - effectiveSeconds(session, now))
    : 0;
}

function prettySeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts[0]
    ? parts.map((number) => String(number).padStart(2, "0")).join(":")
    : parts.slice(1).map((number) => String(number).padStart(2, "0")).join(":");
}

const core = { secondsBetween, effectiveSeconds, remainingSeconds, prettySeconds };
if (typeof module !== "undefined" && module.exports) module.exports = core;
if (typeof window !== "undefined") window.PatternFocus = core;
