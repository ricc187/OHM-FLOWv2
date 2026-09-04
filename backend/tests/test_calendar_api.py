"""Tests des endpoints Agenda (/api/calendar, /api/calendar/chantier-assignments,
/api/calendar/leaves) : fusion des deux sources en un seul flux typé, création
multi-utilisateur en un seul appel, auto-approbation admin (+ déduction du
solde congés), et permissions du reschedule drag&drop.

Isolation : même pattern que test_entries_api.py — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_calendar_api -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_calendar_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402 — must import with cwd=_TEST_DIR
finally:
    os.chdir(_orig_cwd)

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))


class CalendarApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.admin_id = admin.id

            worker_a = ohmapp.User(username='WorkerA', role='user', vacation_balance=10.0)
            worker_a.set_pin('1234')
            worker_b = ohmapp.User(username='WorkerB', role='user', vacation_balance=10.0)
            worker_b.set_pin('1234')
            ohmapp.db.session.add_all([worker_a, worker_b])
            ohmapp.db.session.commit()
            cls.worker_a_id = worker_a.id
            cls.worker_b_id = worker_b.id

            admin_token = ohmapp.serializer.dumps({'user_id': admin.id})
            worker_a_token = ohmapp.serializer.dumps({'user_id': worker_a.id})
            worker_b_token = ohmapp.serializer.dumps({'user_id': worker_b.id})

        cls.admin_client = ohmapp.app.test_client()
        cls.admin_client.set_cookie(ohmapp.COOKIE_NAME, admin_token)
        cls.worker_a_client = ohmapp.app.test_client()
        cls.worker_a_client.set_cookie(ohmapp.COOKIE_NAME, worker_a_token)
        cls.worker_b_client = ohmapp.app.test_client()
        cls.worker_b_client.set_cookie(ohmapp.COOKIE_NAME, worker_b_token)

    def setUp(self):
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=f'Test {self._testMethodName}', annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            self.chantier_id = chantier.id
            # Reset balances between tests since they're mutated by auto-approve.
            ohmapp.User.query.get(self.worker_a_id).vacation_balance = 10.0
            ohmapp.User.query.get(self.worker_b_id).vacation_balance = 10.0
            ohmapp.db.session.commit()

    # --- GET /api/calendar: merges both sources, correctly typed ---------

    def test_calendar_merges_leaves_and_assignments(self):
        leave_res = self.admin_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_a_id], 'type': 'MALADIE',
            'date_debut': '2026-02-10', 'date_fin': '2026-02-11', 'toute_la_journee': True,
        })
        self.assertEqual(leave_res.status_code, 201, leave_res.get_json())

        assign_res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_b_id],
            'date_debut': '2026-02-10', 'date_fin': '2026-02-10', 'toute_la_journee': True,
        })
        self.assertEqual(assign_res.status_code, 201, assign_res.get_json())

        res = self.admin_client.get('/api/calendar?start=2026-02-01&end=2026-02-28')
        self.assertEqual(res.status_code, 200)
        items = res.get_json()

        leave_items = [i for i in items if i['source'] == 'leave' and i['user_id'] == self.worker_a_id]
        self.assertEqual(len(leave_items), 1)
        li = leave_items[0]
        self.assertEqual(li['type'], 'MALADIE')
        self.assertEqual(li['titre'], 'Maladie')
        self.assertEqual(li['date_debut'], '2026-02-10')
        self.assertEqual(li['date_fin'], '2026-02-11')
        self.assertEqual(li['status'], 'APPROVED')  # admin-authored -> auto-approved
        self.assertEqual(li['chantier_id'], None)
        self.assertEqual(li['couleur'], ohmapp.LEAVE_TYPE_COLORS['MALADIE'])

        chantier_items = [i for i in items if i['source'] == 'chantier' and i['user_id'] == self.worker_b_id]
        self.assertEqual(len(chantier_items), 1)
        ci = chantier_items[0]
        self.assertEqual(ci['type'], 'chantier')
        self.assertEqual(ci['chantier_id'], self.chantier_id)
        self.assertIn(f'Test {self._testMethodName}', ci['titre'])
        self.assertIsNone(ci['status'])
        self.assertEqual(ci['couleur'], ohmapp.CHANTIER_COLOR_PALETTE[self.chantier_id % len(ohmapp.CHANTIER_COLOR_PALETTE)])

    def test_calendar_excludes_out_of_range_and_filters_by_user(self):
        self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id, self.worker_b_id],
            'date_debut': '2026-05-05', 'date_fin': '2026-05-05', 'toute_la_journee': True,
        })
        # Outside the requested window entirely.
        outside = self.admin_client.get('/api/calendar?start=2026-06-01&end=2026-06-30')
        self.assertEqual(outside.get_json(), [])

        filtered = self.admin_client.get(f'/api/calendar?start=2026-05-01&end=2026-05-31&user_id={self.worker_a_id}')
        items = filtered.get_json()
        self.assertTrue(all(i['user_id'] == self.worker_a_id for i in items))
        self.assertEqual(len(items), 1)

    # --- Multi-user_id creation: one row per user, one call --------------

    def test_multi_user_chantier_assignment_creates_one_row_each(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id, self.worker_b_id],
            'date_debut': '2026-03-01', 'date_fin': '2026-03-02', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()
        self.assertEqual(len(body), 2)
        self.assertEqual({row['user_id'] for row in body}, {self.worker_a_id, self.worker_b_id})
        self.assertTrue(all(row['chantier_id'] == self.chantier_id for row in body))
        self.assertNotEqual(body[0]['id'], body[1]['id'])

    def test_multi_user_leave_creates_one_row_each(self):
        res = self.admin_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_a_id, self.worker_b_id], 'type': 'CONGE',
            'date_debut': '2026-03-10', 'date_fin': '2026-03-11', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()
        self.assertEqual(len(body), 2)
        self.assertEqual({row['user_id'] for row in body}, {self.worker_a_id, self.worker_b_id})
        self.assertTrue(all(row['status'] == 'APPROVED' for row in body))

    # --- Admin auto-approve deducts vacation_balance ----------------------

    def test_admin_created_leave_auto_approves_and_deducts_balance(self):
        res = self.admin_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_a_id], 'type': 'CONGE',
            'date_debut': '2026-03-02', 'date_fin': '2026-03-03', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()[0]
        self.assertEqual(body['status'], 'APPROVED')
        self.assertEqual(body['days_count'], 2.0)

        with ohmapp.app.app_context():
            worker = ohmapp.User.query.get(self.worker_a_id)
            self.assertEqual(worker.vacation_balance, 8.0)  # 10 - 2 days

    def test_non_admin_leave_creation_stays_pending_no_deduction(self):
        res = self.worker_a_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_a_id], 'type': 'ABSENCE',
            'date_debut': '2026-03-05', 'date_fin': '2026-03-05', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        self.assertEqual(res.get_json()[0]['status'], 'PENDING')

        with ohmapp.app.app_context():
            worker = ohmapp.User.query.get(self.worker_a_id)
            self.assertEqual(worker.vacation_balance, 10.0)  # untouched

    def test_non_admin_cannot_create_leave_for_someone_else(self):
        res = self.worker_a_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_b_id], 'type': 'ABSENCE',
            'date_debut': '2026-03-06', 'date_fin': '2026-03-06', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 403)

    # --- Reschedule (drag&drop) matches PUT /api/leaves/<id> permissions --

    def test_owner_can_reschedule_own_pending_leave(self):
        create = self.worker_a_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_a_id], 'type': 'ABSENCE',
            'date_debut': '2026-04-01', 'date_fin': '2026-04-01', 'toute_la_journee': True,
        })
        leave_id = create.get_json()[0]['id']

        res = self.worker_a_client.put(f'/api/calendar/leaves/{leave_id}/reschedule', json={
            'date_debut': '2026-04-05', 'date_fin': '2026-04-05',
        })
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['date_start'], '2026-04-05')

    def test_non_owner_cannot_reschedule(self):
        create = self.worker_a_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_a_id], 'type': 'ABSENCE',
            'date_debut': '2026-04-02', 'date_fin': '2026-04-02', 'toute_la_journee': True,
        })
        leave_id = create.get_json()[0]['id']

        res = self.worker_b_client.put(f'/api/calendar/leaves/{leave_id}/reschedule', json={
            'date_debut': '2026-04-06', 'date_fin': '2026-04-06',
        })
        self.assertEqual(res.status_code, 403)

    def test_owner_cannot_reschedule_once_approved_but_admin_can(self):
        create = self.worker_a_client.post('/api/calendar/leaves', json={
            'user_ids': [self.worker_a_id], 'type': 'ABSENCE',
            'date_debut': '2026-04-03', 'date_fin': '2026-04-03', 'toute_la_journee': True,
        })
        leave_id = create.get_json()[0]['id']
        approve = self.admin_client.put(f'/api/leaves/{leave_id}/status', json={'status': 'APPROVED'})
        self.assertEqual(approve.status_code, 200)

        denied = self.worker_a_client.put(f'/api/calendar/leaves/{leave_id}/reschedule', json={
            'date_debut': '2026-04-07', 'date_fin': '2026-04-07',
        })
        self.assertEqual(denied.status_code, 403)

        allowed = self.admin_client.put(f'/api/calendar/leaves/{leave_id}/reschedule', json={
            'date_debut': '2026-04-07', 'date_fin': '2026-04-07',
        })
        self.assertEqual(allowed.status_code, 200, allowed.get_json())
        self.assertEqual(allowed.get_json()['date_start'], '2026-04-07')

    def test_reschedule_chantier_assignment_partial_payload(self):
        create = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'date_debut': '2026-04-10', 'date_fin': '2026-04-10', 'toute_la_journee': True,
        })
        assignment_id = create.get_json()[0]['id']

        # Only date fields sent (typical drag&drop payload) — must not be
        # rejected for "missing" heure_debut/heure_fin/toute_la_journee.
        res = self.admin_client.put(f'/api/calendar/chantier-assignments/{assignment_id}', json={
            'date_debut': '2026-04-12', 'date_fin': '2026-04-12',
        })
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['date_debut'], '2026-04-12')

    # --- Validation ---------------------------------------------------

    def test_unknown_chantier_returns_404(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': 999999, 'user_ids': [self.worker_a_id],
            'date_debut': '2026-04-01', 'date_fin': '2026-04-01', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 404)

    def test_unknown_user_returns_404(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [999999],
            'date_debut': '2026-04-01', 'date_fin': '2026-04-01', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 404)

    def test_date_fin_before_date_debut_rejected(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'date_debut': '2026-04-10', 'date_fin': '2026-04-05', 'toute_la_journee': True,
        })
        self.assertEqual(res.status_code, 400)

    def test_heure_fin_before_heure_debut_rejected_when_not_toute_la_journee(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'date_debut': '2026-04-10', 'date_fin': '2026-04-10', 'toute_la_journee': False,
            'heure_debut': '09:00', 'heure_fin': '08:00',
        })
        self.assertEqual(res.status_code, 400)

    # --- "Chantier à planifier" — multi-candidate propositions -----------

    def test_a_planifier_creates_one_row_per_user_per_candidate_same_group(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id, self.worker_b_id],
            'a_planifier': True,
            'candidates': [
                {'date_debut': '2026-09-01', 'date_fin': '2026-09-01', 'toute_la_journee': True},
                {'date_debut': '2026-09-02', 'date_fin': '2026-09-02', 'toute_la_journee': False, 'heure_debut': '08:00', 'heure_fin': '12:00'},
            ],
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()
        # 2 users x 2 candidates = 4 rows.
        self.assertEqual(len(body), 4)
        self.assertTrue(all(row['statut'] == 'proposition' for row in body))
        group_ids = {row['proposal_group_id'] for row in body}
        self.assertEqual(len(group_ids), 1)  # one shared group for the whole submission
        self.assertNotIn(None, group_ids)
        # Each candidate's own toute_la_journee is preserved independently.
        by_date = {row['date_debut']: row for row in body}
        self.assertTrue(by_date['2026-09-01']['toute_la_journee'])
        self.assertFalse(by_date['2026-09-02']['toute_la_journee'])
        self.assertEqual(by_date['2026-09-02']['heure_debut'], '08:00')

    def test_a_planifier_requires_non_empty_candidates(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'a_planifier': True, 'candidates': [],
        })
        self.assertEqual(res.status_code, 400)

    def test_plain_creation_defaults_confirme_no_group(self):
        res = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'date_debut': '2026-09-10', 'date_fin': '2026-09-10', 'toute_la_journee': True,
        })
        body = res.get_json()[0]
        self.assertEqual(body['statut'], 'confirme')
        self.assertIsNone(body['proposal_group_id'])

    def test_calendar_exposes_statut_and_group(self):
        self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'a_planifier': True,
            'candidates': [{'date_debut': '2026-06-01', 'date_fin': '2026-06-01', 'toute_la_journee': True}],
        })
        res = self.admin_client.get('/api/calendar?start=2026-06-01&end=2026-06-01')
        items = [i for i in res.get_json() if i['source'] == 'chantier']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['statut'], 'proposition')
        self.assertIsNotNone(items[0]['proposal_group_id'])

    def test_valider_confirms_and_deletes_rest_of_group(self):
        create = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'a_planifier': True,
            'candidates': [
                {'date_debut': '2026-07-01', 'date_fin': '2026-07-01', 'toute_la_journee': True},
                {'date_debut': '2026-07-02', 'date_fin': '2026-07-02', 'toute_la_journee': True},
                {'date_debut': '2026-07-03', 'date_fin': '2026-07-03', 'toute_la_journee': True},
            ],
        })
        rows = create.get_json()
        chosen = rows[0]
        others = rows[1:]

        res = self.admin_client.put(f'/api/calendar/chantier-assignments/{chosen["id"]}/valider')
        self.assertEqual(res.status_code, 200, res.get_json())
        confirmed = res.get_json()
        self.assertEqual(confirmed['statut'], 'confirme')
        self.assertIsNone(confirmed['proposal_group_id'])

        for other in others:
            still_there = self.admin_client.get(f'/api/calendar?start=2026-07-01&end=2026-07-03')
            ids = {i['id'] for i in still_there.get_json() if i['source'] == 'chantier'}
            self.assertNotIn(other['id'], ids)

    def test_valider_confirms_same_date_for_every_employee_only_deletes_other_dates(self):
        # Regression: validating used to delete every other row in the group
        # indiscriminately — including a DIFFERENT employee's row on the
        # SAME (winning) date. "à planifier" applies the same employees to
        # every candidate date, so confirming a date must confirm it for
        # everyone assigned to it, not just whichever row was clicked.
        create = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id, self.worker_b_id],
            'a_planifier': True,
            'candidates': [
                {'date_debut': '2026-10-01', 'date_fin': '2026-10-01', 'toute_la_journee': True},
                {'date_debut': '2026-10-02', 'date_fin': '2026-10-02', 'toute_la_journee': True},
            ],
        })
        rows = create.get_json()
        by_key = {(r['user_id'], r['date_debut']): r for r in rows}
        clicked = by_key[(self.worker_a_id, '2026-10-01')]
        same_date_other_employee = by_key[(self.worker_b_id, '2026-10-01')]
        other_date_same_employee = by_key[(self.worker_a_id, '2026-10-02')]
        other_date_other_employee = by_key[(self.worker_b_id, '2026-10-02')]

        res = self.admin_client.put(f'/api/calendar/chantier-assignments/{clicked["id"]}/valider')
        self.assertEqual(res.status_code, 200, res.get_json())

        remaining = self.admin_client.get('/api/calendar?start=2026-10-01&end=2026-10-02')
        remaining_by_id = {i['id']: i for i in remaining.get_json() if i['source'] == 'chantier'}

        self.assertIn(clicked['id'], remaining_by_id)
        self.assertEqual(remaining_by_id[clicked['id']]['statut'], 'confirme')

        # WorkerB on the SAME winning date: still there, also confirmed —
        # this is exactly the bug (it used to be deleted).
        self.assertIn(same_date_other_employee['id'], remaining_by_id)
        self.assertEqual(remaining_by_id[same_date_other_employee['id']]['statut'], 'confirme')

        # Both employees' rows on the LOSING date: gone.
        self.assertNotIn(other_date_same_employee['id'], remaining_by_id)
        self.assertNotIn(other_date_other_employee['id'], remaining_by_id)

    def test_valider_rejects_already_confirmed_entry(self):
        create = self.admin_client.post('/api/calendar/chantier-assignments', json={
            'chantier_id': self.chantier_id, 'user_ids': [self.worker_a_id],
            'date_debut': '2026-08-01', 'date_fin': '2026-08-01', 'toute_la_journee': True,
        })
        assignment_id = create.get_json()[0]['id']
        res = self.admin_client.put(f'/api/calendar/chantier-assignments/{assignment_id}/valider')
        self.assertEqual(res.status_code, 400)


if __name__ == '__main__':
    unittest.main()
