"""Tests du système d'authentification : login username+password, verrouillage
après échecs répétés, 2FA TOTP obligatoire pour les admins (enrôlement,
vérification, codes de récupération), changement de mot de passe, et gestion
des comptes par un admin.

Isolation : même pattern que les autres tests API — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_auth -v   (depuis backend/)
"""
import datetime
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

    def _create_user(self, username, role, password=STRONG_PASSWORD, mfa_enabled=True):
        """mfa_enabled defaults to True (fully onboarded) so tests that just
        need a working admin actor aren't blocked by token_required's
        onboarding check — pass mfa_enabled=False for the tests that
        specifically exercise the pending-enrollment state itself."""
        with ohmapp.app.app_context():
            user = ohmapp.User(
                username=username, role=role, must_change_password=False,
                mfa_enabled=mfa_enabled,
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
    # Enrollment is a post-session onboarding step, not a login state — see
    # MFA_REQUIRED_ROLES comment in app.py. Login itself only gates on real
    # 2FA *verification* (mfa_enabled=True); an admin who still needs to
    # enroll gets a normal session, restricted server-side (token_required's
    # onboarding check) until they do.

    def test_admin_without_mfa_gets_session_but_is_flagged_pending_enrollment(self):
        self._create_user('admin_new', 'admin', mfa_enabled=False)
        res = self._login('admin_new', STRONG_PASSWORD)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(body['status'], 'ok')
        self.assertTrue(body['mfa_required'])
        self.assertFalse(body['mfa_enabled'])
        self.assertIn(ohmapp.COOKIE_NAME, res.headers.get('Set-Cookie', ''))

    def test_admin_pending_enrollment_session_is_restricted_to_onboarding_routes(self):
        self._create_user('admin_pending', 'admin', mfa_enabled=False)
        self._login('admin_pending', STRONG_PASSWORD)

        # /api/me stays reachable (needed to render the enrollment screen)...
        me = self.client.get('/api/me')
        self.assertEqual(me.status_code, 200)
        # ...but any real business endpoint is blocked until enrolled.
        blocked = self.client.get('/api/users')
        self.assertEqual(blocked.status_code, 403)
        # `code` (not just the French `error` text) is what the frontend's
        # api.ts keys off of to refresh stale user state and redirect —
        # regression coverage for that contract, not just the status code.
        self.assertEqual(blocked.get_json()['code'], 'mfa_enroll_required')

    def test_must_change_password_session_is_restricted_to_onboarding_routes(self):
        """Regression: must_change_password was only ever enforced by the
        frontend (ChangePasswordGate) — a session for an account with a
        temp/admin-reset password could reach any endpoint directly,
        bypassing the "change it first" requirement entirely. Applies to
        every role, not just admin (unlike the MFA gate)."""
        user_id = self._create_user('worker_temp_pw', 'user')
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            user.must_change_password = True
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': user_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)

        # /api/me and /api/change-password stay reachable...
        self.assertEqual(c.get('/api/me').status_code, 200)
        # ...but any real business endpoint is blocked, even one this role
        # would otherwise be allowed to call.
        blocked = c.get('/api/entries/pending')  # admin-only anyway, but proves the gate fires before the role check
        self.assertEqual(blocked.status_code, 403)
        self.assertIn('mot de passe', blocked.get_json()['error'])
        self.assertEqual(blocked.get_json()['code'], 'must_change_password')

    def test_must_change_password_checked_before_mfa_enrollment(self):
        """An admin with BOTH a temp password and no 2FA enrolled must be
        stopped on the password gate first — token_required must never let
        must_change_password=True fall through to the MFA check."""
        user_id = self._create_user('admin_both_pending', 'admin', mfa_enabled=False)
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            user.must_change_password = True
            ohmapp.db.session.commit()
        self._login('admin_both_pending', STRONG_PASSWORD)

        res = self.client.get('/api/users')
        self.assertEqual(res.status_code, 403)
        self.assertIn('mot de passe', res.get_json()['error'])  # not the 2FA message

    def test_full_admin_enroll_flow_issues_backup_codes_over_existing_session(self):
        self._create_user('admin_enroll', 'admin', mfa_enabled=False)
        self._login('admin_enroll', STRONG_PASSWORD)  # session already issued, no mfa_token

        start_res = self.client.post('/api/mfa/enroll/start', json={})
        self.assertEqual(start_res.status_code, 200, start_res.get_json())
        secret = start_res.get_json()['manual_entry_key']
        self.assertTrue(start_res.get_json()['qr_code_data_uri'].startswith('data:image/svg+xml;base64,'))

        code = pyotp.TOTP(secret).now()
        confirm_res = self.client.post('/api/mfa/enroll/confirm', json={'code': code})
        self.assertEqual(confirm_res.status_code, 200, confirm_res.get_json())
        body = confirm_res.get_json()
        self.assertFalse(body['session_issued'])  # already had a session — none reissued
        self.assertTrue(body['mfa_enabled'])
        self.assertEqual(len(body['backup_codes']), 10)

        with ohmapp.app.app_context():
            user = ohmapp.User.query.filter_by(username='admin_enroll').first()
            self.assertTrue(user.mfa_enabled)

        # Enrollment done — the same session can now reach business routes.
        unblocked = self.client.get('/api/users')
        self.assertEqual(unblocked.status_code, 200)

    def test_admin_must_change_password_before_enrolling_mfa(self):
        user_id = self._create_user('admin_order', 'admin', mfa_enabled=False)
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            user.must_change_password = True
            ohmapp.db.session.commit()
        self._login('admin_order', STRONG_PASSWORD)

        # Can't jump straight to MFA enrollment before changing the password...
        start_res = self.client.post('/api/mfa/enroll/start', json={})
        self.assertEqual(start_res.status_code, 400)

        # ...but once it's changed, enrollment opens up.
        self.client.post('/api/change-password', json={
            'current_password': STRONG_PASSWORD, 'new_password': 'New-Strong-Pass-99',
        })
        start_res = self.client.post('/api/mfa/enroll/start', json={})
        self.assertEqual(start_res.status_code, 200, start_res.get_json())

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
        user_id = self._create_user('admin_ticket', 'admin')
        secret = pyotp.random_base32()
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            user.mfa_enabled = True
            user.mfa_secret_enc = ohmapp.mfa_service.encrypt_secret(secret)
            ohmapp.db.session.commit()

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

    def test_lockout_escalates_across_mfa_cycles_password_alone_does_not_reset_it(self):
        """Regression: login() used to call _reset_lockout(user) right after
        the password check, before the MFA gate — so an attacker who knows
        an admin's password (but not their TOTP code) could wipe the
        escalating lockout back to its lowest 15-minute tier before every
        burst of 2FA guesses, just by resubmitting the correct password
        first. _reset_lockout must only fire once a session is actually
        about to be issued (see the comment in login())."""
        user_id = self._create_user('admin_escalation', 'admin')
        secret = pyotp.random_base32()
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            user.mfa_enabled = True
            user.mfa_secret_enc = ohmapp.mfa_service.encrypt_secret(secret)
            ohmapp.db.session.commit()

        def burn_mfa_attempts():
            mfa_token = self._login('admin_escalation', STRONG_PASSWORD).get_json()['mfa_token']
            for _ in range(ohmapp.LOCKOUT_MAX_ATTEMPTS):
                self.client.post('/api/mfa/verify', json={'mfa_token': mfa_token, 'code': '000000'})

        # Cycle 1: password correct, then exhaust 5 bad TOTP codes -> locked
        # at the first, 15-minute tier.
        burn_mfa_attempts()
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            self.assertEqual(user.lockout_stage, 1)
            first_lock_minutes = (user.locked_until - datetime.datetime.utcnow()).total_seconds() / 60
            self.assertAlmostEqual(first_lock_minutes, 15, delta=1)
            # Simulate the 15 minutes having passed (the lock itself
            # expiring) without touching lockout_stage — is_account_locked
            # only looks at locked_until.
            user.locked_until = datetime.datetime.utcnow() - datetime.timedelta(seconds=1)
            ohmapp.db.session.commit()

        # Cycle 2: password correct again, then exhaust 5 more bad TOTP
        # codes. If login() still reset lockout_stage on the password step,
        # this would re-lock at the 15-minute tier again instead of
        # escalating to the second, 60-minute one.
        burn_mfa_attempts()
        with ohmapp.app.app_context():
            user = ohmapp.db.session.get(ohmapp.User, user_id)
            self.assertEqual(user.lockout_stage, 2)
            second_lock_minutes = (user.locked_until - datetime.datetime.utcnow()).total_seconds() / 60
            self.assertAlmostEqual(second_lock_minutes, 60, delta=1)

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

    def test_force_logout_rejects_self_target(self):
        admin_id = self._create_user('self_target_admin', 'admin')
        with ohmapp.app.app_context():
            token = ohmapp.serializer.dumps({'user_id': admin_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, token)
        res = c.post(f'/api/users/{admin_id}/force-logout')
        self.assertEqual(res.status_code, 400)

    def test_force_logout_resets_lockout(self):
        admin_id = self._create_user('lockout_reset_admin', 'admin')
        target_id = self._create_user('lockout_reset_target', 'user')
        with ohmapp.app.app_context():
            target = ohmapp.db.session.get(ohmapp.User, target_id)
            target.lockout_stage = 1
            target.locked_until = datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
            ohmapp.db.session.commit()
            admin_token = ohmapp.serializer.dumps({'user_id': admin_id})
        c = ohmapp.app.test_client()
        c.set_cookie(ohmapp.COOKIE_NAME, admin_token)

        res = c.post(f'/api/users/{target_id}/force-logout')
        self.assertEqual(res.status_code, 200, res.get_json())

        with ohmapp.app.app_context():
            target = ohmapp.db.session.get(ohmapp.User, target_id)
            self.assertIsNone(target.locked_until)
            self.assertEqual(target.lockout_stage, 0)

    def test_force_logout_also_blocks_voluntary_mfa_reenroll(self):
        """The bypass this closes: mfa/enroll/start|confirm authenticate via
        the session cookie directly (they run before any real session
        exists in the mandatory mid-login case), so they must independently
        honor sessions_invalidated_at, not just token_required."""
        admin_id = self._create_user('bypass_admin', 'admin')
        target_id = self._create_user('bypass_target', 'admin')
        with ohmapp.app.app_context():
            admin_token = ohmapp.serializer.dumps({'user_id': admin_id})
            target_token = ohmapp.serializer.dumps({'user_id': target_id})

        target_client = ohmapp.app.test_client()
        target_client.set_cookie(ohmapp.COOKIE_NAME, target_token)

        admin_client = ohmapp.app.test_client()
        admin_client.set_cookie(ohmapp.COOKIE_NAME, admin_token)
        res = admin_client.post(f'/api/users/{target_id}/force-logout')
        self.assertEqual(res.status_code, 200, res.get_json())

        # The revoked cookie must not be able to start a voluntary re-enroll either.
        start_res = target_client.post('/api/mfa/enroll/start', json={})
        self.assertEqual(start_res.status_code, 401)

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

    # --- GET /api/users: role-shaped, not admin-only anymore -------------

    def test_depanneur_can_list_users_minimal_shape(self):
        """Used to 403 for anyone but admin, leaving the "référent" dropdown
        on chantier creation empty for a depanneur (Dashboard.tsx fetches
        this same route). Fixed 2026-09-11: non-admin now gets id+username
        only — role/vacation_balance/mfa_enabled stay admin-only."""
        self._create_user('other_worker', 'user')
        self._create_user('dep1', 'depanneur')
        self._login('dep1', STRONG_PASSWORD)
        res = self.client.get('/api/users')
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertGreaterEqual(len(body), 2)
        for row in body:
            self.assertEqual(set(row.keys()), {'id', 'username'})

    def test_plain_user_role_can_list_users_minimal_shape(self):
        self._create_user('u1', 'user')
        self._login('u1', STRONG_PASSWORD)
        res = self.client.get('/api/users')
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(set(res.get_json()[0].keys()), {'id', 'username'})

    def test_admin_still_gets_full_user_shape(self):
        # Direct token mint, not _login: role='admin' + mfa_enabled=True
        # means /api/login would stop at 'mfa_required' (no session cookie
        # issued yet) — same pattern as this file's other admin-role tests
        # (e.g. test_admin_reset_requires_own_password) for an already-
        # fully-onboarded admin session.
        admin_id = self._create_user('admin_full', 'admin')
        token = ohmapp.serializer.dumps({'user_id': admin_id})
        self.client.set_cookie(ohmapp.COOKIE_NAME, token)

        res = self.client.get('/api/users')
        self.assertEqual(res.status_code, 200, res.get_json())
        row = next(r for r in res.get_json() if r['username'] == 'admin_full')
        self.assertIn('role', row)
        self.assertIn('vacation_balance', row)
        self.assertIn('mfa_enabled', row)


if __name__ == '__main__':
    unittest.main()
