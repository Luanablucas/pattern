import unittest
from fastapi.testclient import TestClient
from python.main import app


class PlanningPatternsTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_no_history(self):
        response = self.client.post('/planning-patterns', json={'sessions': []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['preferredHours'], [])

    def test_insufficient_history(self):
        rows = [{'hour': 11, 'seconds': 900}] * 4
        response = self.client.post('/planning-patterns', json={'sessions': rows})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['preferredHours'], [])

    def test_peak_hours(self):
        rows = [{'hour': h, 'seconds': 1500} for h in [9, 9, 9, 14, 14, 16]]
        response = self.client.post('/planning-patterns', json={'sessions': rows})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['preferredHours'], [9, 14, 16])

    def test_invalid_hour_rejected(self):
        response = self.client.post('/planning-patterns', json={'sessions': [{'hour': 25, 'seconds': 1200}]})
        self.assertEqual(response.status_code, 422)


if __name__ == '__main__':
    unittest.main()
