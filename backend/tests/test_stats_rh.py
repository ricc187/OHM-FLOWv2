"""Tests des endpoints RH & Planning (/api/stats/absenteeism,
/api/stats/headcount, /api/stats/planned-vs-actual-hours) et du fix du KPI
"chantiers actifs" de /api/stats.

Isolation : même pattern que test_entries_api.py — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_stats_rh -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest
import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_stats_rh_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))

# Semaine complète (lundi -> dimanche) déterministe, peu importe la date du
# jour du run — dérivée par arithmétique modulaire, jamais un jour de la
# semaine "deviné" en dur.
_ANCHOR = datetime.date(2026, 1, 1)
MONDAY = _ANCHOR - datetime.timedelta(days=_ANCHOR.weekday()) + datetime.timedelta(days=7)
FRIDAY = MONDAY + datetime.timedelta(days=4)
SUNDAY = MONDAY + datetime.timedelta(days=6)


class StatsRhTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.admin_id = admin.id
            cls.token = ohmapp.serializer.dumps({'user_id': admin.id})
        cls.client.set_cookie(ohmapp.COOKIE_NAME, cls.token)

    def setUp(self):
        # Utilisateurs/chantier propres à CHAQUE test (noms uniques via
        # _testMethodName) — les leaves/assignments d'un test ne doivent
        # jamais fuiter dans le calcul d'un autre (pas de reset de table
        # entre tests, seulement setUpClass qui ne tourne qu'une fois).
        with ohmapp.app.app_context():
            tag = self._testMethodName
            worker_a = ohmapp.User(username=f'RhA_{tag}'[:40], role='user')
            worker_a.set_pin('1234')
            worker_b = ohmapp.User(username=f'RhB_{tag}'[:40], role='depanneur')
            worker_b.set_pin('1234')
            ohmapp.db.session.add_all([worker_a, worker_b])
            ohmapp.db.session.commit()
            self.worker_a_id = worker_a.id
            self.worker_b_id = worker_b.id

            chantier = ohmapp.Chantier(nom=f'Chantier {tag}'[:80], annee=2026, status='FUTURE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            self.chantier_id = chantier.id

    def _worker_client(self, user_id):
        token = ohmapp.serializer.dumps({'user_id': user_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)
        return c

    # --- Access control -----------------------------------------------

    def test_endpoints_require_admin(self):
        worker = self._worker_client(self.worker_a_id)
        for url in (
            f'/api/stats/absenteeism?start={MONDAY}&end={SUNDAY}',
            '/api/stats/headcount',
            f'/api/stats/planned-vs-actual-hours?start={MONDAY}&end={SUNDAY}',
        ):
            res = worker.get(url)
            self.assertEqual(res.status_code, 403, url)

    def test_absenteeism_requires_dates(self):
        res = self.client.get('/api/stats/absenteeism')
        self.assertEqual(res.status_code, 400)
        res = self.client.get(f'/api/stats/absenteeism?start={MONDAY}')
        self.assertEqual(res.status_code, 400)

    # --- Absenteeism -----------------------------------------------------

    def test_absenteeism_counts_business_days_only_and_excludes_admin(self):
        # Congé APPROVED sur toute la semaine (lundi -> dimanche) : ne doit
        # compter que les 5 jours ouvrés (weekend exclu).
        with ohmapp.app.app_context():
            leave = ohmapp.Leave(
                user_id=self.worker_a_id, type='CONGE', status='APPROVED',
                date_start=MONDAY.isoformat(), date_end=SUNDAY.isoformat(),
                days_count=7.0,
            )
            ohmapp.db.session.add(leave)
            # Une leave PENDING ne doit pas compter.
            pending = ohmapp.Leave(
                user_id=self.worker_b_id, type='MALADIE', status='PENDING',
                date_start=MONDAY.isoformat(), date_end=MONDAY.isoformat(), days_count=1.0,
            )
            ohmapp.db.session.add(pending)
            # Une leave sur l'Admin (exclu du périmètre) même APPROVED.
            admin_leave = ohmapp.Leave(
                user_id=self.admin_id, type='CONGE', status='APPROVED',
                date_start=MONDAY.isoformat(), date_end=FRIDAY.isoformat(), days_count=5.0,
            )
            ohmapp.db.session.add(admin_leave)
            ohmapp.db.session.commit()

        res = self.client.get(f'/api/stats/absenteeism?start={MONDAY}&end={SUNDAY}')
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual(body['working_days_period'], 5)
        self.assertGreaterEqual(body['headcount'], 2)  # au moins WorkerA + WorkerB (non-admin)
        # >= et pas == : le périmètre non-admin/la période sont partagés avec
        # les autres tests de cette classe (même semaine MONDAY..SUNDAY, pas
        # de table reset entre méthodes) — seuls by_type/by_employee, propres
        # à CE worker_a_id, peuvent être vérifiés à une valeur exacte.
        self.assertGreaterEqual(body['absence_days_total'], 5.0)
        by_type = {t['type']: t['days'] for t in body['by_type']}
        self.assertGreaterEqual(by_type.get('CONGE', 0), 5.0)
        by_employee = {e['user_id']: e['days'] for e in body['by_employee']}
        self.assertEqual(by_employee.get(self.worker_a_id), 5.0)
        self.assertNotIn(self.admin_id, by_employee)  # admin exclu du périmètre
        self.assertIsNotNone(body['rate'])

    def test_absenteeism_clips_leave_to_period(self):
        # Congé qui déborde largement la période demandée : seule
        # l'intersection doit compter.
        with ohmapp.app.app_context():
            leave = ohmapp.Leave(
                user_id=self.worker_a_id, type='ABSENCE', status='APPROVED',
                date_start=(MONDAY - datetime.timedelta(days=30)).isoformat(),
                date_end=(SUNDAY + datetime.timedelta(days=30)).isoformat(),
                days_count=61.0,
            )
            ohmapp.db.session.add(leave)
            ohmapp.db.session.commit()

        res = self.client.get(f'/api/stats/absenteeism?start={MONDAY}&end={FRIDAY}')
        body = res.get_json()
        by_employee = {e['user_id']: e['days'] for e in body['by_employee']}
        self.assertEqual(by_employee.get(self.worker_a_id), 5.0)  # pas 61

    # --- Headcount ---------------------------------------------------------

    def test_headcount_excludes_admin_and_splits_by_role(self):
        res = self.client.get('/api/stats/headcount')
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        by_role = {r['role']: r['count'] for r in body['by_role']}
        self.assertNotIn('admin', by_role)
        self.assertGreaterEqual(by_role.get('user', 0), 1)
        self.assertGreaterEqual(by_role.get('depanneur', 0), 1)
        self.assertEqual(body['total'], sum(by_role.values()))

    # --- Planned vs actual hours --------------------------------------

    def test_planned_vs_actual_hours_uses_confirme_only_and_workday_hours(self):
        with ohmapp.app.app_context():
            # Confirmée, toute la journée, lundi->vendredi : doit compter
            # 4*9.0 + 4.5 = 40.5h (voir WORKDAY_HOURS, vendredi = demi-journée).
            confirmed = ohmapp.ChantierAssignment(
                chantier_id=self.chantier_id, user_id=self.worker_a_id,
                date_debut=MONDAY.isoformat(), date_fin=FRIDAY.isoformat(),
                toute_la_journee=True, statut='confirme',
            )
            ohmapp.db.session.add(confirmed)
            # Proposition (non confirmée) sur la même période : ne doit PAS compter.
            proposal = ohmapp.ChantierAssignment(
                chantier_id=self.chantier_id, user_id=self.worker_b_id,
                date_debut=MONDAY.isoformat(), date_fin=FRIDAY.isoformat(),
                toute_la_journee=True, statut='proposition', proposal_group_id='x',
            )
            ohmapp.db.session.add(proposal)
            # Heures réelles pointées sur le même chantier dans la période.
            entry = ohmapp.Entry(
                user_id=self.worker_a_id, chantier_id=self.chantier_id,
                date=MONDAY.isoformat(), heures=8.0, materiel=0.0,
            )
            ohmapp.db.session.add(entry)
            ohmapp.db.session.commit()

        res = self.client.get(
            f'/api/stats/planned-vs-actual-hours?start={MONDAY}&end={SUNDAY}&group_by=chantier'
        )
        self.assertEqual(res.status_code, 200, res.get_json())
        rows = {r['id']: r for r in res.get_json()['rows']}
        row = rows[self.chantier_id]
        self.assertEqual(row['planned'], 40.5)  # proposition ignorée
        self.assertEqual(row['actual'], 8.0)
        self.assertEqual(row['delta'], round(8.0 - 40.5, 1))

        # Groupé par employé : WorkerB (proposition seulement) n'a pas de
        # heures planifiées, WorkerA a bien ses 40.5h.
        res_user = self.client.get(
            f'/api/stats/planned-vs-actual-hours?start={MONDAY}&end={SUNDAY}&group_by=user'
        )
        rows_user = {r['id']: r for r in res_user.get_json()['rows']}
        self.assertEqual(rows_user[self.worker_a_id]['planned'], 40.5)
        self.assertNotIn(self.worker_b_id, rows_user)

    def test_planned_vs_actual_hours_rejects_bad_group_by(self):
        res = self.client.get(
            f'/api/stats/planned-vs-actual-hours?start={MONDAY}&end={SUNDAY}&group_by=bogus'
        )
        self.assertEqual(res.status_code, 400)

    # --- KPI "chantiers actifs" fix (/api/stats) ------------------------

    def test_active_chantiers_kpi_uses_has_assignments_not_manual_status(self):
        with ohmapp.app.app_context():
            # FUTURE + une assignment confirmée = compte comme "actif" (EN_COURS
            # côté frontend), même si le champ status brut ne dit jamais 'ACTIVE'.
            c = ohmapp.Chantier(nom='Chantier Actif Via Assignment', annee=2026, status='FUTURE')
            ohmapp.db.session.add(c)
            ohmapp.db.session.commit()
            a = ohmapp.ChantierAssignment(
                chantier_id=c.id, user_id=self.worker_a_id,
                date_debut=MONDAY.isoformat(), date_fin=MONDAY.isoformat(),
                toute_la_journee=True, statut='confirme',
            )
            ohmapp.db.session.add(a)
            ohmapp.db.session.commit()
            target_id = c.id

        res = self.client.get('/api/stats')
        self.assertEqual(res.status_code, 200, res.get_json())
        # On ne peut pas lire la liste des chantiers actifs directement (juste
        # un compteur), donc on vérifie via /api/chantiers?has_assignments=true
        # + status que ce chantier EST bien dans le périmètre "actif" attendu.
        check = self.client.get('/api/chantiers?has_assignments=true')
        ids = [ch['id'] for ch in check.get_json() if ch['status'] != 'DONE']
        self.assertIn(target_id, ids)
        self.assertGreaterEqual(res.get_json()['active_chantiers'], 1)


if __name__ == '__main__':
    unittest.main()
