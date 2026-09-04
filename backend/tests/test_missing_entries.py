"""Tests du menu "Heures non entrées" (/api/admin/missing-entries,
/api/admin/missing-entries/acknowledge).

Isolation : même pattern que test_stats_rh.py — importe app.py avec cwd
pointé sur un dossier temporaire, un utilisateur/chantier propre par test.

Lancer : python -m unittest tests.test_missing_entries -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest
import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_missing_entries_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))

# Le endpoint calcule SA PROPRE fenêtre à partir de la date réelle du run
# (aujourd'hui - 60j -> hier) — contrairement à test_stats_rh.py (start/end
# passés en query param), impossible d'ancrer sur une date fixe arbitraire
# ici : il faut un jour ouvré proche de la vraie date du jour.
def _recent_weekday(days_back):
    d = datetime.date.today() - datetime.timedelta(days=days_back)
    while d.weekday() >= 5:  # jamais samedi/dimanche
        d -= datetime.timedelta(days=1)
    return d


TUESDAY = _recent_weekday(10)  # ~10 jours en arrière, largement dans la fenêtre de 60j


class MissingEntriesTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.admin_id = admin.id
            cls.token = ohmapp.serializer.dumps({'user_id': admin.id})
        cls.client.set_cookie(ohmapp.COOKIE_NAME, cls.token)

    def setUp(self):
        with ohmapp.app.app_context():
            tag = self._testMethodName
            worker = ohmapp.User(username=f'MW_{tag}'[:40], role='user')
            worker.set_pin('1234')
            ohmapp.db.session.add(worker)
            ohmapp.db.session.commit()
            self.worker_id = worker.id

            chantier = ohmapp.Chantier(nom=f'Chantier {tag}'[:80], annee=2026, status='FUTURE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            self.chantier_id = chantier.id

    def _worker_client(self):
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, ohmapp.serializer.dumps({'user_id': self.worker_id}))
        return c

    def _assign(self, date_debut, date_fin=None, chantier_id=None):
        with ohmapp.app.app_context():
            a = ohmapp.ChantierAssignment(
                chantier_id=chantier_id or self.chantier_id, user_id=self.worker_id,
                date_debut=date_debut, date_fin=date_fin or date_debut,
                toute_la_journee=True, statut='confirme',
            )
            ohmapp.db.session.add(a)
            ohmapp.db.session.commit()

    # --- Access control ---------------------------------------------------

    def test_endpoints_require_admin(self):
        worker = self._worker_client()
        self.assertEqual(worker.get('/api/admin/missing-entries').status_code, 403)
        self.assertEqual(
            worker.post('/api/admin/missing-entries/acknowledge', json={'user_id': self.worker_id, 'date': TUESDAY.isoformat()}).status_code,
            403,
        )

    # --- Detection logic -----------------------------------------------

    def test_flags_assignment_without_entry_or_leave(self):
        self._assign(TUESDAY.isoformat())
        res = self.client.get('/api/admin/missing-entries')
        self.assertEqual(res.status_code, 200, res.get_json())
        hits = [a for a in res.get_json()['anomalies'] if a['user_id'] == self.worker_id and a['date'] == TUESDAY.isoformat()]
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]['user_name'], f'MW_{self._testMethodName}'[:40])
        self.assertEqual([c['id'] for c in hits[0]['chantiers']], [self.chantier_id])

    def test_ignores_day_with_entry_regardless_of_status(self):
        self._assign(TUESDAY.isoformat())
        with ohmapp.app.app_context():
            entry = ohmapp.Entry(
                user_id=self.worker_id, chantier_id=self.chantier_id,
                date=TUESDAY.isoformat(), heures=1.0, status='PENDING',
            )
            ohmapp.db.session.add(entry)
            ohmapp.db.session.commit()

        res = self.client.get('/api/admin/missing-entries')
        hits = [a for a in res.get_json()['anomalies'] if a['user_id'] == self.worker_id and a['date'] == TUESDAY.isoformat()]
        self.assertEqual(hits, [])

    def test_ignores_day_covered_by_approved_leave(self):
        self._assign(TUESDAY.isoformat())
        with ohmapp.app.app_context():
            leave = ohmapp.Leave(
                user_id=self.worker_id, type='CONGE', status='APPROVED',
                date_start=TUESDAY.isoformat(), date_end=TUESDAY.isoformat(), days_count=1.0,
            )
            ohmapp.db.session.add(leave)
            ohmapp.db.session.commit()

        res = self.client.get('/api/admin/missing-entries')
        hits = [a for a in res.get_json()['anomalies'] if a['user_id'] == self.worker_id and a['date'] == TUESDAY.isoformat()]
        self.assertEqual(hits, [])

    def test_does_not_ignore_day_with_pending_leave(self):
        # Une leave PENDING (pas encore approuvée) ne couvre pas l'anomalie.
        self._assign(TUESDAY.isoformat())
        with ohmapp.app.app_context():
            leave = ohmapp.Leave(
                user_id=self.worker_id, type='CONGE', status='PENDING',
                date_start=TUESDAY.isoformat(), date_end=TUESDAY.isoformat(), days_count=1.0,
            )
            ohmapp.db.session.add(leave)
            ohmapp.db.session.commit()

        res = self.client.get('/api/admin/missing-entries')
        hits = [a for a in res.get_json()['anomalies'] if a['user_id'] == self.worker_id and a['date'] == TUESDAY.isoformat()]
        self.assertEqual(len(hits), 1)

    def test_ignores_proposition_assignment(self):
        with ohmapp.app.app_context():
            a = ohmapp.ChantierAssignment(
                chantier_id=self.chantier_id, user_id=self.worker_id,
                date_debut=TUESDAY.isoformat(), date_fin=TUESDAY.isoformat(),
                toute_la_journee=True, statut='proposition', proposal_group_id='x',
            )
            ohmapp.db.session.add(a)
            ohmapp.db.session.commit()

        res = self.client.get('/api/admin/missing-entries')
        hits = [a for a in res.get_json()['anomalies'] if a['user_id'] == self.worker_id]
        self.assertEqual(hits, [])

    def test_skips_weekend_days_in_assignment_range(self):
        # Vendredi -> lundi (couvre le weekend) : seuls les jours ouvrés
        # (vendredi + lundi) doivent générer une anomalie, pas samedi/dimanche.
        friday = datetime.date.today() - datetime.timedelta(days=14)
        while friday.weekday() != 4:
            friday -= datetime.timedelta(days=1)
        next_monday = friday + datetime.timedelta(days=3)
        self._assign(friday.isoformat(), next_monday.isoformat())
        res = self.client.get('/api/admin/missing-entries')
        dates = {a['date'] for a in res.get_json()['anomalies'] if a['user_id'] == self.worker_id}
        self.assertEqual(dates, {friday.isoformat(), next_monday.isoformat()})

    # --- Acknowledge -----------------------------------------------------

    def test_acknowledge_removes_anomaly_and_is_idempotent_guarded(self):
        self._assign(TUESDAY.isoformat())
        res = self.client.post('/api/admin/missing-entries/acknowledge', json={
            'user_id': self.worker_id, 'date': TUESDAY.isoformat(), 'reason': 'Oubli, régularisé oralement'
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        body = res.get_json()
        self.assertEqual(body['user_id'], self.worker_id)
        self.assertEqual(body['acknowledged_by_id'], self.admin_id)
        self.assertEqual(body['reason'], 'Oubli, régularisé oralement')

        # Disparu de la liste.
        res2 = self.client.get('/api/admin/missing-entries')
        hits = [a for a in res2.get_json()['anomalies'] if a['user_id'] == self.worker_id and a['date'] == TUESDAY.isoformat()]
        self.assertEqual(hits, [])

        # Un second acquittement sur la même (user_id, date) est refusé (contrainte unique).
        res3 = self.client.post('/api/admin/missing-entries/acknowledge', json={
            'user_id': self.worker_id, 'date': TUESDAY.isoformat()
        })
        self.assertEqual(res3.status_code, 409)

    def test_acknowledge_reason_optional(self):
        self._assign(TUESDAY.isoformat())
        res = self.client.post('/api/admin/missing-entries/acknowledge', json={
            'user_id': self.worker_id, 'date': TUESDAY.isoformat()
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        self.assertIsNone(res.get_json()['reason'])

    def test_acknowledge_requires_valid_user_and_date(self):
        res = self.client.post('/api/admin/missing-entries/acknowledge', json={'user_id': 999999, 'date': TUESDAY.isoformat()})
        self.assertEqual(res.status_code, 404)
        res = self.client.post('/api/admin/missing-entries/acknowledge', json={'user_id': self.worker_id, 'date': 'not-a-date'})
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/admin/missing-entries/acknowledge', json={'date': TUESDAY.isoformat()})
        self.assertEqual(res.status_code, 400)


if __name__ == '__main__':
    unittest.main()
