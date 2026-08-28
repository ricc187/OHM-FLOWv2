"""Tests de la nomenclature imposée des chantiers ({AA}{NNNNN}-Commune-Client)
et du bandeau d'annonces admin (/api/notices).

Isolation : même pattern que les autres tests API — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_chantier_nomenclature -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_nomenclature_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))


class ChantierNomenclatureTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.token = ohmapp.serializer.dumps({'user_id': admin.id})
        cls.client.set_cookie(ohmapp.COOKIE_NAME, cls.token)

    def test_create_requires_commune_and_client(self):
        res = self.client.post('/api/chantiers', json={'annee': 2026})
        self.assertEqual(res.status_code, 400)

    def test_create_generates_numero_and_nom(self):
        res = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Martigny', 'client_repere': 'Dupont'
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()
        self.assertEqual(body['commune'], 'Martigny')
        self.assertEqual(body['client_repere'], 'Dupont')
        self.assertTrue(body['numero'].startswith('26'))
        self.assertEqual(len(body['numero']), 7)
        self.assertEqual(body['nom'], f"{body['numero']}-Martigny-Dupont")

    def test_numero_is_sequential_and_unique(self):
        res1 = self.client.post('/api/chantiers', json={'annee': 2026, 'commune': 'Sion', 'client_repere': 'A'})
        res2 = self.client.post('/api/chantiers', json={'annee': 2026, 'commune': 'Sion', 'client_repere': 'B'})
        n1 = int(res1.get_json()['numero'])
        n2 = int(res2.get_json()['numero'])
        self.assertEqual(n2, n1 + 1)

    def test_numero_ignores_client_supplied_value(self):
        res = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Sion', 'client_repere': 'C', 'numero': '00000'
        })
        body = res.get_json()
        self.assertNotEqual(body['numero'], '00000')


class NoticesApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.admin_token = ohmapp.serializer.dumps({'user_id': admin.id})

            worker = ohmapp.User(username='NoticeWorker', role='user')
            worker.set_pin('1234')
            ohmapp.db.session.add(worker)
            ohmapp.db.session.commit()
            cls.worker_id = worker.id
            cls.worker_token = ohmapp.serializer.dumps({'user_id': worker.id})

    def _as_admin(self):
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, self.admin_token)
        return c

    def _as_worker(self):
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, self.worker_token)
        return c

    def test_worker_cannot_create_notice(self):
        res = self._as_worker().post('/api/notices', json={'message': 'test'})
        self.assertEqual(res.status_code, 403)

    def test_create_and_see_active_notice(self):
        admin = self._as_admin()
        worker = self._as_worker()

        res = admin.post('/api/notices', json={
            'message': "L'échelle est à gauche de l'atelier", 'duration_days': 7
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        notice_id = res.get_json()['id']

        res = worker.get('/api/notices/active')
        self.assertEqual(res.status_code, 200)
        ids = [n['id'] for n in res.get_json()]
        self.assertIn(notice_id, ids)

    def test_ack_hides_notice_for_that_user_only(self):
        admin = self._as_admin()
        worker = self._as_worker()

        notice_id = admin.post('/api/notices', json={'message': 'ack test'}).get_json()['id']

        res = worker.post(f'/api/notices/{notice_id}/ack')
        self.assertEqual(res.status_code, 200)

        res = worker.get('/api/notices/active')
        ids = [n['id'] for n in res.get_json()]
        self.assertNotIn(notice_id, ids)

        # Still visible to a different (unacked) user.
        res = admin.get('/api/notices/active')
        ids = [n['id'] for n in res.get_json()]
        self.assertIn(notice_id, ids)

    def test_notice_outside_window_not_active(self):
        admin = self._as_admin()
        worker = self._as_worker()

        notice_id = admin.post('/api/notices', json={
            'message': 'future', 'date_start': '2099-01-01', 'duration_days': 5
        }).get_json()['id']

        res = worker.get('/api/notices/active')
        ids = [n['id'] for n in res.get_json()]
        self.assertNotIn(notice_id, ids)

    def test_delete_notice(self):
        admin = self._as_admin()
        notice_id = admin.post('/api/notices', json={'message': 'to delete'}).get_json()['id']
        res = admin.delete(f'/api/notices/{notice_id}')
        self.assertEqual(res.status_code, 200)
        res = admin.get('/api/notices')
        ids = [n['id'] for n in res.get_json()]
        self.assertNotIn(notice_id, ids)


if __name__ == '__main__':
    unittest.main()
