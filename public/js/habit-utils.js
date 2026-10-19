(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PatternHabits = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const labels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  function dateUTC(iso) { return new Date(`${iso}T12:00:00Z`); }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function shifted(isoDate, days) {
    const day = dateUTC(isoDate);
    day.setUTCDate(day.getUTCDate() + days);
    return iso(day);
  }
  function weekday(isoDate) { return dateUTC(isoDate).getUTCDay(); }
  function isScheduled(habit, isoDate) {
    return (!habit.createdDate || isoDate >= habit.createdDate) &&
      (habit.scheduleDays || [0,1,2,3,4,5,6]).includes(weekday(isoDate));
  }
  function weekDates(today) {
    const shift = (weekday(today) + 6) % 7;
    return Array.from({length:7},(_,i)=>shifted(today,i-shift));
  }
  function streak(habit, markedDates, today) {
    let total=0;
    // Histórico disponível: 90 dias
    for (let i=0;i<90;i++) {
      const d=shifted(today,-i);
      if (habit.createdDate && d < habit.createdDate) break;
      if (!isScheduled(habit,d)) continue;
      if (markedDates.has(d)) {total++; continue;}
      if (i===0) continue; 
      break;
    }
    return total;
  }
  function weekSummary(habit, markedDates, today) {
    const days=weekDates(today).filter(d=>isScheduled(habit,d) && d<=today);
    const checked=days.filter(d=>markedDates.has(d)).length;
    return {checked,planned:days.length,goal:Math.min(habit.goalPerWeek ?? 7,(habit.scheduleDays||[0,1,2,3,4,5,6]).length)};
  }
  return {labels,shifted,weekday,isScheduled,weekDates,streak,weekSummary};
});
