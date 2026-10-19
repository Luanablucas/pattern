import sys
import unittest
from pathlib import Path
from datetime import date, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from main import HabitDay, HabitAnalysisInput, analyze_habits

class HabitAnalysisTests(unittest.TestCase):
    def make(self, first=(1, 2), second=(2, 2)):
        start=date(2026, 9, 17)
        days=[]
        for i in range(28):
            done,planned=first if i<14 else second
            days.append(HabitDay(date=start+timedelta(days=i), scheduled=planned, completed=done))
        return HabitAnalysisInput(days=days)

    def test_comparison(self):
        result=analyze_habits(self.make())
        self.assertEqual(result['completionRate'],100)
        self.assertEqual(result['previousRate'],50)
        self.assertEqual(result['changePoints'],50)

    def test_no_plans_returns_none(self):
        result=analyze_habits(self.make(first=(0,0),second=(0,0)))
        self.assertIsNone(result['completionRate'])
        self.assertIsNone(result['changePoints'])

    def test_no_fake_causality(self):
        result=analyze_habits(self.make(first=(0,2),second=(0,2)))
        self.assertEqual(result['completionRate'],0)
        self.assertEqual(result['completed'],0)

if __name__ == '__main__':
    unittest.main()
