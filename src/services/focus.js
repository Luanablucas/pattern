"use strict";
module.exports = function createFocusService(db) {
  async function finishExpired(userId) {
    await db.query(`UPDATE focus_sessions
      SET elapsed_seconds=planned_seconds,status='completed',
      finished_at=active_since+(planned_seconds-elapsed_seconds)*INTERVAL '1 second',
      active_since=NULL,paused_at=NULL
      WHERE user_id=$1 AND status='running' AND mode='pomodoro' AND planned_seconds IS NOT NULL
      AND EXTRACT(EPOCH FROM (NOW()-active_since)) >= GREATEST(0,planned_seconds-elapsed_seconds)`, [userId]);
  }

return {finishExpired};
};
