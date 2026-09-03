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
            cls.admin_id = admin.id
        cls.client.set_cookie(ohmapp.COOKIE_NAME, cls.token)

    def test_create_requires_commune_and_client(self):
        res = self.client.post('/api/chantiers', json={'annee': 2026, 'referent_id': self.admin_id})
        self.assertEqual(res.status_code, 400)

    def test_create_requires_referent(self):
        res = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Martigny', 'client_repere': 'Dupont'
        })
        self.assertEqual(res.status_code, 400)

    def test_create_generates_numero_and_nom(self):
        res = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Martigny', 'client_repere': 'Dupont', 'referent_id': self.admin_id
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()
        self.assertEqual(body['commune'], 'Martigny')
        self.assertEqual(body['client_repere'], 'Dupont')
        self.assertTrue(body['numero'].startswith('26'))
        self.assertEqual(len(body['numero']), 7)
        self.assertEqual(body['nom'], f"{body['numero']}-Martigny-Dupont")

    def test_numero_is_sequential_and_unique(self):
        res1 = self.client.post('/api/chantiers', json={'annee': 2026, 'commune': 'Sion', 'client_repere': 'A', 'referent_id': self.admin_id})
        res2 = self.client.post('/api/chantiers', json={'annee': 2026, 'commune': 'Sion', 'client_repere': 'B', 'referent_id': self.admin_id})
        n1 = int(res1.get_json()['numero'])
        n2 = int(res2.get_json()['numero'])
        self.assertEqual(n2, n1 + 1)

    def test_numero_ignores_client_supplied_value(self):
        res = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Sion', 'client_repere': 'C', 'numero': '00000', 'referent_id': self.admin_id
        })
        body = res.get_json()
        self.assertNotEqual(body['numero'], '00000')

    def test_create_sets_referent(self):
        res = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Sion', 'client_repere': 'D', 'referent_id': self.admin_id
        })
        body = res.get_json()
        self.assertEqual(body['referent_id'], self.admin_id)
        self.assertEqual(body['referent_name'], 'Admin')
        self.assertFalse(body['has_assignments'])

    def test_create_and_edit_deadline(self):
        created = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Sion', 'client_repere': 'DeadlineTest',
            'referent_id': self.admin_id, 'deadline': '2026-12-24'
        }).get_json()
        self.assertEqual(created['deadline'], '2026-12-24')

        res = self.client.put(f"/api/chantiers/{created['id']}", json={'deadline': '2027-01-15'})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['deadline'], '2027-01-15')

    def test_create_without_deadline_is_none(self):
        created = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Sion', 'client_repere': 'NoDeadline', 'referent_id': self.admin_id
        }).get_json()
        self.assertIsNone(created['deadline'])

    def test_create_unknown_referent_rejected(self):
        res = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Sion', 'client_repere': 'E', 'referent_id': 999999
        })
        self.assertEqual(res.status_code, 404)

    def test_has_assignments_filter_on_list(self):
        # Sans affectation -> visible seulement dans has_assignments=false.
        created = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Sion', 'client_repere': 'PotFilter', 'referent_id': self.admin_id
        }).get_json()
        cid = created['id']

        pot = self.client.get('/api/chantiers?has_assignments=false').get_json()
        self.assertIn(cid, [c['id'] for c in pot])
        planned = self.client.get('/api/chantiers?has_assignments=true').get_json()
        self.assertNotIn(cid, [c['id'] for c in planned])

        with ohmapp.app.app_context():
            worker = ohmapp.User.query.filter_by(username='Referent1').first()
            if not worker:
                worker = ohmapp.User(username='Referent1', role='user')
                worker.set_pin('1234')
                ohmapp.db.session.add(worker)
                ohmapp.db.session.commit()
            worker_id = worker.id
        res = self.client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': cid, 'user_ids': [worker_id],
            'date_debut': '2026-09-10', 'date_fin': '2026-09-10', 'toute_la_journee': True
        })
        self.assertEqual(res.status_code, 201, res.get_json())

        pot_after = self.client.get('/api/chantiers?has_assignments=false').get_json()
        self.assertNotIn(cid, [c['id'] for c in pot_after])
        planned_after = self.client.get('/api/chantiers?has_assignments=true').get_json()
        self.assertIn(cid, [c['id'] for c in planned_after])

    # --- PUT /api/chantiers/<id> (edit) — numero stays permanent -----------
    # Regression: the edit form used to send a free-text `nom`, which let
    # someone edit the numero prefix embedded in it right out from under it.

    def test_edit_cannot_change_numero(self):
        created = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Martigny', 'client_repere': 'Dupont', 'referent_id': self.admin_id
        }).get_json()
        res = self.client.put(f"/api/chantiers/{created['id']}", json={
            'numero': '00000', 'nom': '00000-Fake-Client', 'commune': 'Martigny', 'client_repere': 'Dupont'
        })
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual(body['numero'], created['numero'])
        self.assertTrue(body['nom'].startswith(created['numero']))

    def test_edit_updates_commune_and_client_recomputes_nom(self):
        created = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Martigny', 'client_repere': 'Dupont', 'referent_id': self.admin_id
        }).get_json()
        res = self.client.put(f"/api/chantiers/{created['id']}", json={
            'commune': 'Sion', 'client_repere': 'Morand'
        })
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual(body['numero'], created['numero'])  # unchanged
        self.assertEqual(body['commune'], 'Sion')
        self.assertEqual(body['client_repere'], 'Morand')
        self.assertEqual(body['nom'], f"{created['numero']}-Sion-Morand")

    def test_edit_can_change_referent(self):
        created = self.client.post('/api/chantiers', json={
            'annee': 2026, 'commune': 'Martigny', 'client_repere': 'Referent-Test', 'referent_id': self.admin_id
        }).get_json()
        with ohmapp.app.app_context():
            other = ohmapp.User(username='OtherReferent', role='user')
            other.set_pin('1234')
            ohmapp.db.session.add(other)
            ohmapp.db.session.commit()
            other_id = other.id
        res = self.client.put(f"/api/chantiers/{created['id']}", json={'referent_id': other_id})
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual(body['referent_id'], other_id)
        self.assertEqual(body['referent_name'], 'OtherReferent')

    def test_edit_legacy_chantier_without_numero_keeps_free_form_nom(self):
        # A chantier predating the nomenclature (numero never set) has no
        # numero to protect — the old free-form nom edit still applies.
        with ohmapp.app.app_context():
            legacy = ohmapp.Chantier(nom='Ancien Chantier Libre', annee=2020, status='DONE')
            ohmapp.db.session.add(legacy)
            ohmapp.db.session.commit()
            legacy_id = legacy.id
        res = self.client.put(f'/api/chantiers/{legacy_id}', json={'nom': 'Nouveau Nom Libre'})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['nom'], 'Nouveau Nom Libre')
        self.assertIsNone(res.get_json()['numero'])


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
