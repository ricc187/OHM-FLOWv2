"""Tests du système d'authentification : login username+password, verrouillage
après échecs répétés, 2FA TOTP obligatoire pour les admins (enrôlement,
vérification, codes de récupération), changement de mot de passe, et gestion
des comptes par un admin.

Isolation : même pattern que les autres tests API — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_auth -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import time
import unittest

import pyotp

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_auth_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)

# These tests exercise the login/lockout logic itself with far more than
# 5 requests/minute against /api/login — the route's own IP rate limit
# (a real, separate protection, see test_login_rate_limit_applies below)
# would otherwise fail the whole suite. Flask-Limiter reads config only
# once at init (already run at import time above), so the config flag
# alone does nothing here — toggle the extension's own `.enabled` instead.
# Re-enabled for that one dedicated test.
ohmapp.limiter.enabled = False

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))

STRONG_PASSWORD = 'Correct-Horse-Battery-99'


class AuthTestCase(unittest.TestCase):
    """Chaque test crée ses propres comptes pour rester isolé — pas de
    setUpClass partagé, le verrouillage par compte rendrait les tests
    dépendants de l'ordre d'exécution sinon."""

    def setUp(self):
        self.client = ohmapp.app.test_client()

    def _create_user(self, username, role, password=STRONG_PASSWORD):
        with ohmapp.app.app_context():
            user = ohmapp.User(
                username=username, role=role, must_change_password=False,
                pin_hash=ohmapp.generate_password_hash('unused'),
            )
            user.set_password(password)
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
            return user.id

    def _login(self, username, password):
        return self.client.post('/api/login', json={'username': username, 'password': password})

    # --- Basic login (no 2FA role) ---

    def test_login_missing_fields(self):
        res = self._login('', '')
        self.assertEqual(res.status_code, 400)

    def test_login_unknown_user_and_wrong_password_same_message(self):
        self._create_user('worker_msg', 'user')
        res_unknown = self._login('nobody_here', 'whatever12345')
        res_wrong = self._login('worker_msg', 'wrongpassword123')
        self.assertEqual(res_unknown.status_code, 401)
        self.assertEqual(res_wrong.status_code, 401)
        self.assertEqual(res_unknown.get_json()['error'], res_wrong.get_json()['error'])

    def test_user_role_login_ok_no_mfa(self):
        self._create_user('worker1', 'user')
        res = self._login('worker1', STRONG_PASSWORD)
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual(body['status'], 'ok')
        self.assertIn(ohmapp.COOKIE_NAME, res.headers.get('Set-Cookie', ''))

    def test_depanneur_role_login_ok_no_mfa(self):
        self._create_user('depanneur1', 'depanneur')
        res = self._login('depanneur1', STRONG_PASSWORD)
        self.assertEqual(res.get_json()['status'], 'ok')

    # --- Admin 2FA gating ---

    def test_admin_without_mfa_gets_enroll_required(self):
        self._create_user('admin_new', 'admin')
        res = self._login('admin_new', STRONG_PASSWORD)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(body['status'], 'mfa_enroll_required')
        self.assertIn('mfa_token', body)
        # No session cookie yet — login isn't complete.
        self.assertNotIn(ohmapp.COOKIE_NAME, res.headers.get('Set-Cookie', ''))

    def test_full_admin_enroll_flow_issues_session_and_backup_codes(self):
        self._create_user('admin_enroll', 'admin')
        login_res = self._login('admin_enroll', STRONG_PASSWORD)
        mfa_token = login_res.get_json()['mfa_token']

        start_res = self.client.post('/api/mfa/enroll/start', json={'mfa_token': mfa_token})
        self.assertEqual(start_res.status_code, 200, start_res.get_json())
        secret = start_res.get_json()['manual_entry_key']
        self.assertTrue(start_res.get_json()['qr_code_data_uri'].startswith('data:image/svg+xml;base64,'))

        code = pyotp.TOTP(secret).now()
        confirm_res = self.client.post('/api/mfa/enroll/confirm', json={'mfa_token': mfa_token, 'code': code})
        self.assertEqual(confirm_res.status_code, 200, confirm_res.get_json())
        body = confirm_res.get_json()
        self.assertEqual(body['status'], 'ok')
        self.assertTrue(body['session_issued'])
        self.assertEqual(len(body['backup_codes']), 10)
        self.assertIn(ohmapp.COOKIE_NAME, confirm_res.headers.get('Set-Cookie', ''))

        with ohmapp.app.app_context():
            user = ohmapp.User.query.filter_by(username='admin_enroll').first()
            self.assertTrue(user.mfa_enabled)

    def test_admin_with_mfa_enabled_requires_verify(self):
        user_id = self._create_user('admin_mfa', 'admin')
        secret = pyotp.random_base32()
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            user.mfa_enabled = True
            user.mfa_secret_enc = ohmapp.mfa_service.encrypt_secret(secret)
            ohmapp.db.session.commit()

        login_res = self._login('admin_mfa', STRONG_PASSWORD)
        body = login_res.get_json()
        self.assertEqual(body['status'], 'mfa_required')
        mfa_token = body['mfa_token']

        bad = self.client.post('/api/mfa/verify', json={'mfa_token': mfa_token, 'code': '000000'})
        self.assertEqual(bad.status_code, 401)

        good_code = pyotp.TOTP(secret).now()
        good = self.client.post('/api/mfa/verify', json={'mfa_token': mfa_token, 'code': good_code})
        self.assertEqual(good.status_code, 200, good.get_json())
        self.assertEqual(good.get_json()['status'], 'ok')
        self.assertIn(ohmapp.COOKIE_NAME, good.headers.get('Set-Cookie', ''))

    def test_backup_code_login_is_single_use(self):
        user_id = self._create_user('admin_backup', 'admin')
        secret = pyotp.random_base32()
        plaintext_code = '1234567890'
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            user.mfa_enabled = True
            user.mfa_secret_enc = ohmapp.mfa_service.encrypt_secret(secret)
            ohmapp.db.session.add(ohmapp.MfaBackupCode(
                user_id=user.id, code_hash=ohmapp.mfa_service.hash_backup_code(plaintext_code)
            ))
            ohmapp.db.session.commit()

        mfa_token = self._login('admin_backup', STRONG_PASSWORD).get_json()['mfa_token']

        first = self.client.post('/api/mfa/verify-backup', json={'mfa_token': mfa_token, 'backup_code': plaintext_code})
        self.assertEqual(first.status_code, 200, first.get_json())

        # Same code, fresh login attempt — must be rejected (already used).
        mfa_token_2 = self._login('admin_backup', STRONG_PASSWORD).get_json()['mfa_token']
        second = self.client.post('/api/mfa/verify-backup', json={'mfa_token': mfa_token_2, 'backup_code': plaintext_code})
        self.assertEqual(second.status_code, 401)

    def test_mfa_pending_token_cannot_be_used_as_session(self):
        """A stolen in-flight mfa_token must never work against an authed route."""
        self._create_user('admin_ticket', 'admin')
        mfa_token = self._login('admin_ticket', STRONG_PASSWORD).get_json()['mfa_token']
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, mfa_token)
        res = c.get('/api/me')
        self.assertEqual(res.status_code, 401)

    # --- Lockout ---

    def test_account_locks_after_repeated_failures(self):
        self._create_user('lockout_target', 'user')
        for _ in range(ohmapp.LOCKOUT_MAX_ATTEMPTS):
            res = self._login('lockout_target', 'wrongpassword123')
            self.assertEqual(res.status_code, 401)

        locked_res = self._login('lockout_target', 'wrongpassword123')
        self.assertEqual(locked_res.status_code, 423)

        # Even the CORRECT password is rejected while locked.
        still_locked = self._login('lockout_target', STRONG_PASSWORD)
        self.assertEqual(still_locked.status_code, 423)

    # --- Change password ---

    def test_change_password_requires_current_password(self):
        user_id = self._create_user('pwchange', 'user')
        with ohmapp.app.app_context():
            token = ohmapp.serializer.dumps({'user_id': user_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)

        bad = c.post('/api/change-password', json={'current_password': 'wrong', 'new_password': 'New-Strong-Pass-99'})
        self.assertEqual(bad.status_code, 401)

        good = c.post('/api/change-password', json={'current_password': STRONG_PASSWORD, 'new_password': 'New-Strong-Pass-99'})
        self.assertEqual(good.status_code, 200, good.get_json())

        # New password now works for login.
        res = self._login('pwchange', 'New-Strong-Pass-99')
        self.assertEqual(res.get_json()['status'], 'ok')

    def test_change_password_enforces_policy(self):
        user_id = self._create_user('pwpolicy', 'user')
        with ohmapp.app.app_context():
            token = ohmapp.serializer.dumps({'user_id': user_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)

        res = c.post('/api/change-password', json={'current_password': STRONG_PASSWORD, 'new_password': 'short'})
        self.assertEqual(res.status_code, 400)

    # --- Admin user management ---

    def test_admin_create_user_enforces_password_policy(self):
        admin_id = self._create_user('admin_creator', 'user')  # role doesn't matter for the cookie itself
        with ohmapp.app.app_context():
            u = ohmapp.db.session.get(ohmapp.User, admin_id)
            u.role = 'admin'
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': admin_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)

        weak = c.post('/api/users', json={'username': 'newbie', 'password': 'short', 'role': 'user'})
        self.assertEqual(weak.status_code, 400)

        strong = c.post('/api/users', json={'username': 'newbie', 'password': STRONG_PASSWORD, 'role': 'user'})
        self.assertEqual(strong.status_code, 201, strong.get_json())
        self.assertTrue(strong.get_json()['must_change_password'])

    def test_force_logout_revokes_existing_cookie(self):
        admin_id = self._create_user('force_logout_admin', 'admin')
        target_id = self._create_user('force_logout_target', 'user')
        with ohmapp.app.app_context():
            admin_token = ohmapp.serializer.dumps({'user_id': admin_id})
            target_token = ohmapp.serializer.dumps({'user_id': target_id})

        target_client = ohmapp.app.test_client()
        target_client.set_cookie(ohmapp.COOKIE_NAME, target_token)
        self.assertEqual(target_client.get('/api/me').status_code, 200)

        admin_client = ohmapp.app.test_client()
        admin_client.set_cookie(ohmapp.COOKIE_NAME, admin_token)
        res = admin_client.post(f'/api/users/{target_id}/force-logout')
        self.assertEqual(res.status_code, 200, res.get_json())

        # Same cookie as before, still well within its own 24h max_age — but
        # revoked, so it must now be rejected.
        self.assertEqual(target_client.get('/api/me').status_code, 401)

        # A freshly issued cookie (e.g. after logging back in) works again —
        # itsdangerous timestamps only have 1-second resolution, so a real
        # gap is needed to land in a strictly-later second than the revocation.
        time.sleep(1.1)
        with ohmapp.app.app_context():
            fresh_token = ohmapp.serializer.dumps({'user_id': target_id})
        fresh_client = ohmapp.app.test_client()
        fresh_client.set_cookie(ohmapp.COOKIE_NAME, fresh_token)
        self.assertEqual(fresh_client.get('/api/me').status_code, 200)

    def test_force_logout_requires_admin(self):
        target_id = self._create_user('non_admin_target', 'user')
        non_admin_id = self._create_user('non_admin_actor', 'user')
        with ohmapp.app.app_context():
            token = ohmapp.serializer.dumps({'user_id': non_admin_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)
        res = c.post(f'/api/users/{target_id}/force-logout')
        self.assertEqual(res.status_code, 403)

    def test_admin_reset_requires_own_password(self):
        admin_id = self._create_user('reset_admin', 'admin')
        target_id = self._create_user('reset_target', 'admin')
        secret = pyotp.random_base32()
        with ohmapp.app.app_context():
            target = ohmapp.db.session.get(ohmapp.User, target_id)
            target.mfa_enabled = True
            target.mfa_secret_enc = ohmapp.mfa_service.encrypt_secret(secret)
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': admin_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)

        bad = c.post(f'/api/mfa/admin-reset/{target_id}', json={'password': 'wrong'})
        self.assertEqual(bad.status_code, 401)

        good = c.post(f'/api/mfa/admin-reset/{target_id}', json={'password': STRONG_PASSWORD})
        self.assertEqual(good.status_code, 200, good.get_json())

        with ohmapp.app.app_context():
            target = ohmapp.db.session.get(ohmapp.User, target_id)
            self.assertFalse(target.mfa_enabled)

    def test_login_rate_limit_applies(self):
        """The route's own IP throttle (separate from account lockout) —
        the only test in this file that re-enables RATELIMIT_ENABLED."""
        self._create_user('rate_limited', 'user')
        ohmapp.limiter.enabled = True
        try:
            for _ in range(5):
                self._login('rate_limited', 'wrongpassword123')
            res = self._login('rate_limited', 'wrongpassword123')
            self.assertEqual(res.status_code, 429)
        finally:
            ohmapp.limiter.enabled = False


if __name__ == '__main__':
    unittest.main()
