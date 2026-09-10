"""Tests de la logique du popup hebdomadaire de relevé kilométrique :
- déclenchement (vendredi, >= 10h00, heure serveur, une fois par semaine ISO)
- "Non" ferme la semaine immédiatement
- "Oui" ouvre un blocage (pending_km_entry) qui persiste jusqu'à ce qu'un
  relevé de km soit soumis — y compris si la semaine ISO change entre-temps
  (voir _resolve_weekly_km_prompt / get_weekly_km_prompt_status dans app.py)

Isolation : même pattern que les autres tests API — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_weekly_km_prompt -v   (depuis backend/)
"""
import datetime
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_weekly_km_test_')
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

_REAL_DATETIME = datetime.datetime


class _FrozenDateTime(_REAL_DATETIME):
    """Sous-classe de datetime.datetime : seule .now() est figée, tout le
    reste (strptime, timedelta, isocalendar, ...) se comporte normalement —
    substituée à ohmapp.datetime.datetime le temps d'un test (voir
    _freeze/_unfreeze)."""
    _frozen = None

    @classmethod
    def now(cls, tz=None):
        return cls._frozen


def _next_or_today_friday(base_date, hour=10, minute=30):
    """Date/heure d'un vendredi >= 10h00, à partir de `base_date` — calculé
    plutôt que codé en dur pour ne pas dépendre d'une date fixe qui finirait
    par ne plus être un vendredi si le test tourne une autre année."""
    days_ahead = (4 - base_date.weekday()) % 7  # Monday=0 ... Friday=4
    friday = base_date + datetime.timedelta(days=days_ahead)
    return datetime.datetime(friday.year, friday.month, friday.day, hour, minute)


