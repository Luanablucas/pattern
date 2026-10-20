import unittest
from datetime import date, timedelta
from fastapi import HTTPException
from python.main import AnalyticsDay, DashboardAnalysisInput, analyze_dashboard


class PatternAnalyticsTests(unittest.TestCase):
    def records(self, days=7, focus=0, completed=0, habits=0):
        start = date(2026, 10, 1)
        return [AnalyticsDay(date=start + timedelta(days=index), tasksCompleted=completed,
                             focusSeconds=focus, focusSessions=int(focus > 0),
                             habitsPlanned=1, habitsCompleted=habits) for index in range(days * 2)]

    def test_comparison_of_periods(self):
        rows = self.records()
        for row in rows[:7]:
            row.focusSeconds = 600
        for row in rows[7:]:
            row.focusSeconds = 1200
            row.habitsCompleted = 1
        answer = analyze_dashboard(DashboardAnalysisInput(days=rows, periodDays=7))
        self.assertEqual(answer['habitRate'], 100)
        self.assertTrue(any('100%' in insight for insight in answer['insights']))
        self.assertTrue(any('aumentou' in insight for insight in answer['insights']))

    def test_without_records(self):
        rows = self.records(habits=0)
        for row in rows:
            row.habitsPlanned = 0
        answer = analyze_dashboard(DashboardAnalysisInput(days=rows, periodDays=7))
        self.assertIsNone(answer['habitRate'])
        self.assertIn('poucos registros', answer['insights'][0])

    def test_reject_inconsistent_habits(self):
        rows = self.records()
        rows[-1].habitsCompleted = 2
        with self.assertRaises(HTTPException):
            analyze_dashboard(DashboardAnalysisInput(days=rows, periodDays=7))

    def test_reject_wrong_period(self):
        with self.assertRaises(HTTPException):
            analyze_dashboard(DashboardAnalysisInput(days=self.records(7), periodDays=14))


if __name__ == '__main__':
    unittest.main()
