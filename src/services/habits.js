"use strict";
module.exports = function createHabitService(db) {
async function ensureUserRoutine(routineId, userId) {
  if (!routineId) return true;
  const found = await db.query(
    "SELECT 1 FROM routines WHERE id=$1 AND user_id=$2",
    [routineId, userId],
  );
  return found.rowCount > 0;
}

return {ensureUserRoutine};
};