class WeeklyKmPromptTestCase(unittest.TestCase):
    def setUp(self):
        self.client = ohmapp.app.test_client()
        self._user_counter = 0

    def tearDown(self):
        self._unfreeze()

    def _unique_username(self, prefix):
        self._user_counter += 1
        safe_test_id = self.id().rsplit('.', 1)[-1]
        return f"{prefix}_{safe_test_id}_{self._user_counter}"[:80]

    def _freeze(self, dt):
        _FrozenDateTime._frozen = dt
        ohmapp.datetime.datetime = _FrozenDateTime

    def _unfreeze(self):
        ohmapp.datetime.datetime = _REAL_DATETIME

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

    def _login_user(self):
        username = self._unique_username('kmuser')
        self._create_user(username, 'user')
        res = self.client.post('/api/login', json={'username': username, 'password': STRONG_PASSWORD})
        self.assertEqual(res.status_code, 200, res.get_json())
        return self.client

    def _admin_client(self):
        # role='admin' est dans MFA_REQUIRED_ROLES — même contournement que
        # test_vehicules_api.py (mint direct du token de session).
        username = self._unique_username('kmadmin')
        user_id = self._create_user(username, 'admin')
        token = ohmapp.serializer.dumps({'user_id': user_id})
        self.client.set_cookie(ohmapp.COOKIE_NAME, token)
        return self.client

    def _create_vehicule(self, admin_client):
        res = admin_client.post('/api/vehicules', json={
            'marque': 'Renault', 'modele': 'Kangoo',
            'numero_plaque': self._unique_username('WKM'),
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        return res.get_json()['id']

    # --- Déclenchement ---

    def test_status_requires_auth(self):
        res = self.client.get('/api/weekly-km-prompt/status')
        self.assertEqual(res.status_code, 401)

    def test_no_popup_outside_friday_window(self):
        client = self._login_user()
        # Jeudi 14h — pas vendredi
        base = datetime.date.today()
        thursday_ref = _next_or_today_friday(base) - datetime.timedelta(days=1)
        self._freeze(thursday_ref.replace(hour=14))
        res = client.get('/api/weekly-km-prompt/status')
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertFalse(body['show_popup'])
        self.assertFalse(body['pending_km_entry'])

    def test_no_popup_friday_before_10h(self):
        client = self._login_user()
        self._freeze(_next_or_today_friday(datetime.date.today(), hour=9, minute=59))
        res = client.get('/api/weekly-km-prompt/status')
        self.assertFalse(res.get_json()['show_popup'])

    def test_popup_shows_friday_after_10h_when_not_yet_answered(self):
        client = self._login_user()
        self._freeze(_next_or_today_friday(datetime.date.today()))
        res = client.get('/api/weekly-km-prompt/status')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()['show_popup'])
        self.assertFalse(res.get_json()['pending_km_entry'])

    # --- "Non" ---

    def test_respond_invalid_value_rejected(self):
        client = self._login_user()
        res = client.post('/api/weekly-km-prompt/respond', json={'reponse': 'peut-etre'})
        self.assertEqual(res.status_code, 400)

    def test_respond_non_closes_the_week(self):
        client = self._login_user()
        friday = _next_or_today_friday(datetime.date.today())
        self._freeze(friday)

        res = client.post('/api/weekly-km-prompt/respond', json={'reponse': 'non'})
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertTrue(body['repondu'])
        self.assertFalse(body['pending_km_entry'])

        # Popup ne se réaffiche plus cette semaine, même toujours vendredi >=10h
        res = client.get('/api/weekly-km-prompt/status')
        self.assertFalse(res.get_json()['show_popup'])

        # ... mais réapparaît le vendredi suivant (nouvelle semaine ISO)
        next_friday = friday + datetime.timedelta(days=7)
        self._freeze(next_friday)
        res = client.get('/api/weekly-km-prompt/status')
        self.assertTrue(res.get_json()['show_popup'])

    # --- "Oui" + blocage + résolution ---

    def test_respond_oui_opens_pending_block_not_repondu(self):
        client = self._login_user()
        self._freeze(_next_or_today_friday(datetime.date.today()))

        res = client.post('/api/weekly-km-prompt/respond', json={'reponse': 'oui'})
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertFalse(body['repondu'])
        self.assertTrue(body['pending_km_entry'])

        res = client.get('/api/weekly-km-prompt/status')
        status = res.get_json()
        self.assertFalse(status['show_popup'])  # ne reproprose pas Oui/Non
        self.assertTrue(status['pending_km_entry'])  # mais bloque toujours

    def test_km_entry_resolves_pending_block(self):
        admin = self._admin_client()
        vehicule_id = self._create_vehicule(admin)

        client = self._login_user()
        self._freeze(_next_or_today_friday(datetime.date.today()))
        client.post('/api/weekly-km-prompt/respond', json={'reponse': 'oui'})

        res = client.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 42})
        self.assertEqual(res.status_code, 201, res.get_json())

        res = client.get('/api/weekly-km-prompt/status')
        status = res.get_json()
        self.assertFalse(status['pending_km_entry'])
        self.assertFalse(status['show_popup'])  # semaine déjà répondue

    def test_pending_block_survives_iso_week_rollover(self):
        """Oui cliqué un vendredi, résolu seulement le lundi suivant — déjà
        une semaine ISO différente (ISO = lundi-dimanche). Le blocage doit
        rester actif entre-temps, pas disparaître au changement de semaine."""
        admin = self._admin_client()
        vehicule_id = self._create_vehicule(admin)

        client = self._login_user()
        friday = _next_or_today_friday(datetime.date.today())
        self._freeze(friday)
        client.post('/api/weekly-km-prompt/respond', json={'reponse': 'oui'})

        following_monday = friday + datetime.timedelta(days=3)
        self._freeze(following_monday)

        # Le blocage persiste malgré le changement de semaine ISO
        res = client.get('/api/weekly-km-prompt/status')
        status = res.get_json()
        self.assertTrue(status['pending_km_entry'])
        self.assertNotEqual(status['semaine_iso'], ohmapp._iso_week_str(following_monday))

        # Et se résout bien quand le relevé arrive enfin
        res = client.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 15})
        self.assertEqual(res.status_code, 201, res.get_json())
        res = client.get('/api/weekly-km-prompt/status')
        self.assertFalse(res.get_json()['pending_km_entry'])

    def test_km_entry_without_prior_prompt_still_marks_week_answered(self):
        """Un relevé loggé sans être passé par le popup (aucun Oui/Non
        préalable) doit quand même éviter que le popup redemande cette
        semaine-là — voir _resolve_weekly_km_prompt."""
        admin = self._admin_client()
        vehicule_id = self._create_vehicule(admin)

        client = self._login_user()
        friday = _next_or_today_friday(datetime.date.today())
        self._freeze(friday)

        res = client.post(f'/api/vehicules/{vehicule_id}/km-entries', json={'km_actuel': 7})
        self.assertEqual(res.status_code, 201, res.get_json())

        res = client.get('/api/weekly-km-prompt/status')
        status = res.get_json()
        self.assertFalse(status['show_popup'])
        self.assertFalse(status['pending_km_entry'])

    def test_admin_role_also_gets_the_popup(self):
        """Confirmé dans le prompt : pas d'exclusion des admins."""
        admin = self._admin_client()
        self._freeze(_next_or_today_friday(datetime.date.today()))
        res = admin.get('/api/weekly-km-prompt/status')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()['show_popup'])


if __name__ == '__main__':
    unittest.main()
