"""Tests des endpoints /api/entries (création pour un tiers, edition/réassignation,
validation, suppression) et du journal d'audit qui les accompagne.

Isolation : même pattern que test_financier_api.py — importe app.py avec cwd
pointé sur un dossier temporaire (data/chantier.db et backend/logs/ s'y créent,
jamais dans le vrai projet).

Lancer : python -m unittest tests.test_entries_api -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_entries_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402 — must import with cwd=_TEST_DIR
finally:
    os.chdir(_orig_cwd)

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))


class EntriesApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.token = ohmapp.serializer.dumps({'user_id': admin.id})
            cls.admin_id = admin.id

            worker_a = ohmapp.User(username='WorkerA', role='user')
            worker_a.set_pin('1234')
            worker_b = ohmapp.User(username='WorkerB', role='user')
            worker_b.set_pin('1234')
            ohmapp.db.session.add_all([worker_a, worker_b])
            ohmapp.db.session.commit()
            cls.worker_a_id = worker_a.id
            cls.worker_b_id = worker_b.id
        cls.client.set_cookie(ohmapp.COOKIE_NAME, cls.token)

    def setUp(self):
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=f'Test {self._testMethodName}', annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            self.chantier_id = chantier.id

    def test_admin_creates_entry_on_behalf_of_worker(self):
        res = self.client.post('/api/entries', json={
            'user_id': self.worker_a_id, 'chantier_id': self.chantier_id,
            'date': '2026-01-05', 'heures': 8, 'materiel': 0
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()
        self.assertEqual(body['user_id'], self.worker_a_id)
        self.assertEqual(body['user_name'], 'WorkerA')

        log_path = os.path.join(ohmapp.AUDIT_LOG_DIR, 'entries.log')
        self.assertTrue(os.path.exists(log_path))
        with open(log_path, encoding='utf-8') as f:
            content = f.read()
        self.assertIn('created entry', content)
        self.assertIn('WorkerA', content)

    def test_admin_edits_heures_and_reassigns_user(self):
        create = self.client.post('/api/entries', json={
            'user_id': self.worker_a_id, 'chantier_id': self.chantier_id,
            'date': '2026-01-05', 'heures': 5, 'materiel': 0
        })
        entry_id = create.get_json()['id']

        res = self.client.put(f'/api/entries/{entry_id}', json={
            'heures': 7.5, 'user_id': self.worker_b_id
        })
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual(body['heures'], 7.5)
        self.assertEqual(body['user_id'], self.worker_b_id)
        self.assertEqual(body['user_name'], 'WorkerB')

        with open(os.path.join(ohmapp.AUDIT_LOG_DIR, 'entries.log'), encoding='utf-8') as f:
            content = f.read()
        self.assertIn('edited entry', content)
        self.assertIn('WorkerA -> WorkerB', content)
        self.assertIn('heures 5.0 -> 7.5', content)

    def test_edit_rejects_unknown_user(self):
        create = self.client.post('/api/entries', json={
            'user_id': self.worker_a_id, 'chantier_id': self.chantier_id,
            'date': '2026-01-05', 'heures': 5, 'materiel': 0
        })
        entry_id = create.get_json()['id']
        res = self.client.put(f'/api/entries/{entry_id}', json={'heures': 5, 'user_id': 999999})
        self.assertEqual(res.status_code, 404)

    def test_validate_and_delete_are_logged(self):
        create = self.client.post('/api/entries', json={
            'user_id': self.worker_a_id, 'chantier_id': self.chantier_id,
            'date': '2026-01-05', 'heures': 3, 'materiel': 0
        })
        entry_id = create.get_json()['id']

        res = self.client.put(f'/api/entries/{entry_id}/validate')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['status'], 'VALIDATED')

        res = self.client.delete(f'/api/entries/{entry_id}')
        self.assertEqual(res.status_code, 200)

        with open(os.path.join(ohmapp.AUDIT_LOG_DIR, 'entries.log'), encoding='utf-8') as f:
            content = f.read()
        self.assertIn('validated entry', content)
        self.assertIn('deleted/rejected entry', content)


if __name__ == '__main__':
    unittest.main()
