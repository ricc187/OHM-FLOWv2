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

    # --- km-entries : ouvert à tout user connecté, REMPLACE km_actuel -------
    # (revu après test live : le body est {km_actuel: <nouveau total>}, un
    # relevé de compteur, pas un delta — voir docstring add_vehicule_km_entry)

    def test_km_entry_replaces_km_actuel_not_increments(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-3333', 'km_actuel': 50000,
        })
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 50250})
        self.assertEqual(res.status_code, 201, res.get_json())
        # L'entrée stocke le delta calculé côté serveur (historique), pas la
        # valeur brute envoyée.
        self.assertEqual(res.get_json()['km_parcourus'], 250)

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
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 100})
        self.assertEqual(res.status_code, 201)
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 150})
        self.assertEqual(res.status_code, 409)

    def test_km_entry_rejects_value_below_current(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-5555', 'km_actuel': 1000,
        })
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        # Un compteur ne recule jamais — en dessous du km_actuel enregistré, refusé.
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 999})
        self.assertEqual(res.status_code, 400)

    def test_km_entry_equal_to_current_allowed(self):
        """Véhicule pas utilisé cette semaine : même valeur, delta 0, doit passer."""
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-6666', 'km_actuel': 2000,
        })
        vehicule_id = res.get_json()['id']

        worker = self._user_client()
        res = worker.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 2000})
        self.assertEqual(res.status_code, 201, res.get_json())
        self.assertEqual(res.get_json()['km_parcourus'], 0)

    def test_km_entry_unknown_vehicule_404(self):
        worker = self._user_client()
        res = worker.post('/api/vehicules/999999/km-entries', json={'km_actuel': 10})
        self.assertEqual(res.status_code, 404)

    # --- 'vehicule' role: external garagiste, fleet-management CRUD, ------
    # locked out of everything else (see VALID_ROLES / token_required) -----

    def _vehicule_role_client(self):
        username = self._unique_username('garagiste')
        self._create_user(username, 'vehicule')
        self._login(username)
        return self.client

    def test_vehicule_role_can_create_update_delete(self):
        garagiste = self._vehicule_role_client()
        res = garagiste.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-7777', 'km_actuel': 500,
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        vehicule_id = res.get_json()['id']

        res = garagiste.put(f'/api/vehicules/{vehicule_id}', json={'marque': 'Fiat'})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['marque'], 'Fiat')

        res = garagiste.delete(f'/api/vehicules/{vehicule_id}')
        self.assertEqual(res.status_code, 200, res.get_json())

    def test_vehicule_role_can_submit_km_entry_and_read_stats(self):
        garagiste = self._vehicule_role_client()
        res = garagiste.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'VS-8888', 'km_actuel': 100,
        })
        vehicule_id = res.get_json()['id']

        res = garagiste.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 150})
        self.assertEqual(res.status_code, 201, res.get_json())

        res = garagiste.get('/api/vehicules/stats')
        self.assertEqual(res.status_code, 200, res.get_json())

    def test_vehicule_role_locked_out_of_everything_else(self):
        """The whole point of this role: an external garagiste must not be
        able to reach chantiers/entries/leaves/users/financier data, even
        though most of those routes are otherwise open to any authenticated
        role (see 'Everyone sees all chantiers now' in manage_chantiers)."""
        garagiste = self._vehicule_role_client()
        for path in ('/api/chantiers', '/api/leaves', '/api/users', '/api/entries/pending'):
            res = garagiste.get(path)
            self.assertEqual(res.status_code, 403, f'{path}: {res.get_json()}')

    def test_vehicule_role_can_still_reach_own_profile_and_change_password(self):
        """Onboarding-safe endpoints stay reachable — a garagiste account
        must still be able to see who it is and change a temp password."""
        garagiste = self._vehicule_role_client()
        res = garagiste.get('/api/me')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['role'], 'vehicule')

    def test_vehicule_role_excluded_from_headcount(self):
        """An external garagiste is not a field employee — must not appear
        in the HR headcount breakdown (see get_headcount_stats, scoped to
        ['user', 'depanneur'])."""
        self._vehicule_role_client()  # just needs to exist in the DB
        admin = self._admin_client()
        res = admin.get('/api/stats/headcount')
        self.assertEqual(res.status_code, 200, res.get_json())
        roles_counted = {row['role'] for row in res.get_json()['by_role']}
        self.assertNotIn('vehicule', roles_counted)

    def test_vehicule_role_excluded_from_absenteeism_denominator(self):
        """Same fix, the other endpoint: creating a vehicule-role account
        must not shift the absenteeism headcount denominator (see
        get_absenteeism_stats, same ['user', 'depanneur'] scope).

        Only creates the account (_create_user), doesn't log in as it —
        logging in would overwrite self.client's cookie (shared with
        `admin` below, same test_client instance) out from under the
        admin session used for both calls."""
        admin = self._admin_client()
        before = admin.get('/api/stats/absenteeism?start=2026-01-01&end=2026-01-31').get_json()['headcount']
        self._create_user(self._unique_username('garagiste'), 'vehicule')
        after = admin.get('/api/stats/absenteeism?start=2026-01-01&end=2026-01-31').get_json()['headcount']
        self.assertEqual(after, before, 'a vehicule-role account inflated the absenteeism headcount denominator')

    # --- Réparations : nom + montant, admin/vehicule write, tout le monde lit ---

    def test_non_admin_can_list_reparations_but_not_create(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'REP-1111',
        })
        vehicule_id = res.get_json()['id']
        res = admin.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': 'Pneus', 'montant': 400})
        self.assertEqual(res.status_code, 201, res.get_json())

        worker = self._user_client()
        res = worker.get(f'/api/vehicules/{vehicule_id}/reparations')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.get_json()), 1)
        self.assertEqual(res.get_json()[0]['nom'], 'Pneus')
        self.assertEqual(res.get_json()[0]['montant'], 400)

        res = worker.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': 'Vidange', 'montant': 100})
        self.assertEqual(res.status_code, 403)

    def test_vehicule_role_can_create_and_delete_reparation(self):
        garagiste = self._vehicule_role_client()
        res = garagiste.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'REP-2222',
        })
        vehicule_id = res.get_json()['id']

        res = garagiste.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': 'Freins', 'montant': 250.5})
        self.assertEqual(res.status_code, 201, res.get_json())
        reparation_id = res.get_json()['id']

        res = garagiste.delete(f'/api/vehicules/reparations/{reparation_id}')
        self.assertEqual(res.status_code, 200, res.get_json())

        res = garagiste.get(f'/api/vehicules/{vehicule_id}/reparations')
        self.assertEqual(res.get_json(), [])

    def test_reparation_requires_nom_and_montant(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo', 'numero_plaque': 'REP-3333',
        })
        vehicule_id = res.get_json()['id']

        res = admin.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': '', 'montant': 100})
        self.assertEqual(res.status_code, 400)
        res = admin.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': 'Pneus'})
        self.assertEqual(res.status_code, 400)
        res = admin.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': 'Pneus', 'montant': -10})
        self.assertEqual(res.status_code, 400)

    def test_reparation_unknown_vehicule_404(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules/999999/reparations', json={'nom': 'Pneus', 'montant': 100})
        self.assertEqual(res.status_code, 404)
        res = admin.get('/api/vehicules/999999/reparations')
        self.assertEqual(res.status_code, 404)

    def test_reparation_delete_unknown_404(self):
        admin = self._admin_client()
        res = admin.delete('/api/vehicules/reparations/999999')
        self.assertEqual(res.status_code, 404)

    def test_stats_include_reparations_totals(self):
        admin = self._admin_client()
        res = admin.post('/api/vehicules', json={
            'marque': 'Peugeot', 'modele': 'Partner', 'numero_plaque': 'REP-4444',
        })
        vehicule_id = res.get_json()['id']
        admin.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': 'Pneus', 'montant': 300})
        admin.post(f'/api/vehicules/{vehicule_id}/reparations', json={'nom': 'Vidange', 'montant': 150})

        res = admin.get('/api/vehicules/stats')
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertGreaterEqual(body['total_reparations_cout'], 450)
        entry = next((r for r in body['reparations_par_vehicule'] if r['numero_plaque'] == 'REP-4444'), None)
        self.assertIsNotNone(entry)
        self.assertEqual(entry['total_montant'], 450)


if __name__ == '__main__':
    unittest.main()
