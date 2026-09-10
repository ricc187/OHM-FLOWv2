"""Tests du module Véhicules : CRUD /api/vehicules (admin-only pour
POST/PUT/DELETE, lecture ouverte à tout user connecté) et relevés
kilométriques hebdomadaires (POST /api/vehicules/<id>/km-entries).

Isolation : même pattern que les autres tests API — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_vehicules_api -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_vehicules_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)

# Chaque test se connecte avec un nouveau compte (voir _unique_username) —
# largement plus que la limite de /api/login (voir test_auth.py, même
# raison : Flask-Limiter lit sa config une fois à l'import, donc seul
# .enabled peut être togglé après coup).
ohmapp.limiter.enabled = False

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))

STRONG_PASSWORD = 'Correct-Horse-Battery-99'


class VehiculesApiTestCase(unittest.TestCase):
    """Chaque test crée ses propres comptes/véhicules pour rester isolé,
    même raison que test_auth.py (pas de setUpClass partagé)."""

    def setUp(self):
        self.client = ohmapp.app.test_client()
        self._user_counter = 0

    def _unique_username(self, prefix):
        # Un seul module importé une fois pour toute la classe (voir import
        # app.py en tête de fichier) : la DB SQLite persiste entre les tests,
        # donc un nom fixe entrerait en collision avec users.username unique
        # dès le 2e test qui en crée un. Suffixe par test-id + compteur pour
        # rester unique même avec plusieurs appels dans un même test.
        self._user_counter += 1
        safe_test_id = self.id().rsplit('.', 1)[-1]
        return f"{prefix}_{safe_test_id}_{self._user_counter}"[:80]

    def _create_user(self, username, role, password=STRONG_PASSWORD):
        with ohmapp.app.app_context():
            user = ohmapp.User(
                username=username, role=role, must_change_password=False,
                mfa_enabled=True,
                pin_hash=ohmapp.generate_password_hash('unused'),
            )
            user.set_password(password)
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
            return user.id

    def _login(self, username, password=STRONG_PASSWORD):
        res = self.client.post('/api/login', json={'username': username, 'password': password})
        self.assertEqual(res.status_code, 200, res.get_json())
        return res

    def _admin_client(self):
        # Pas via /api/login : role='admin' est dans MFA_REQUIRED_ROLES
        # (voir app.py), donc même avec mfa_enabled=True le login normal
        # s'arrêterait à la vérification TOTP (status 'mfa_required', pas de
        # cookie de session) — même contournement que test_entries_api.py /
        # test_financier_api.py / test_calendar_api.py : mint directement le
        # token de session (serializer), comme le ferait un admin déjà
        # pleinement onboardé.
        username = self._unique_username('admin_veh')
        user_id = self._create_user(username, 'admin')
        token = ohmapp.serializer.dumps({'user_id': user_id})
        self.client.set_cookie(ohmapp.COOKIE_NAME, token)
        return self.client

    def _user_client(self):
        username = self._unique_username('user_veh')
        self._create_user(username, 'user')
        self._login(username)
        return self.client

    # --- GET list/detail : ouvert à tout user connecté ---

    def test_list_requires_auth(self):
        res = self.client.get('/api/vehicules')
        self.assertEqual(res.status_code, 401)

    def test_non_admin_can_list_and_get_detail(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-1234', 'km_actuel': 10000,
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        res = worker.get('/api/vehicules')
        self.assertEqual(res.status_code, 200)
        # Pas d'assertion sur la taille totale de la liste : la DB (module-
        # level, voir import app.py en tête de fichier) est partagée entre
        # tous les tests de cette classe, donc d'autres véhicules créés par
        # d'autres tests peuvent déjà y être.
        self.assertIn('VS-1234', [v['numero_plaque'] for v in res.get_json()])

        res = worker.get(f'/api/vehicules/{vehicule_id}')
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(body['numero_plaque'], 'VS-1234')
        self.assertEqual(body['km_entries'], [])

    # --- POST/PUT/DELETE : admin only ---

    def test_non_admin_cannot_create(self):
        worker = self._user_client()
        res = worker.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-1234',
        })
        self.assertEqual(res.status_code, 403)

    def test_create_missing_fields_rejected(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={'marque': 'Renault'})
        self.assertEqual(res.status_code, 400)

    def test_create_duplicate_plaque_rejected(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-9999',
        })
        self.assertEqual(res.status_code, 201)
        res = admin.post('/api/vehicules', json={
            'marque': 'Peugeot', 'modele': 'Partner', 'numero_plaque': 'VS-9999',
        })
        self.assertEqual(res.status_code, 409)

    def test_non_admin_cannot_update_or_delete(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-1111',
        })
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        res = worker.put(f'/api/vehicules/{vehicule_id}', json={'marque': 'Fiat'})
        self.assertEqual(res.status_code, 403)
        res = worker.delete(f'/api/vehicules/{vehicule_id}')
        self.assertEqual(res.status_code, 403)

    def test_admin_can_update_and_delete(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-2222',
        })
        vehicule_id = res.get_json()['id']

        res = admin.put(f'/api/vehicules/{vehicule_id}', json={'modele': 'Trafic'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['modele'], 'Trafic')

        res = admin.delete(f'/api/vehicules/{vehicule_id}')
        self.assertEqual(res.status_code, 200)
        res = admin.get(f'/api/vehicules/{vehicule_id}')
        self.assertEqual(res.status_code, 404)

    # --- km-entries : ouvert à tout user connecté, incrémente km_actuel ---

    def test_km_entry_increments_km_actuel_not_replaces(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-3333', 'km_actuel': 50000,
        })
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_parcourus': 250})
        self.assertEqual(res.status_code, 201, res.get_json())

        res = worker.get(f'/api/vehicules/{vehicule_id}')
        body = res.get_json()
        self.assertEqual(body['km_actuel'], 50250)
        self.assertEqual(len(body['km_entries']), 1)
        self.assertEqual(body['km_entries'][0]['km_parcourus'], 250)

    def test_km_entry_duplicate_same_week_rejected(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-4444',
        })
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_parcourus': 100})
        self.assertEqual(res.status_code, 201)
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_parcourus': 50})
        self.assertEqual(res.status_code, 409)

    def test_km_entry_rejects_negative(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-5555',
        })
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_parcourus': -10})
        self.assertEqual(res.status_code, 400)

    def test_km_entry_unknown_vehicule_404(self):
        worker = self._user_client()
        res = worker.post('/api/vehicules/999999/km-entries', json={'km_parcourus': 10})
        self.assertEqual(res.status_code, 404)


if __name__ == '__main__':
    unittest.main()
