"""Teste le garde-fou POST /api/entries : refuse la création d'une entrée
d'heures tant que le chantier n'a pas de ChantierAssignment (has_assignments
= False, "Pot à chantier") — tout le reste de la fiche chantier reste
éditable, seule la saisie d'heures est bloquée (voir prompt "chantiers en
attente").

Isolation : même pattern que les autres tests API — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_has_assignments_gate -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_has_assignments_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)

ohmapp.limiter.enabled = False  # même raison que test_auth.py

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))

STRONG_PASSWORD = 'Correct-Horse-Battery-99'


class HasAssignmentsGateTestCase(unittest.TestCase):
    def setUp(self):
        self.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            user = ohmapp.User(
                username=f'worker_{self._testMethodName}', role='user',
                must_change_password=False, mfa_enabled=True,
                pin_hash=ohmapp.generate_password_hash('unused'),
            )
            user.set_password(STRONG_PASSWORD)
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
            self.user_id = user.id

        res = self.client.post('/api/login', json={
            'username': f'worker_{self._testMethodName}', 'password': STRONG_PASSWORD,
        })
        self.assertEqual(res.status_code, 200, res.get_json())

    def _admin_client(self):
        # PUT /api/chantiers/<id> est admin-only — role='admin' est dans
        # MFA_REQUIRED_ROLES, donc même contournement que test_vehicules_api.py
        # (mint direct du token de session plutôt que /api/login).
        with ohmapp.app.app_context():
            admin = ohmapp.User(
                username=f'admin_{self._testMethodName}', role='admin',
                must_change_password=False, mfa_enabled=True,
                pin_hash=ohmapp.generate_password_hash('unused'),
            )
            admin.set_password(STRONG_PASSWORD)
            ohmapp.db.session.add(admin)
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': admin.id})
        client = ohmapp.app.test_client()
        client.set_cookie(ohmapp.COOKIE_NAME, token)
        return client

    def _create_chantier(self, planned):
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=f'Chantier {self._testMethodName}', annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            if planned:
                ohmapp.db.session.add(ohmapp.ChantierAssignment(
                    chantier_id=chantier.id, user_id=self.user_id,
                    date_debut='2026-01-05', date_fin='2026-01-05',
                ))
                ohmapp.db.session.commit()
            return chantier.id

    def test_entry_rejected_on_unplanned_chantier(self):
        chantier_id = self._create_chantier(planned=False)
        res = self.client.post('/api/entries', json={
            'chantier_id': chantier_id, 'date': '2026-01-05', 'heures': 4,
            'description': 'Test',
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn('Agenda', res.get_json()['error'])

    def test_entry_allowed_once_planned(self):
        chantier_id = self._create_chantier(planned=True)
        res = self.client.post('/api/entries', json={
            'chantier_id': chantier_id, 'date': '2026-01-05', 'heures': 4,
            'description': 'Test',
        })
        self.assertEqual(res.status_code, 201, res.get_json())

    def test_entry_allowed_after_chantier_becomes_planned(self):
        """Même chantier, pas de recréation : la planification en Agenda
        (ChantierAssignment ajoutée après coup) doit débloquer sans autre
        changement côté chantier lui-même."""
        chantier_id = self._create_chantier(planned=False)
        res = self.client.post('/api/entries', json={
            'chantier_id': chantier_id, 'date': '2026-01-05', 'heures': 4,
            'description': 'Test',
        })
        self.assertEqual(res.status_code, 400)

        with ohmapp.app.app_context():
            ohmapp.db.session.add(ohmapp.ChantierAssignment(
                chantier_id=chantier_id, user_id=self.user_id,
                date_debut='2026-01-06', date_fin='2026-01-06',
            ))
            ohmapp.db.session.commit()

        res = self.client.post('/api/entries', json={
            'chantier_id': chantier_id, 'date': '2026-01-05', 'heures': 4,
            'description': 'Test',
        })
        self.assertEqual(res.status_code, 201, res.get_json())

    def test_unplanned_chantier_still_editable_otherwise(self):
        """Tout le reste de la fiche reste éditable — le garde-fou ne
        s'applique qu'à POST /api/entries, pas à PUT /api/chantiers/<id>."""
        chantier_id = self._create_chantier(planned=False)
        admin = self._admin_client()
        res = admin.put(f'/api/chantiers/{chantier_id}', json={'remarque': 'Note ajoutée'})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['remarque'], 'Note ajoutée')


if __name__ == '__main__':
    unittest.main()
