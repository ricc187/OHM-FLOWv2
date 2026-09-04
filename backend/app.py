import os
import secrets
import shutil
import datetime
import functools
import uuid
import re
import zipfile
import tempfile
from io import BytesIO
from itsdangerous import URLSafeTimedSerializer
from werkzeug.security import generate_password_hash, check_password_hash
from flask import Flask, request, jsonify, send_from_directory, send_file, after_this_request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text, inspect, func
from PIL import Image, ImageOps
import fitz  # PyMuPDF
import logging
from financier_calculs import compute_financier
from auth_security import validate_password
import mfa as mfa_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Audit log (who did what) -----------------------------------------
# Separate small log files per action category, under backend/logs/. Kept
# apart from the app's own stdout logger above (that one is for ops/errors,
# this one is a durable "who touched what" trail for admin actions on data
# other people entered — reassigning an entry, editing someone's hours,
# deleting/validating on their behalf, etc). *.log is already gitignored.
AUDIT_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(AUDIT_LOG_DIR, exist_ok=True)
_audit_loggers = {}

def _audit_logger(category):
    if category not in _audit_loggers:
        lg = logging.getLogger(f'audit.{category}')
        lg.setLevel(logging.INFO)
        lg.propagate = False
        if not lg.handlers:
            handler = logging.FileHandler(os.path.join(AUDIT_LOG_DIR, f'{category}.log'), encoding='utf-8')
            handler.setFormatter(logging.Formatter('%(asctime)s | %(message)s'))
            lg.addHandler(handler)
        _audit_loggers[category] = lg
    return _audit_loggers[category]

def audit_log(category, actor, message):
    """actor: the User performing the action (current_user). Writes one line
    to backend/logs/<category>.log, e.g. audit_log('entries', current_user,
    'entry #42 (chantier Baita): heures 5.0 -> 7.5')."""
    who = f'{actor.username} (id={actor.id}, role={actor.role})' if actor else 'system'
    _audit_logger(category).info(f'{who} | {message}')

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

app = Flask(__name__, static_folder='../dist', static_url_path='/')
_default_origins = "https://ohmflow.com,https://www.ohmflow.com"
_allowed_origins = [o.strip() for o in os.environ.get('ALLOWED_ORIGINS', _default_origins).split(',') if o.strip()]
CORS(app, origins=_allowed_origins)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(os.getcwd(), 'data', 'chantier.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), 'data', 'uploads')
app.config['ARCHIVE_FOLDER'] = os.path.join(os.getcwd(), 'data', 'archives')
# 25 MB: raw phone-camera photos (esp. high-res JPEGs) commonly land in the
# 8-15MB range — the old 10MB cap was sized for PDF-only uploads.
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024
try:
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['ARCHIVE_FOLDER'], exist_ok=True)
except OSError as e:
    logger.warning(f"Could not create upload/archive folders: {e}")


# Security Config
secret = os.environ.get('SECRET_KEY')
if not secret:
    raise RuntimeError("FATAL: SECRET_KEY is not set! Set it in your .env file.")
app.config['SECRET_KEY'] = secret
serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])

# Rate Limiter
limiter = Limiter(get_remote_address, app=app, default_limits=["2000 per day"])

db.init_app(app)

COOKIE_NAME = 'ohm_token'
COOKIE_MAX_AGE = 86400  # 24h

def set_auth_cookie(response, token):
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,  # not readable from JS — mitigates token theft via XSS
        secure=os.environ.get('FLASK_ENV') == 'production',  # HTTPS-only in prod
        samesite='Lax',  # blocks the cookie on cross-site POST/PUT/DELETE — CSRF mitigation
        path='/'
    )

def clear_auth_cookie(response):
    response.set_cookie(COOKIE_NAME, '', max_age=0, httponly=True, samesite='Lax', path='/')

def token_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return jsonify({'error': 'Token is missing'}), 401

        try:
            data, issued_at = serializer.loads(token, max_age=COOKIE_MAX_AGE, return_timestamp=True)
            # MFA pending tickets (see issue_mfa_pending_token) carry a
            # 'purpose' claim and must never work as a real session, even
            # though they're signed with the same key — a stolen in-flight
            # login-step ticket must not be usable to reach an authed route.
            if 'purpose' in data:
                raise Exception('Not a session token')
            current_user = User.query.get(data['user_id'])
            if not current_user:
                raise Exception('User not found')
            # Admin-triggered force-logout (see /api/users/<id>/force-logout) —
            # any cookie signed at or before that action is dead, everywhere,
            # even though its own max_age hasn't elapsed yet. itsdangerous
            # timestamps only have 1-second resolution, so <= (not <) is the
            # safe default for the same-second edge case: an admin force-
            # logging someone out and that person logging back in within the
            # same wall-clock second is vanishingly rare, and "make them log
            # in again" is the safe failure mode there, not "let it slide".
            if current_user.sessions_invalidated_at and issued_at.replace(tzinfo=None) <= current_user.sessions_invalidated_at:
                raise Exception('Session revoked')
        except Exception as e:
            return jsonify({'error': 'Token is invalid or expired'}), 401

        return f(current_user, *args, **kwargs)
    return decorated


# --- Auth: password login + role-gated 2FA -----------------------------
# Only roles listed here are required to set up/use TOTP 2FA at login.
# 'user' and 'depanneur' log in with password only.
MFA_REQUIRED_ROLES = ('admin',)

# Account lockout after repeated bad password/2FA-code attempts (mirrors a
# sliding-window count over LoginAttempt, not a live counter — see
# _recent_failed_attempts). Escalating duration per stage, never
# auto-decreasing — only a successful login resets it.
LOCKOUT_MAX_ATTEMPTS = 5
LOCKOUT_WINDOW_MIN = 15
LOCKOUT_DURATIONS_MIN = [15, 60, 24 * 60]

# TTL of the short-lived ticket returned between "password OK" and
# "2FA verified/enrolled" — long enough to type a 6-digit code, short
# enough that a leaked ticket is useless a few minutes later.
MFA_PENDING_TTL_SEC = 300


def _client_ip():
    return request.headers.get('X-Forwarded-For', request.remote_addr) or 'unknown'


def _record_login_attempt(username, success, reason=None):
    db.session.add(LoginAttempt(username=username, ip_address=_client_ip(), success=success, reason=reason))
    db.session.commit()


def _recent_failed_attempts(username):
    window_start = datetime.datetime.utcnow() - datetime.timedelta(minutes=LOCKOUT_WINDOW_MIN)
    return LoginAttempt.query.filter(
        LoginAttempt.username == username,
        LoginAttempt.success.is_(False),
        LoginAttempt.timestamp >= window_start
    ).count()


def is_account_locked(user):
    return bool(user.locked_until and user.locked_until > datetime.datetime.utcnow())


def _maybe_lock_account(user):
    """Called after a bad password or bad 2FA/backup code for a known user —
    escalates the lockout if the sliding-window failure count just crossed
    the threshold."""
    if _recent_failed_attempts(user.username) >= LOCKOUT_MAX_ATTEMPTS:
        stage = min(user.lockout_stage, len(LOCKOUT_DURATIONS_MIN) - 1)
        user.locked_until = datetime.datetime.utcnow() + datetime.timedelta(minutes=LOCKOUT_DURATIONS_MIN[stage])
        user.lockout_stage = min(user.lockout_stage + 1, len(LOCKOUT_DURATIONS_MIN) - 1)
        db.session.commit()


def _reset_lockout(user):
    user.lockout_stage = 0
    user.locked_until = None


def issue_mfa_pending_token(user, purpose):
    return serializer.dumps({'user_id': user.id, 'purpose': purpose})


def decode_mfa_pending_token(token, expected_purpose):
    if not token:
        return None
    try:
        data = serializer.loads(token, max_age=MFA_PENDING_TTL_SEC)
    except Exception:
        return None
    if data.get('purpose') != expected_purpose:
        return None
    return db.session.get(User, data.get('user_id'))


def _issue_session(user):
    token = serializer.dumps({'user_id': user.id})
    response = jsonify({'status': 'ok', **user.to_dict()})
    set_auth_cookie(response, token)
    return response


def _resolve_mfa_enroll_actor(data):
    """Mid-login mandatory enrollment identifies the user via a short-lived
    mfa_token (no session exists yet); voluntary re-enrollment identifies
    them via their existing session cookie instead. Returns (user, via_session).

    The session-cookie branch duplicates token_required's own checks
    (purpose rejection, force-logout revocation) rather than calling it,
    since this isn't wrapped in @token_required (it also has to accept an
    mfa_token with no session at all) — those checks must stay in lockstep
    with token_required's, or a cookie an admin just force-revoked could
    still be used here to overwrite the victim's TOTP secret."""
    mfa_token = (data or {}).get('mfa_token')
    if mfa_token:
        return decode_mfa_pending_token(mfa_token, 'mfa_enroll'), False

    token = request.cookies.get(COOKIE_NAME)
    if token:
        try:
            sess, issued_at = serializer.loads(token, max_age=COOKIE_MAX_AGE, return_timestamp=True)
            if 'purpose' not in sess:
                user = db.session.get(User, sess.get('user_id'))
                if user and not (user.sessions_invalidated_at and issued_at.replace(tzinfo=None) <= user.sessions_invalidated_at):
                    return user, True
        except Exception:
            pass
    return None, False

# Enable WAL mode for SQLite (Better concurrency)
with app.app_context():
    try:
        db.engine.connect().execute(text("PRAGMA journal_mode=WAL;"))
        logger.info("SQLite WAL mode enabled.")
    except Exception as e:
        logger.warning(f"Could not enable WAL mode: {e}")

    # Enforce foreign key constraints (SQLite disables this by default)
    from sqlalchemy import event

    @event.listens_for(db.engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON;")
        # SQLite allows only one writer at a time even in WAL mode — with 4
        # gunicorn workers, two users submitting at the exact same instant can
        # collide. Without this, the loser gets an immediate "database is
        # locked" error instead of just waiting the few milliseconds it takes
        # for the first tiny write to finish.
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.close()

# --- Models ---

# --- Models ---

# Association table for User <-> Chantier
chantier_members = db.Table('chantier_members',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
    db.Column('chantier_id', db.Integer, db.ForeignKey('chantiers.id'), primary_key=True)
)

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    # --- Legacy PIN auth (retired — see password_hash below) ---
    # pin_hash is still NOT NULL at the DB level on tables created before
    # this change, so it can't just be left unset; new users get a random
    # unusable placeholder hash (set_pin/check_pin are never called by any
    # route anymore — dead code kept only so the column stays satisfiable).
    pin_hash = db.Column(db.String(256), nullable=False)
    pin = db.Column(db.String(6), default='')
    must_change_pin = db.Column(db.Boolean, default=False)

    role = db.Column(db.String(20), nullable=False) # 'admin', 'user' or 'depanneur'
    vacation_balance = db.Column(db.Float, default=0.0)

    # --- Password auth ---
    password_hash = db.Column(db.String(300), nullable=True)
    must_change_password = db.Column(db.Boolean, default=True)

    # --- TOTP 2FA (required for MFA_REQUIRED_ROLES only — see manage_users) ---
    mfa_enabled = db.Column(db.Boolean, default=False)
    mfa_secret_enc = db.Column(db.String(300), nullable=True)          # confirmed secret, Fernet-encrypted (see mfa.py)
    mfa_pending_secret_enc = db.Column(db.String(300), nullable=True)  # in-enrollment secret, not yet active
    mfa_enrolled_at = db.Column(db.DateTime, nullable=True)

    # --- Brute-force lockout (see _maybe_lock_account) ---
    lockout_stage = db.Column(db.Integer, default=0)  # 0=none, escalates through LOCKOUT_DURATIONS_MIN, never auto-decreases
    locked_until = db.Column(db.DateTime, nullable=True)

    # Sessions are stateless signed cookies (no server-side session table) —
    # this is the one thing that makes a specific already-issued cookie
    # revocable anyway: any token whose itsdangerous signing timestamp is
    # older than this gets rejected in token_required, regardless of its
    # own max_age. Set by an admin's "force logout" action (see
    # /api/users/<id>/force-logout) — every open session for that account
    # is invalid the moment this changes, no matter which device.
    sessions_invalidated_at = db.Column(db.DateTime, nullable=True)

    def set_pin(self, pin):  # pragma: no cover — retired, kept only so the column stays satisfiable
        self.pin_hash = generate_password_hash(pin)

    def check_pin(self, pin):  # pragma: no cover — retired, never called
        return check_password_hash(self.pin_hash, pin)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256:600000')

    def check_password(self, password):
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
            'vacation_balance': self.vacation_balance,
            'must_change_password': self.must_change_password,
            'mfa_enabled': self.mfa_enabled,
            'mfa_required': self.role in MFA_REQUIRED_ROLES,
        }

class MfaBackupCode(db.Model):
    """One-time recovery codes generated at 2FA enrollment — a used one is
    marked (used_at set) rather than deleted, for audit purposes."""
    __tablename__ = 'mfa_backup_codes'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    code_hash = db.Column(db.String(300), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    used_at = db.Column(db.DateTime, nullable=True)


class LoginAttempt(db.Model):
    """Every login/2FA attempt, success or failure — the sliding-window
    source of truth for account lockout (see _recent_failed_attempts),
    and a plain audit trail of who tried to log in from where."""
    __tablename__ = 'login_attempts'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, index=True)
    ip_address = db.Column(db.String(64), nullable=True, index=True)
    success = db.Column(db.Boolean, nullable=False)
    reason = db.Column(db.String(40), nullable=True)  # bad_credentials, bad_mfa_code, bad_mfa_backup_code, ...
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow, index=True)


class Chantier(db.Model):
    __tablename__ = 'chantiers'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    annee = db.Column(db.Integer, nullable=False)
    plan_pdf_path = db.Column(db.String(255), nullable=True)
    pdf_path = db.Column(db.String(200), nullable=True)
    
    # New fields
    address_work = db.Column(db.String(200), nullable=True)
    address_billing = db.Column(db.String(200), nullable=True)
    date_start = db.Column(db.String(20), nullable=True)
    date_end = db.Column(db.String(20), nullable=True)
    remarque = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default='FUTURE') # FUTURE, ACTIVE, DONE

    # Set when a closed chantier's document folder has been zipped and
    # deleted from live storage to free space (see archive_chantier_documents
    # below). Reopening the chantier re-extracts the zip and clears this.
    archived = db.Column(db.Boolean, default=False)
    archive_zip_path = db.Column(db.String(255), nullable=True)
    # Actual on-disk folder name under data/uploads/chantiers/ — the chantier's
    # own name, sanitized (see chantier_storage_dirname). Tracked explicitly
    # so a rename can locate + move the existing folder instead of losing it.
    storage_dir = db.Column(db.String(150), nullable=True)

    # --- Nomenclature (see _next_chantier_numero) ---
    # nom is now always built as f"{numero}-{commune}-{client_repere}" for
    # chantiers created through the enforced flow. numero/commune/client_repere
    # are nullable so pre-existing chantiers (created before this scheme) keep
    # their free-form nom untouched — they just never populate these columns.
    numero = db.Column(db.String(10), unique=True, nullable=True)
    commune = db.Column(db.String(100), nullable=True)
    client_repere = db.Column(db.String(100), nullable=True)

    # Relationships
    members = db.relationship('User', secondary=chantier_members, lazy='subquery',
        backref=db.backref('chantiers', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'nom': self.nom,
            'annee': self.annee,
            'plan_pdf_path': self.plan_pdf_path,
            'pdf_path': self.pdf_path,
            'address_work': self.address_work,
            'address_billing': self.address_billing,
            'date_start': self.date_start,
            'date_end': self.date_end,
            'remarque': self.remarque,
            'status': self.status,
            'archived': bool(self.archived),
            'numero': self.numero,
            'commune': self.commune,
            'client_repere': self.client_repere,
            'hours_total': round(self._get_hours_total(), 2),
            'members': [u.id for u in self.members]
        }

    def _get_hours_total(self):
        """Sum of all heures ever logged on this chantier, regardless of
        PENDING/VALIDATED status — matches the "total heures" already shown
        elsewhere (e.g. ChantierDetail's SUIVI tab), which never filtered by
        status either. Was month-scoped before ("ce mois-ci") — simplified to
        a plain running total, since the month filter made the card show
        nothing for a chantier whose entries just happen to predate this month.
        Uses a precomputed value if the caller already batched it for a list
        (see manage_chantiers) to avoid one query per chantier; otherwise
        runs a single lightweight SUM aggregate instead of loading this
        chantier's entire entries history just to add up one field."""
        if hasattr(self, '_hours_total_precomputed'):
            return self._hours_total_precomputed
        return db.session.query(func.coalesce(func.sum(Entry.heures), 0.0)).filter(
            Entry.chantier_id == self.id
        ).scalar()


class SequenceCounter(db.Model):
    """Generic named monotonic counter — backs the chantier numéro (see
    _next_chantier_numero) and never reuses a value, even if the chantier
    that got it is later deleted ("unique à vie")."""
    __tablename__ = 'sequence_counters'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    value = db.Column(db.Integer, nullable=False, default=0)


def _next_chantier_numero(annee):
    """Nomenclature: {YY}{NNNNN} — 2-digit année + compteur global sur 5
    chiffres qui n'est jamais remis à zéro ni réutilisé, pour trier
    chronologiquement tout en gardant chaque numéro unique à vie.
    Exemple : chantier n°347 créé en 2026 -> '2600347'."""
    counter = SequenceCounter.query.filter_by(name='chantier_numero').first()
    if not counter:
        counter = SequenceCounter(name='chantier_numero', value=0)
        db.session.add(counter)
        db.session.flush()
    counter.value += 1
    db.session.flush()
    year_2d = str(annee)[-2:].zfill(2)
    return f"{year_2d}{counter.value:05d}"


class AdminNotice(db.Model):
    """A note an admin broadcasts to everyone on next app open (e.g. "l'échelle
    est à gauche de l'atelier"). Shown from date_start for duration_days, once
    per user — see NoticeAck."""
    __tablename__ = 'admin_notices'
    id = db.Column(db.Integer, primary_key=True)
    message = db.Column(db.Text, nullable=False)
    date_start = db.Column(db.String(20), nullable=False)  # YYYY-MM-DD
    duration_days = db.Column(db.Integer, nullable=False, default=7)
    active = db.Column(db.Boolean, default=True)  # admin can end it early
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    created_by = db.relationship('User', foreign_keys=[created_by_id])

    def is_in_window(self, today_str):
        if not self.active:
            return False
        try:
            start = datetime.datetime.strptime(self.date_start, "%Y-%m-%d").date()
            today = datetime.datetime.strptime(today_str, "%Y-%m-%d").date()
        except ValueError:
            return False
        end = start + datetime.timedelta(days=self.duration_days)
        return start <= today <= end

    def to_dict(self):
        return {
            'id': self.id,
            'message': self.message,
            'date_start': self.date_start,
            'duration_days': self.duration_days,
            'active': bool(self.active),
            'created_by': self.created_by.username if self.created_by else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class NoticeAck(db.Model):
    """One row per (notice, user) who clicked 'J'ai pris note' — that notice
    never shows again for that user."""
    __tablename__ = 'notice_acks'
    id = db.Column(db.Integer, primary_key=True)
    notice_id = db.Column(db.Integer, db.ForeignKey('admin_notices.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    acked_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (db.UniqueConstraint('notice_id', 'user_id', name='uq_notice_user'),)

class Entry(db.Model):
    __tablename__ = 'entries'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    date = db.Column(db.String(20), nullable=False)
    heures = db.Column(db.Float, nullable=False, default=0.0)
    materiel = db.Column(db.Float, nullable=False, default=0.0)
    
    # New fields
    status = db.Column(db.String(20), default='PENDING') # PENDING, VALIDATED
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    admin_note = db.Column(db.Text, nullable=True)
    # Client-generated id for offline-queued submissions (see frontend
    # offlineQueue.ts) — lets a retried request that actually succeeded but
    # whose response got lost (dropped connection) be recognized as already
    # done instead of creating a duplicate entry. Nullable/non-unique at the
    # DB level (old entries never set it); add_entry does the existence check.
    client_ref = db.Column(db.String(64), nullable=True, index=True)

    user = db.relationship('User', foreign_keys=[user_id], backref='entries')
    created_by = db.relationship('User', foreign_keys=[created_by_id])
    chantier = db.relationship('Chantier', backref='entries')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.username,
            'chantier_id': self.chantier_id,
            'chantier_nom': self.chantier.nom if self.chantier else 'Chantier Inconnu',
            'date': self.date,
            'heures': self.heures,
            'materiel': self.materiel,
            'status': self.status,
            'created_by_id': self.created_by_id,
            'admin_note': self.admin_note
        }

class Leave(db.Model):
    __tablename__ = 'leaves'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    type = db.Column(db.String(20), nullable=False) # VACATION, SICKNESS
    date_start = db.Column(db.String(20), nullable=False)
    date_end = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), default='PENDING') # PENDING, APPROVED, REJECTED
    days_count = db.Column(db.Float, default=0.0) 
    admin_note = db.Column(db.Text, nullable=True)

    user = db.relationship('User', backref='leaves')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.username,
            'type': self.type,
            'date_start': self.date_start,
            'date_end': self.date_end,
            'status': self.status,
            'days_count': self.days_count,
            'admin_note': self.admin_note
        }

class Alert(db.Model):
    __tablename__ = 'alerts'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    due_date = db.Column(db.String(20), nullable=True)
    is_resolved = db.Column(db.Boolean, default=False)
    
    chantier = db.relationship('Chantier', backref='alerts')

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'chantier_nom': self.chantier.nom,
            'title': self.title,
            'description': self.description,
            'due_date': self.due_date,
            'is_resolved': self.is_resolved
        }

DOCUMENT_CATEGORIES = ('document', 'photo')
# On-disk subfolder name per category — kept distinct from the API category
# string in case we ever want to relabel one without a filesystem migration.
CATEGORY_FOLDERS = {'document': 'documents', 'photo': 'photos'}

class Document(db.Model):
    __tablename__ = 'documents'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    category = db.Column(db.String(20), nullable=False)  # document | photo
    filename = db.Column(db.String(255), nullable=False)          # name on disk (UUID-based)
    original_filename = db.Column(db.String(255), nullable=False) # name shown to users
    size_bytes = db.Column(db.Integer, default=0)
    mimetype = db.Column(db.String(100))
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    # selectin: one extra batched query for ALL chantiers' documents at once,
    # instead of the default lazy='select' issuing one query per chantier —
    # archive_chantier_documents() and the zip/export routes touch .documents,
    # so this avoids N+1 queries when those run across a list of chantiers.
    chantier = db.relationship('Chantier', backref=db.backref('documents', cascade='all, delete-orphan', lazy='selectin'))
    uploaded_by = db.relationship('User')

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'category': self.category,
            'filename': self.original_filename,
            'size_bytes': self.size_bytes,
            'mimetype': self.mimetype,
            'uploaded_by': self.uploaded_by.username if self.uploaded_by else None,
            'uploaded_at': self.uploaded_at.isoformat() if self.uploaded_at else None,
        }

# --- Module financier ---
# Amounts use Float (not Numeric) to match every other money field already in
# this file (Entry.materiel, etc.) — SQLite has no native DECIMAL type, it
# would just store as a float anyway.
ACHAT_TYPES = ('facture', 'estimation_petites_fournitures')

class ChantierFinancier(db.Model):
    """Le prévisionnel d'un chantier — un seul enregistrement par chantier.
    Le CA prévisionnel (adjugé/régie/PV clients/...) vit maintenant dans
    CaLignePrevue — une liste à taille libre (réf. Excel C10:D14) plutôt que
    3 champs fixes, pour permettre 1 seule ligne ou 5 selon le chantier.
    Tout le reste (CA réel, achats, marges, écarts) est calculé à la volée
    par financier_calculs(), jamais stocké — voir ce module pour le détail
    des formules (copiées du classeur Excel de référence)."""
    __tablename__ = 'chantier_financiers'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False, unique=True)

    charge_materiel_prevue = db.Column(db.Float, nullable=False, default=0.0)
    taux_horaire = db.Column(db.Float, nullable=False, default=0.0)
    pct_petites_fournitures = db.Column(db.Float, nullable=False, default=0.0)

    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    chantier = db.relationship('Chantier', backref=db.backref('financier', uselist=False, cascade='all, delete-orphan'))

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'charge_materiel_prevue': self.charge_materiel_prevue,
            'taux_horaire': self.taux_horaire,
            'pct_petites_fournitures': self.pct_petites_fournitures,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

class CaLignePrevue(db.Model):
    """Une ligne du chiffre d'affaires prévisionnel — montant + heures allouées
    (réf. Excel C10:D14 : adjugé / travaux en régie / PV clients / ...).
    Liste à taille libre : certains chantiers n'ont qu'une ligne, d'autres
    davantage (régie facturée en plusieurs fois, etc)."""
    __tablename__ = 'ca_lignes_prevues'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    libelle = db.Column(db.String(100), nullable=False)
    montant = db.Column(db.Float, nullable=False)
    heures = db.Column(db.Float, nullable=False, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    chantier = db.relationship('Chantier', backref=db.backref('ca_lignes_prevues', cascade='all, delete-orphan', lazy='selectin'))

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'libelle': self.libelle,
            'montant': self.montant,
            'heures': self.heures,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

class Acompte(db.Model):
    """Un versement facturé et encaissé — le CA réel (réf. Excel F10:G14).
    `heures` (optionnel) : les heures effectivement travaillées/facturées
    correspondant à cet acompte — sert à repérer un acompte facturé sans
    heures notées en face (voir manage_financier / le rouge côté frontend)."""
    __tablename__ = 'acomptes'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    libelle = db.Column(db.String(100), nullable=False)
    montant = db.Column(db.Float, nullable=False)
    heures = db.Column(db.Float, nullable=False, default=0.0)
    date = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    chantier = db.relationship('Chantier', backref=db.backref('acomptes', cascade='all, delete-orphan', lazy='selectin'))

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'libelle': self.libelle,
            'montant': self.montant,
            'heures': self.heures,
            'date': self.date,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

class AchatMateriel(db.Model):
    """Un achat matériel réel (réf. Excel F19:G25). type='estimation_petites_fournitures'
    is the one auto-computed row (montant = charge_materiel_prevue * pct_petites_fournitures,
    réf. G19=C26*D19) — kept up to date by sync_petites_fournitures(), never hand-edited."""
    __tablename__ = 'achats_materiel'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    libelle = db.Column(db.String(150), nullable=False)
    montant = db.Column(db.Float, nullable=False)
    date = db.Column(db.String(20), nullable=True)
    type = db.Column(db.String(30), nullable=False, default='facture')
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    chantier = db.relationship('Chantier', backref=db.backref('achats_materiel', cascade='all, delete-orphan', lazy='selectin'))

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'libelle': self.libelle,
            'montant': self.montant,
            'date': self.date,
            'type': self.type,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

class ChantierPrevision(db.Model):
    """Module de prévision annuelle — TOTALEMENT INDÉPENDANT de l'Agenda, des
    chantier_assignments et du module financier : sert uniquement à visualiser/
    planifier l'activité de l'année sur un calendrier annuel séparé. Le seul
    lien autorisé avec les autres tables est en LECTURE SEULE, pour pré-remplir
    un chantier déjà réel (voir /api/prevision/import) — jamais en écriture
    vers `chantiers` ou une autre table. Ce module doit continuer de
    fonctionner même si l'Agenda ou le financier changent de forme.

    statut='prevu'    : chantier "qui va se faire" mais pas encore créé dans
                         l'app — chantier_id reste NULL.
    statut='confirme' : chantier réel, importé depuis `chantiers` (chantier_id
                         renseigné). Ses dates théoriques sont pré-remplies à
                         l'import depuis ce chantier réel, puis vivent leur vie
                         propre ici (modifiables indépendamment ensuite)."""
    __tablename__ = 'chantiers_prevision'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(150), nullable=False)
    referent_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    montant_estime = db.Column(db.Float, nullable=True)
    date_debut_theorique = db.Column(db.String(20), nullable=True)
    date_fin_theorique = db.Column(db.String(20), nullable=True)
    statut = db.Column(db.String(20), nullable=False, default='prevu')  # 'prevu' or 'confirme'
    # Optional link to a real chantier — read-only reference, set only by the
    # /api/prevision/import endpoint or an explicit manual link via PUT/POST.
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    referent = db.relationship('User', foreign_keys=[referent_id])
    chantier = db.relationship('Chantier', foreign_keys=[chantier_id])

    def to_dict(self):
        return {
            'id': self.id,
            'nom': self.nom,
            'referent_id': self.referent_id,
            'referent_username': self.referent.username if self.referent else None,
            'montant_estime': self.montant_estime,
            'date_debut_theorique': self.date_debut_theorique,
            'date_fin_theorique': self.date_fin_theorique,
            'statut': self.statut,
            'chantier_id': self.chantier_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

def sanitize_folder_name(name):
    """Make a chantier name safe to use as a filesystem folder name."""
    name = (name or '').strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)  # illegal on Windows/most filesystems
    name = name.strip(' .')  # trailing dot/space is illegal on Windows
    return name[:100] or 'chantier'

def chantier_storage_dirname(chantier):
    """Return the on-disk folder name for this chantier — its own name, kept
    in sync on rename (moves the existing folder rather than orphaning it),
    with a numeric suffix only if that name collides with a DIFFERENT
    chantier's folder."""
    root = os.path.join(app.config['UPLOAD_FOLDER'], 'chantiers')
    os.makedirs(root, exist_ok=True)
    desired = sanitize_folder_name(chantier.nom)

    if chantier.storage_dir == desired:
        return chantier.storage_dir

    old_path = os.path.join(root, chantier.storage_dir) if chantier.storage_dir else None

    target = desired
    n = 2
    while os.path.isdir(os.path.join(root, target)) and target != chantier.storage_dir:
        target = f"{desired}_{n}"
        n += 1

    if old_path and os.path.isdir(old_path) and target != chantier.storage_dir:
        shutil.move(old_path, os.path.join(root, target))

    chantier.storage_dir = target
    db.session.commit()
    return target

def chantier_storage_dir(chantier):
    return os.path.join(app.config['UPLOAD_FOLDER'], 'chantiers', chantier_storage_dirname(chantier))

def category_dir(chantier, category, create=True):
    d = os.path.join(chantier_storage_dir(chantier), CATEGORY_FOLDERS[category])
    if create:
        os.makedirs(d, exist_ok=True)
    return d

def document_disk_path(doc):
    return os.path.join(category_dir(doc.chantier, doc.category, create=False), doc.filename)

def archive_chantier_documents(chantier):
    """Zip the chantier's whole document folder into ARCHIVE_FOLDER, then
    delete the live folder — only once the zip is confirmed complete and
    readable, so a failed/partial zip never costs the original files."""
    src_dir = chantier_storage_dir(chantier)
    if not os.path.isdir(src_dir) or not chantier.documents:
        chantier.archived = False
        chantier.archive_zip_path = None
        return

    zip_name = f"chantier_{chantier.id}.zip"
    zip_path = os.path.join(app.config['ARCHIVE_FOLDER'], zip_name)
    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.zip', dir=app.config['ARCHIVE_FOLDER'])
    os.close(tmp_fd)
    try:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for doc in chantier.documents:
                disk_path = document_disk_path(doc)
                if os.path.isfile(disk_path):
                    arcname = f"{CATEGORY_FOLDERS[doc.category]}/{doc.filename}"
                    zf.write(disk_path, arcname)

        # Verify the archive is intact before touching the originals.
        with zipfile.ZipFile(tmp_path) as zf:
            bad_file = zf.testzip()
            if bad_file is not None:
                raise IOError(f"Corrupt entry in archive: {bad_file}")

        shutil.move(tmp_path, zip_path)
        shutil.rmtree(src_dir, ignore_errors=True)
        chantier.archived = True
        chantier.archive_zip_path = zip_name
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def unarchive_chantier_documents(chantier):
    """Re-extract a closed chantier's archive back to live storage (reopen)."""
    if not chantier.archive_zip_path:
        return
    zip_path = os.path.join(app.config['ARCHIVE_FOLDER'], chantier.archive_zip_path)
    dest_dir = chantier_storage_dir(chantier)
    if os.path.isfile(zip_path):
        os.makedirs(dest_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir)
        os.remove(zip_path)
    chantier.archived = False
    chantier.archive_zip_path = None

# --- Database Initialization ---
# --- Database Initialization ---
def init_db():
    data_dir = os.path.join(os.getcwd(), 'data')
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    
    with app.app_context():
        db.create_all()
        
        # --- Auto-Migration for existing databases ---
        inspector = inspect(db.engine)
        existing_tables = inspector.get_table_names()

        with db.engine.connect() as conn:
            # 1. Users Table
            if 'users' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('users')]
                if 'vacation_balance' not in cols:
                    logger.info("Migrating users: adding vacation_balance")
                    conn.execute(text("ALTER TABLE users ADD COLUMN vacation_balance FLOAT DEFAULT 0.0"))
                    conn.commit()
                if 'pin_hash' not in cols:
                    logger.info("Migrating users: adding pin_hash column")
                    conn.execute(text("ALTER TABLE users ADD COLUMN pin_hash VARCHAR(256)"))
                    conn.commit()
                    # Migrate existing plaintext PINs to hashed PINs
                    if 'pin' in cols:
                        from sqlalchemy import text as sql_text
                        rows = conn.execute(sql_text("SELECT id, pin FROM users")).fetchall()
                        for row in rows:
                            hashed = generate_password_hash(row[1])
                            conn.execute(sql_text("UPDATE users SET pin_hash = :hash WHERE id = :id"), {"hash": hashed, "id": row[0]})
                        conn.commit()
                        logger.info(f"Migrated {len(rows)} user PINs to hashed format.")

                # Security: wipe any leftover plaintext PIN in the legacy `pin` column.
                # This column is never written to by the app anymore (pin_hash only),
                # but old rows migrated from a pre-hash schema can still carry the
                # plaintext value here — clear it unconditionally, every startup.
                if 'pin' in cols:
                    conn.execute(text("UPDATE users SET pin = '' WHERE pin IS NOT NULL AND pin != ''"))
                    conn.commit()
                if 'must_change_pin' not in cols:
                    logger.info("Migrating users: adding must_change_pin")
                    conn.execute(text("ALTER TABLE users ADD COLUMN must_change_pin BOOLEAN DEFAULT 0"))
                    conn.commit()

                # PIN login retired — password + role-gated 2FA (see MFA_REQUIRED_ROLES).
                auth_new_cols = {
                    'password_hash': 'VARCHAR(300)',
                    'must_change_password': 'BOOLEAN DEFAULT 1',
                    'mfa_enabled': 'BOOLEAN DEFAULT 0',
                    'mfa_secret_enc': 'VARCHAR(300)',
                    'mfa_pending_secret_enc': 'VARCHAR(300)',
                    'mfa_enrolled_at': 'DATETIME',
                    'lockout_stage': 'INTEGER DEFAULT 0',
                    'locked_until': 'DATETIME',
                    'sessions_invalidated_at': 'DATETIME',
                }
                for col_name, col_type in auth_new_cols.items():
                    if col_name not in cols:
                        logger.info(f"Migrating users: adding {col_name}")
                        conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
                        conn.commit()

            # 2. Chantiers Table
            if 'chantiers' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('chantiers')]
                new_cols = {
                    'address_work': 'VARCHAR(200)',
                    'address_billing': 'VARCHAR(200)',
                    'date_start': 'VARCHAR(20)',
                    'date_end': 'VARCHAR(20)',
                    'remarque': 'TEXT',
                    'status': "VARCHAR(20) DEFAULT 'FUTURE'",
                    'plan_pdf_path': "VARCHAR(255)",
                    'archived': "BOOLEAN DEFAULT 0",
                    'archive_zip_path': "VARCHAR(255)",
                    'storage_dir': "VARCHAR(150)",
                    'numero': "VARCHAR(10)",
                    'commune': "VARCHAR(100)",
                    'client_repere': "VARCHAR(100)",
                }
                for col_name, col_type in new_cols.items():
                    if col_name not in cols:
                        logger.info(f"Migrating chantiers: adding {col_name}")
                        conn.execute(text(f"ALTER TABLE chantiers ADD COLUMN {col_name} {col_type}"))
                        conn.commit()

            # 3. Entries Table
            if 'entries' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('entries')]
                if 'status' not in cols:
                    logger.info("Migrating entries: adding status")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN status VARCHAR(20) DEFAULT 'PENDING'"))
                    conn.commit()
                if 'created_by_id' not in cols:
                    logger.info("Migrating entries: adding created_by_id")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN created_by_id INTEGER REFERENCES users(id)"))
                    conn.commit()
                if 'admin_note' not in cols:
                    logger.info("Migrating entries: adding admin_note")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN admin_note TEXT"))
                    conn.commit()
                if 'client_ref' not in cols:
                    logger.info("Migrating entries: adding client_ref")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN client_ref VARCHAR(64)"))
                    conn.commit()

            # 4. Leaves Table
            if 'leaves' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('leaves')]
                if 'admin_note' not in cols:
                    logger.info("Migrating leaves: adding admin_note")
                    conn.execute(text("ALTER TABLE leaves ADD COLUMN admin_note TEXT"))
                    conn.commit()

            # 5. Acomptes Table — heures facturées en face de ce versement
            # (repéré côté frontend quand c'est resté à 0 alors qu'un montant a été noté)
            if 'acomptes' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('acomptes')]
                if 'heures' not in cols:
                    logger.info("Migrating acomptes: adding heures")
                    conn.execute(text("ALTER TABLE acomptes ADD COLUMN heures FLOAT DEFAULT 0"))
                    conn.commit()

            # 6. ChantierFinancier — montant_adjuge/heures_adjugees/montant_regie/
            # heures_regie/montant_pv_clients/heures_pv_clients were required
            # (NOT NULL) columns before the CA-prévisionnel-became-a-list
            # refactor (see CaLignePrevue / the migration right below). SQLite
            # can't relax a NOT NULL via plain ALTER TABLE, so on any database
            # that predates that refactor, EVERY chantier_financiers row
            # created since (i.e. for any chantier that didn't already have
            # one) fails to INSERT at all — the ORM never sets those columns
            # since it doesn't know about them anymore. Rebuild the table
            # once: every column stays (never dropped, per convention), only
            # those six become nullable.
            if 'chantier_financiers' in existing_tables:
                fin_col_info = inspector.get_columns('chantier_financiers')
                legacy_notnull = next(
                    (c for c in fin_col_info if c['name'] == 'montant_adjuge' and not c['nullable']), None
                )
                if legacy_notnull:
                    logger.info("Rebuilding chantier_financiers: relaxing legacy NOT NULL CA columns")
                    conn.execute(text("""
                        CREATE TABLE chantier_financiers_new (
                            id INTEGER PRIMARY KEY,
                            chantier_id INTEGER NOT NULL UNIQUE REFERENCES chantiers(id),
                            montant_adjuge FLOAT,
                            heures_adjugees FLOAT,
                            montant_regie FLOAT,
                            heures_regie FLOAT,
                            montant_pv_clients FLOAT,
                            heures_pv_clients FLOAT,
                            charge_materiel_prevue FLOAT NOT NULL DEFAULT 0.0,
                            taux_horaire FLOAT NOT NULL DEFAULT 0.0,
                            pct_petites_fournitures FLOAT NOT NULL DEFAULT 0.0,
                            created_at DATETIME,
                            updated_at DATETIME
                        )
                    """))
                    conn.execute(text("""
                        INSERT INTO chantier_financiers_new (
                            id, chantier_id, montant_adjuge, heures_adjugees, montant_regie,
                            heures_regie, montant_pv_clients, heures_pv_clients,
                            charge_materiel_prevue, taux_horaire, pct_petites_fournitures,
                            created_at, updated_at
                        )
                        SELECT id, chantier_id, montant_adjuge, heures_adjugees, montant_regie,
                               heures_regie, montant_pv_clients, heures_pv_clients,
                               charge_materiel_prevue, taux_horaire, pct_petites_fournitures,
                               created_at, updated_at
                        FROM chantier_financiers
                    """))
                    conn.execute(text("DROP TABLE chantier_financiers"))
                    conn.execute(text("ALTER TABLE chantier_financiers_new RENAME TO chantier_financiers"))
                    conn.commit()
                    inspector = inspect(db.engine)
                    existing_tables = inspector.get_table_names()

        # One-time migration: CA prévisionnel était 3 champs fixes sur
        # chantier_financiers (montant_adjuge/heures_adjugees, montant_regie/
        # heures_regie, montant_pv_clients/heures_pv_clients) — remplacés par
        # une liste à taille libre (CaLignePrevue) pour permettre 1 ligne ou 5
        # selon le chantier. Ces colonnes existent encore sur les tables déjà
        # créées (jamais supprimées, juste abandonnées côté modèle) — on les
        # relit une dernière fois en SQL brut pour semer les lignes initiales.
        if 'chantier_financiers' in existing_tables:
            fin_cols = {c['name'] for c in inspector.get_columns('chantier_financiers')}
            legacy_ca_cols = {'montant_adjuge', 'heures_adjugees', 'montant_regie', 'heures_regie', 'montant_pv_clients', 'heures_pv_clients'}
            if legacy_ca_cols.issubset(fin_cols):
                with db.engine.connect() as legacy_conn:
                    legacy_rows = legacy_conn.execute(text(
                        "SELECT chantier_id, montant_adjuge, heures_adjugees, montant_regie, heures_regie, "
                        "montant_pv_clients, heures_pv_clients FROM chantier_financiers"
                    )).fetchall()
                seed_specs = [
                    ('Adjugé', 1, 2), ('Travaux en régie', 3, 4), ('PV clients', 5, 6),
                ]
                migrated = 0
                for row in legacy_rows:
                    chantier_id = row[0]
                    if CaLignePrevue.query.filter_by(chantier_id=chantier_id).first():
                        continue  # déjà migré (ou des lignes existent déjà pour ce chantier)
                    for libelle, montant_idx, heures_idx in seed_specs:
                        montant = row[montant_idx] or 0
                        heures = row[heures_idx] or 0
                        if not montant and not heures:
                            continue
                        db.session.add(CaLignePrevue(chantier_id=chantier_id, libelle=libelle, montant=montant, heures=heures))
                        migrated += 1
                if migrated:
                    db.session.commit()
                    logger.info(f"Migrated {migrated} CA prévisionnel line(s) into ca_lignes_prevues")

        # One-time migration: the old Plan/Devis/Mesures/Rapports categories
        # were merged into a single "document" category — move each affected
        # file into the new documents/ subfolder and relabel its row. uuid-based
        # filenames never collide, so folders merge safely.
        legacy_folders = {'plan': 'plans', 'devis': 'devis', 'mesure': 'mesures', 'rapport': 'rapports_intervention'}
        legacy_docs = Document.query.filter(Document.category.in_(legacy_folders.keys())).all()
        for doc in legacy_docs:
            old_dir = os.path.join(chantier_storage_dir(doc.chantier), legacy_folders[doc.category])
            old_path = os.path.join(old_dir, doc.filename)
            new_dir = category_dir(doc.chantier, 'document')
            if os.path.isfile(old_path):
                shutil.move(old_path, os.path.join(new_dir, doc.filename))
            doc.category = 'document'
        if legacy_docs:
            db.session.commit()
            logger.info(f"Migrated {len(legacy_docs)} document(s) into the unified 'document' category")

        # One-time migration: fold each chantier's old single plan_pdf_path
        # file into the new multi-document (Plan/Devis/Photos) system, so the
        # unified file explorer shows plans that were uploaded before it existed.
        for chantier in Chantier.query.filter(Chantier.plan_pdf_path.isnot(None)).all():
            already_migrated = Document.query.filter_by(
                chantier_id=chantier.id, category='document', original_filename=chantier.plan_pdf_path
            ).first()
            if already_migrated:
                continue
            old_path = os.path.join(app.config['UPLOAD_FOLDER'], chantier.plan_pdf_path)
            if not os.path.isfile(old_path):
                continue
            new_filename = f"{uuid.uuid4().hex}.pdf"
            dest_dir = category_dir(chantier, 'document')
            shutil.copy2(old_path, os.path.join(dest_dir, new_filename))
            db.session.add(Document(
                chantier_id=chantier.id,
                category='document',
                filename=new_filename,
                original_filename=chantier.plan_pdf_path,
                size_bytes=os.path.getsize(old_path),
                mimetype='application/pdf',
            ))
            logger.info(f"Migrated legacy plan PDF for chantier {chantier.id} into document store")
        db.session.commit()

        # One-time migration: chantier document folders used to be named by
        # numeric ID ("chantiers/1") — rename them to the chantier's own name
        # so the folder structure reads correctly when browsed on disk.
        chantiers_root = os.path.join(app.config['UPLOAD_FOLDER'], 'chantiers')
        if os.path.isdir(chantiers_root):
            for chantier in Chantier.query.filter(Chantier.storage_dir.is_(None)).all():
                legacy_path = os.path.join(chantiers_root, str(chantier.id))
                if os.path.isdir(legacy_path):
                    chantier.storage_dir = str(chantier.id)
                    chantier_storage_dirname(chantier)  # renames on disk + persists the new name
                    logger.info(f"Renamed chantier {chantier.id} document folder to its own name")

        # Seed the chantier numéro counter once — start it at the current
        # chantier count rather than 0, so the first nomenclature-enforced
        # chantier doesn't visually restart at "00001" while dozens of
        # legacy chantiers already exist. Purely cosmetic continuity; the
        # counter itself never resets or reuses a value once created.
        if not SequenceCounter.query.filter_by(name='chantier_numero').first():
            db.session.add(SequenceCounter(name='chantier_numero', value=Chantier.query.count()))
            db.session.commit()

        # One-time migration: PIN login retired — every account created
        # before this change has no password_hash yet. Generate a random
        # temp password per account (well above the 12-char/complexity bar
        # on its own — cryptographically random, never in the common-password
        # list), force a change at next login, and log it the same way the
        # very first Admin bootstrap always has (below) — it's the only
        # place these temp credentials exist, hand them to each user directly.
        legacy_users = User.query.filter(User.password_hash.is_(None)).all()
        for legacy_user in legacy_users:
            temp_password = secrets.token_urlsafe(12)
            legacy_user.pin_hash = generate_password_hash(secrets.token_hex(16))  # orphan the old PIN, unusable
            legacy_user.set_password(temp_password)
            legacy_user.must_change_password = True
            logger.warning(
                f"⚠️ PIN login retired for user '{legacy_user.username}' — TEMP PASSWORD: {temp_password} "
                f"— give it to them, they'll be asked to change it{' and set up 2FA' if legacy_user.role in MFA_REQUIRED_ROLES else ''} at next login."
            )
        if legacy_users:
            db.session.commit()

        # Create default admin if not exists
        if not User.query.filter_by(username='Admin').first():
            default_password = secrets.token_urlsafe(12)
            admin = User(username='Admin', pin_hash=generate_password_hash(secrets.token_hex(16)), role='admin', must_change_password=True)
            admin.set_password(default_password)
            db.session.add(admin)
            db.session.commit()
            logger.warning(f"⚠️ Default Admin created with PASSWORD: {default_password} — CHANGE IT IMMEDIATELY! (2FA setup required on first login)")

# --- Routes ---

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.errorhandler(404)
def not_found(e):
    return send_from_directory(app.static_folder, 'index.html')

# API Routes

# --- Auth: username + password, then role-gated 2FA (see MFA_REQUIRED_ROLES) ---
# Three-state contract every step below funnels into, mirrored exactly by
# the frontend's Login.tsx: status is 'ok' (session issued), 'mfa_required'
# (password OK, enter the 6-digit code) or 'mfa_enroll_required' (password
# OK, this account needs 2FA set up before it can get a session).

@app.route('/api/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': "Nom d'utilisateur et mot de passe requis"}), 400

    user = User.query.filter_by(username=username).first()
    if user and is_account_locked(user):
        return jsonify({'error': 'Compte temporairement verrouillé après plusieurs échecs — réessayez plus tard'}), 423

    # Same generic error either way — never confirm/deny whether the
    # username exists (account enumeration).
    if not user or not user.check_password(password):
        _record_login_attempt(username, False, 'bad_credentials')
        if user:
            _maybe_lock_account(user)
        return jsonify({'error': "Nom d'utilisateur ou mot de passe incorrect"}), 401

    _record_login_attempt(username, True)
    _reset_lockout(user)
    db.session.commit()

    if user.role in MFA_REQUIRED_ROLES:
        purpose = 'mfa_verify' if user.mfa_enabled else 'mfa_enroll'
        return jsonify({
            'status': 'mfa_required' if user.mfa_enabled else 'mfa_enroll_required',
            'mfa_token': issue_mfa_pending_token(user, purpose),
        })

    return _issue_session(user)


@app.route('/api/mfa/verify', methods=['POST'])
@limiter.limit("10 per minute")
def mfa_verify():
    data = request.json or {}
    user = decode_mfa_pending_token(data.get('mfa_token'), 'mfa_verify')
    if not user:
        return jsonify({'error': 'Session de connexion expirée — reconnectez-vous'}), 401
    if is_account_locked(user):
        return jsonify({'error': 'Compte temporairement verrouillé après plusieurs échecs — réessayez plus tard'}), 423

    code = (data.get('code') or '').strip()
    if not user.mfa_enabled or not user.mfa_secret_enc or not mfa_service.verify_totp(mfa_service.decrypt_secret(user.mfa_secret_enc), code):
        _record_login_attempt(user.username, False, 'bad_mfa_code')
        _maybe_lock_account(user)
        return jsonify({'error': 'Code de vérification incorrect'}), 401

    _record_login_attempt(user.username, True)
    _reset_lockout(user)
    db.session.commit()
    return _issue_session(user)


@app.route('/api/mfa/verify-backup', methods=['POST'])
@limiter.limit("10 per minute")
def mfa_verify_backup():
    data = request.json or {}
    user = decode_mfa_pending_token(data.get('mfa_token'), 'mfa_verify')
    if not user:
        return jsonify({'error': 'Session de connexion expirée — reconnectez-vous'}), 401
    if is_account_locked(user):
        return jsonify({'error': 'Compte temporairement verrouillé après plusieurs échecs — réessayez plus tard'}), 423

    backup_code = (data.get('backup_code') or '').strip()
    matched = None
    if backup_code:
        for candidate in MfaBackupCode.query.filter_by(user_id=user.id, used_at=None).all():
            if mfa_service.verify_backup_code(backup_code, candidate.code_hash):
                matched = candidate
                break

    if not matched:
        _record_login_attempt(user.username, False, 'bad_mfa_backup_code')
        _maybe_lock_account(user)
        return jsonify({'error': 'Code de récupération incorrect ou déjà utilisé'}), 401

    matched.used_at = datetime.datetime.utcnow()
    _record_login_attempt(user.username, True)
    _reset_lockout(user)
    db.session.commit()
    return _issue_session(user)


@app.route('/api/mfa/enroll/start', methods=['POST'])
@limiter.limit("10 per minute")
def mfa_enroll_start():
    user, _via_session = _resolve_mfa_enroll_actor(request.json or {})
    if not user:
        return jsonify({'error': 'Session expirée — reconnectez-vous'}), 401

    secret = mfa_service.generate_secret()
    user.mfa_pending_secret_enc = mfa_service.encrypt_secret(secret)
    db.session.commit()

    uri = mfa_service.provisioning_uri(secret, user.username)
    return jsonify({
        'qr_code_data_uri': mfa_service.qr_code_data_uri(uri),
        'manual_entry_key': secret,
    })


@app.route('/api/mfa/enroll/confirm', methods=['POST'])
@limiter.limit("10 per minute")
def mfa_enroll_confirm():
    data = request.json or {}
    user, via_session = _resolve_mfa_enroll_actor(data)
    if not user:
        return jsonify({'error': 'Session expirée — reconnectez-vous'}), 401
    if not user.mfa_pending_secret_enc:
        return jsonify({'error': 'Aucun enrôlement 2FA en cours — recommencez'}), 400

    code = (data.get('code') or '').strip()
    if not mfa_service.verify_totp(mfa_service.decrypt_secret(user.mfa_pending_secret_enc), code):
        return jsonify({'error': 'Code de vérification incorrect'}), 401

    user.mfa_secret_enc = user.mfa_pending_secret_enc
    user.mfa_pending_secret_enc = None
    user.mfa_enabled = True
    user.mfa_enrolled_at = datetime.datetime.utcnow()

    # Fresh backup codes replace any previous set — shown to the user
    # exactly once, right now; there is no way to view them again later.
    MfaBackupCode.query.filter_by(user_id=user.id).delete()
    plaintext_codes = mfa_service.generate_backup_codes()
    for code_plain in plaintext_codes:
        db.session.add(MfaBackupCode(user_id=user.id, code_hash=mfa_service.hash_backup_code(code_plain)))
    db.session.commit()

    if via_session:
        return jsonify({'backup_codes': plaintext_codes, 'session_issued': False, **user.to_dict()})

    # Mandatory mid-login enrollment — completes the login in the same call.
    _record_login_attempt(user.username, True)
    _reset_lockout(user)
    db.session.commit()
    response_body = {'backup_codes': plaintext_codes, 'session_issued': True, 'status': 'ok', **user.to_dict()}
    response = jsonify(response_body)
    token = serializer.dumps({'user_id': user.id})
    set_auth_cookie(response, token)
    return response


@app.route('/api/mfa/status', methods=['GET'])
@token_required
def mfa_status(current_user):
    remaining = MfaBackupCode.query.filter_by(user_id=current_user.id, used_at=None).count()
    return jsonify({'mfa_enabled': current_user.mfa_enabled, 'backup_codes_remaining': remaining})


@app.route('/api/mfa/disable', methods=['POST'])
@token_required
def mfa_disable(current_user):
    """Resets the caller's own 2FA. If their role still requires it
    (MFA_REQUIRED_ROLES), enrollment is simply triggered again at next
    login — this is a reset/recovery path (e.g. lost authenticator app),
    not a way to permanently opt out of a mandatory policy."""
    data = request.json or {}
    if not current_user.check_password(data.get('password') or ''):
        return jsonify({'error': 'Mot de passe incorrect'}), 401
    current_user.mfa_enabled = False
    current_user.mfa_secret_enc = None
    current_user.mfa_pending_secret_enc = None
    current_user.mfa_enrolled_at = None
    MfaBackupCode.query.filter_by(user_id=current_user.id).delete()
    db.session.commit()
    audit_log('auth', current_user, 'reset their own 2FA (will be re-required at next login if their role requires it)')
    return jsonify({'message': '2FA réinitialisée'})


@app.route('/api/mfa/admin-reset/<int:user_id>', methods=['POST'])
@token_required
def mfa_admin_reset(current_user, user_id):
    """Recovery path when a DIFFERENT admin lost their authenticator and
    backup codes both — requires the acting admin's own password, never
    the target's."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    data = request.json or {}
    if not current_user.check_password(data.get('password') or ''):
        return jsonify({'error': 'Mot de passe incorrect'}), 401
    target = db.session.get(User, user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    target.mfa_enabled = False
    target.mfa_secret_enc = None
    target.mfa_pending_secret_enc = None
    target.mfa_enrolled_at = None
    MfaBackupCode.query.filter_by(user_id=target.id).delete()
    db.session.commit()
    audit_log('auth', current_user, f"reset 2FA for {target.username} (id={target.id})")
    return jsonify({'message': f'2FA réinitialisée pour {target.username}'})


@app.route('/api/logout', methods=['POST'])
def logout():
    response = jsonify({'message': 'Logged out'})
    clear_auth_cookie(response)
    return response

@app.route('/api/me', methods=['GET'])
@token_required
def get_me(current_user):
    return jsonify(current_user.to_dict())

@app.route('/api/change-password', methods=['POST'])
@token_required
def change_password(current_user):
    data = request.json or {}
    if not current_user.check_password(data.get('current_password') or ''):
        return jsonify({'error': 'Mot de passe actuel incorrect'}), 401

    new_password = data.get('new_password') or ''
    error = validate_password(new_password)
    if error:
        return jsonify({'error': error}), 400

    current_user.set_password(new_password)
    current_user.must_change_password = False
    db.session.commit()
    audit_log('auth', current_user, 'changed their own password')
    return jsonify({'message': 'Mot de passe changé avec succès'})

@app.route('/api/users', methods=['GET', 'POST', 'DELETE'])
@token_required
def manage_users(current_user):
    # Only Admin can manage users
    if current_user.role != 'admin':
         return jsonify({'error': 'Admin access required'}), 403

    if request.method == 'GET':
        users = User.query.all()
        return jsonify([u.to_dict() for u in users])  # to_dict() never includes a secret — no masking needed

    if request.method == 'POST':
        data = request.json or {}
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''
        role = data.get('role')

        if not username:
            return jsonify({'error': 'Username is required'}), 400
        if role not in ['admin', 'user', 'depanneur']:
            return jsonify({'error': 'Invalid role'}), 400
        if User.query.filter_by(username=username).first():
             return jsonify({'error': 'Username exists'}), 400

        error = validate_password(password)
        if error:
            return jsonify({'error': error}), 400

        new_user = User(
            username=username, role=role, must_change_password=True,
            pin_hash=generate_password_hash(secrets.token_hex(16)),  # orphan legacy column, never used
        )
        new_user.set_password(password)
        db.session.add(new_user)
        db.session.commit()
        audit_log('auth', current_user, f"created user {username} (role={role})")
        return jsonify(new_user.to_dict()), 201

    return jsonify({'error': 'Method not allowed on this endpoint, use /api/users/<id>'}), 405

@app.route('/api/users/<int:user_id>', methods=['PUT', 'DELETE'])
@token_required
def user_operations(current_user, user_id):
    if current_user.role != 'admin':
         return jsonify({'error': 'Admin access required'}), 403

    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    if request.method == 'DELETE':
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'User deleted'})

    if request.method == 'PUT':
        data = request.json
        new_username = data.get('username')
        new_password = data.get('password')
        new_role = data.get('role')

        # Validation: Check uniqueness if changed
        if new_username and new_username != user.username:
            if User.query.filter_by(username=new_username).first():
                return jsonify({'error': 'Username exists'}), 400
            user.username = new_username

        if new_password:
            error = validate_password(new_password)
            if error:
                return jsonify({'error': error}), 400
            user.set_password(new_password)
            user.must_change_password = True  # admin-set password is always a temp one
            audit_log('auth', current_user, f"reset password for {user.username} (id={user.id})")

        if new_role:
            if new_role not in ['admin', 'user', 'depanneur']:
                return jsonify({'error': 'Invalid role'}), 400
            user.role = new_role

        db.session.commit()
        return jsonify(user.to_dict())


@app.route('/api/users/<int:user_id>/force-logout', methods=['POST'])
@token_required
def force_logout_user(current_user, user_id):
    """Kills every open session for this account instantly, everywhere —
    see sessions_invalidated_at / token_required. Also resets the account's
    own lockout so a legitimately-forced-out user isn't accidentally left
    unable to log back in."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    if user_id == current_user.id:
        return jsonify({'error': "Utilisez le bouton Déconnexion pour vous déconnecter vous-même"}), 400
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    # itsdangerous signs with second-precision timestamps — truncate to the
    # second here too, so a token issued in the very same second as this
    # action (e.g. logging back in right away) isn't wrongly killed by a
    # microsecond of skew between the two clocks being compared.
    user.sessions_invalidated_at = datetime.datetime.utcnow().replace(microsecond=0)
    _reset_lockout(user)  # matches this endpoint's whole point — don't force them out and leave them locked out too
    db.session.commit()
    audit_log('auth', current_user, f"force-logged-out {user.username} (id={user.id})")
    return jsonify({'message': f'{user.username} déconnecté de partout'})


@app.route('/api/backup', methods=['POST'])
@token_required
def trigger_backup(current_user):
    if current_user.role != 'admin':
         return jsonify({'error': 'Admin access required'}), 403
    # Level 1: Local Backup
    try:
        backup_dir = os.path.join(os.getcwd(), 'backup')
        if not os.path.exists(backup_dir):
            os.makedirs(backup_dir)
            
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Backup DB
        db_path = os.path.join(os.getcwd(), 'data', 'chantier.db')
        if os.path.exists(db_path):
            shutil.copy2(db_path, os.path.join(backup_dir, f'chantier_{timestamp}.db'))
            
        # Backup PDFs (assuming they are in data/pdfs or similar, user said "dossier PDF")
        # For now, let's assume they are stored relative to app.
        
        # Level 2: Cloud (Placeholder for rclone/script trigger)
        # os.system("rclone copy ...")
        
        return jsonify({'message': 'Backup created successfully', 'timestamp': timestamp})
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/holidays/<int:year>', methods=['GET'])
def get_valais_holidays(year):
    import datetime
    
    # Algorithme de Meeus/Jones/Butcher pour calculer la date de Pâques
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    
    easter = datetime.date(year, month, day)
    
    # L'Ascension est 39 jours après Pâques
    ascension = easter + datetime.timedelta(days=39)
    # La Fête-Dieu est 60 jours après Pâques
    fete_dieu = easter + datetime.timedelta(days=60)
    
    holidays_map = {
        f"{year}-01-01": "Nouvel An",
        f"{year}-03-19": "Saint-Joseph",
        ascension.strftime("%Y-%m-%d"): "Ascension",
        fete_dieu.strftime("%Y-%m-%d"): "Fête-Dieu",
        f"{year}-08-01": "Fête nationale",
        f"{year}-08-15": "Assomption",
        f"{year}-11-01": "Toussaint",
        f"{year}-12-08": "Immaculée Conception",
        f"{year}-12-25": "Noël"
    }
    
    return jsonify(holidays_map)

@app.route('/api/chantiers', methods=['GET', 'POST'])
@token_required
def manage_chantiers(current_user):
    if request.method == 'GET':
        status = request.args.get('status') # 'FUTURE', 'ACTIVE', 'DONE' or 'ALL'

        query = Chantier.query
        
        # Status Filter
        if status and status != 'ALL':
            query = query.filter(Chantier.status == status)
        
        # Everyone sees all chantiers now (Requirement change)
        
        chantiers = query.all()

        # Batch hours_total for the whole list in one grouped query instead
        # of letting each chantier's to_dict() run its own — avoids
        # reintroducing the N+1 pattern already fixed once here.
        hours_by_chantier = dict(
            db.session.query(Entry.chantier_id, func.sum(Entry.heures))
            .group_by(Entry.chantier_id).all()
        )
        for c in chantiers:
            c._hours_total_precomputed = hours_by_chantier.get(c.id, 0.0)

        return jsonify([c.to_dict() for c in chantiers])

    if request.method == 'POST':
        data = request.json or {}

        # Nomenclature imposée : {AA}{NNNNN}-Commune-Client (ex: 2600347-Martigny-Dupont).
        # Le numéro (année + compteur global) est généré côté serveur, jamais
        # saisi — c'est ce qui garantit qu'il reste unique et croissant.
        commune = (data.get('commune') or '').strip()
        client_repere = (data.get('client_repere') or '').strip()
        if not commune or not client_repere:
            return jsonify({'error': 'Commune et client/repère sont requis'}), 400

        annee = data.get('annee', datetime.datetime.now().year)
        numero = _next_chantier_numero(annee)
        nom = f"{numero}-{commune}-{client_repere}"

        new_chantier = Chantier(
            nom=nom,
            numero=numero,
            commune=commune,
            client_repere=client_repere,
            annee=annee,
            pdf_path=data.get('pdf_path', ''),
            address_work=data.get('address_work'),
            address_billing=data.get('address_billing'),
            date_start=data.get('date_start'),
            date_end=data.get('date_end'),
            remarque=data.get('remarque'),
            status=data.get('status', 'FUTURE')
        )

        # Members assignment removed

        db.session.add(new_chantier)
        db.session.commit()
        return jsonify(new_chantier.to_dict()), 201

@app.route('/api/chantiers/<int:chantier_id>', methods=['PUT', 'GET'])
@token_required
def chantier_detail(current_user, chantier_id):
    chantier = db.session.get(Chantier, chantier_id)
    if not chantier:
        return jsonify({'error': 'Chantier not found'}), 404
        
    if request.method == 'GET':
        return jsonify(chantier.to_dict())

    if request.method == 'PUT':
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        data = request.json
        previous_status = chantier.status
        chantier.nom = data.get('nom', chantier.nom)
        chantier.annee = data.get('annee', chantier.annee)
        chantier.pdf_path = data.get('pdf_path', chantier.pdf_path)
        chantier.address_work = data.get('address_work', chantier.address_work)
        chantier.address_billing = data.get('address_billing', chantier.address_billing)
        chantier.date_start = data.get('date_start', chantier.date_start)
        chantier.date_end = data.get('date_end', chantier.date_end)
        chantier.remarque = data.get('remarque', chantier.remarque)
        new_status = data.get('status', chantier.status)
        chantier.status = new_status

        # Closing a chantier archives its document folder (zipped + originals
        # freed); reopening one re-extracts it. Best-effort: a storage hiccup
        # here shouldn't block the status change itself.
        try:
            if chantier.status == 'DONE' and previous_status != 'DONE':
                archive_chantier_documents(chantier)
            elif chantier.status != 'DONE' and previous_status == 'DONE' and chantier.archived:
                unarchive_chantier_documents(chantier)
        except Exception as e:
            logger.error(f"Archive/unarchive failed for chantier {chantier.id}: {e}")

        # Renaming the chantier renames its document folder to match right
        # away, rather than leaving it under the old name until the next
        # document upload happens to touch it.
        try:
            chantier_storage_dirname(chantier)
        except Exception as e:
            logger.error(f"Could not rename storage folder for chantier {chantier.id}: {e}")

        db.session.commit()
        return jsonify(chantier.to_dict())

def _process_photo(file_storage):
    """Compress an uploaded photo for storage: correct EXIF rotation, cap the
    longest side at 1600px, re-encode as JPEG q=70. This is a real, permanent
    quality tradeoff (there's no way to shrink storage and hand back the
    untouched original) — 1600px/q70 still reads sharp on a phone/tablet
    screen while cutting typical phone-camera file sizes (5-15MB) down to
    well under 150KB in most cases."""
    img = Image.open(file_storage.stream)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')
    max_side = 1600
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format='JPEG', quality=65, optimize=True)
    buf.seek(0)
    return buf

def _compress_pdf(file_storage):
    """Optimize an uploaded PDF for storage. Two passes:
    1. Structural cleanup (strip unused objects, compress streams) — always
       lossless, applies to any PDF. Gains are small on typical office-export
       plans/devis (they're already compact) but real.
    2. Downsample embedded raster images — this is where the actual size wins
       come from, and only matters for scanned/photographed plans (a PDF
       that's just text/vector, like a normal quote, has none). Same
       permanent quality tradeoff as photos: capped resolution + JPEG
       re-encode. Any single image is skipped (left as-is) if that doesn't
       actually shrink it or if it can't be decoded, so a weird embedded
       asset never risks corrupting the document."""
    doc = fitz.open(stream=file_storage.read(), filetype='pdf')

    for page in doc:
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                extracted = doc.extract_image(xref)
                pil_img = Image.open(BytesIO(extracted['image']))
                if pil_img.mode not in ('RGB', 'L'):
                    pil_img = pil_img.convert('RGB')
                max_side = 1800
                if max(pil_img.size) > max_side:
                    pil_img.thumbnail((max_side, max_side), Image.LANCZOS)
                out = BytesIO()
                pil_img.save(out, format='JPEG', quality=70, optimize=True)
                if len(out.getvalue()) < len(extracted['image']):
                    page.replace_image(xref, stream=out.getvalue())
            except Exception:
                continue

    buf = BytesIO()
    doc.save(buf, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True)
    doc.close()
    buf.seek(0)
    return buf

@app.route('/api/chantiers/<int:id>/documents', methods=['GET', 'POST'])
@token_required
def manage_documents(current_user, id):
    chantier = Chantier.query.get_or_404(id)

    if request.method == 'GET':
        docs = Document.query.filter_by(chantier_id=id).order_by(Document.uploaded_at.desc()).all()
        return jsonify({
            'archived': bool(chantier.archived),
            'documents': [d.to_dict() for d in docs],
        })

    # POST — upload one file
    if chantier.archived:
        return jsonify({'error': 'Ce chantier est clôturé et archivé — rouvrez-le pour ajouter des documents'}), 409

    category = request.form.get('category')
    if category not in DOCUMENT_CATEGORIES:
        return jsonify({'error': 'Invalid category'}), 400

    if 'file' not in request.files or request.files['file'].filename == '':
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']

    if category == 'document':
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Only PDF files are allowed'}), 400
        header = file.read(5)
        file.seek(0)
        if header != b'%PDF-':
            return jsonify({'error': 'File is not a valid PDF'}), 400
        try:
            compressed = _compress_pdf(file)
        except Exception:
            return jsonify({'error': 'File is not a valid PDF'}), 400
        new_filename = f"{uuid.uuid4().hex}.pdf"
        dest = os.path.join(category_dir(chantier, category), new_filename)
        with open(dest, 'wb') as f:
            f.write(compressed.getbuffer())
        mimetype = 'application/pdf'
    else:
        try:
            compressed = _process_photo(file)
        except Exception:
            return jsonify({'error': 'File is not a valid image'}), 400
        new_filename = f"{uuid.uuid4().hex}.jpg"
        dest = os.path.join(category_dir(chantier, category), new_filename)
        with open(dest, 'wb') as f:
            f.write(compressed.getbuffer())
        mimetype = 'image/jpeg'

    doc = Document(
        chantier_id=id,
        category=category,
        filename=new_filename,
        original_filename=file.filename,
        size_bytes=os.path.getsize(dest),
        mimetype=mimetype,
        uploaded_by_id=current_user.id,
    )
    db.session.add(doc)
    db.session.commit()
    return jsonify(doc.to_dict()), 201

@app.route('/api/chantiers/<int:id>/documents/category', methods=['DELETE'])
@token_required
def delete_documents_category(current_user, id):
    """Empty one whole folder (Documents or Photos) for a chantier — the
    "delete folder" action in the explorer. Individual-file delete already
    exists on document_detail; this just loops it under one admin check."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    category = request.args.get('category')
    if category not in DOCUMENT_CATEGORIES:
        return jsonify({'error': 'Invalid category'}), 400
    docs = Document.query.filter_by(chantier_id=id, category=category).all()
    for doc in docs:
        disk_path = document_disk_path(doc)
        if os.path.isfile(disk_path):
            os.remove(disk_path)
        db.session.delete(doc)
    db.session.commit()
    return jsonify({'message': f'{len(docs)} fichier(s) supprimé(s)'})

@app.route('/api/documents/<int:doc_id>', methods=['GET', 'DELETE'])
@token_required
def document_detail(current_user, doc_id):
    doc = Document.query.get_or_404(doc_id)

    if request.method == 'DELETE':
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        disk_path = document_disk_path(doc)
        if os.path.isfile(disk_path):
            os.remove(disk_path)
        db.session.delete(doc)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    disk_path = document_disk_path(doc)
    if not os.path.isfile(disk_path):
        return jsonify({'error': 'Fichier introuvable (chantier peut-être archivé)'}), 404
    return send_file(disk_path, as_attachment=True, download_name=doc.original_filename, mimetype=doc.mimetype)

@app.route('/api/documents/<int:doc_id>/thumbnail', methods=['GET'])
@token_required
def document_thumbnail(current_user, doc_id):
    """Small on-the-fly JPEG for photo grids — the DocumentExplorer used to
    load the full compressed photo (up to ~150KB) just to show it in a
    thumbnail-sized cell. Computed per-request rather than stored: cheap
    (resizing an already-small source) and keeps storage at exactly one file
    per photo."""
    doc = Document.query.get_or_404(doc_id)
    if doc.category != 'photo':
        return jsonify({'error': 'Not a photo'}), 400
    disk_path = document_disk_path(doc)
    if not os.path.isfile(disk_path):
        return jsonify({'error': 'Fichier introuvable (chantier peut-être archivé)'}), 404
    try:
        img = Image.open(disk_path)
        img.thumbnail((300, 300), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format='JPEG', quality=60)
        buf.seek(0)
    except Exception as e:
        logger.error(f"Thumbnail generation failed for document {doc_id}: {e}")
        return jsonify({'error': 'Impossible de générer la miniature'}), 500
    return send_file(buf, mimetype='image/jpeg')

@app.route('/api/chantiers/<int:id>/documents/zip', methods=['GET'])
@token_required
def download_documents_zip(current_user, id):
    chantier = Chantier.query.get_or_404(id)
    category = request.args.get('category', 'all')

    if chantier.archived:
        if not chantier.archive_zip_path:
            return jsonify({'error': 'Archive introuvable'}), 404
        path = os.path.join(app.config['ARCHIVE_FOLDER'], chantier.archive_zip_path)
        return send_file(path, as_attachment=True, download_name=f"{chantier.nom}_archive.zip")

    query = Document.query.filter_by(chantier_id=id)
    if category != 'all':
        if category not in DOCUMENT_CATEGORIES:
            return jsonify({'error': 'Invalid category'}), 400
        query = query.filter_by(category=category)
    docs = query.all()
    if not docs:
        return jsonify({'error': 'Aucun document'}), 404

    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.zip')
    os.close(tmp_fd)
    with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for doc in docs:
            disk_path = document_disk_path(doc)
            if os.path.isfile(disk_path):
                zf.write(disk_path, f"{CATEGORY_FOLDERS[doc.category]}/{doc.original_filename}")

    @after_this_request
    def cleanup(response):
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return response

    label = category if category != 'all' else 'complet'
    return send_file(tmp_path, as_attachment=True, download_name=f"{chantier.nom}_{label}.zip")

@app.route('/api/chantiers/<int:chantier_id>/members', methods=['POST', 'DELETE'])
@token_required
def manage_chantier_members(current_user, chantier_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    chantier = db.session.get(Chantier, chantier_id)
    if not chantier:
        return jsonify({'error': 'Chantier not found'}), 404
        
    data = request.json
    user_id = data.get('user_id')
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    if request.method == 'POST':
        if user not in chantier.members:
            chantier.members.append(user)
            db.session.commit()
        return jsonify(chantier.to_dict())
        
    if request.method == 'DELETE':
        if user in chantier.members:
            chantier.members.remove(user)
            db.session.commit()
        return jsonify(chantier.to_dict())


@app.route('/api/chantiers/<int:chantier_id>/entries', methods=['GET'])
@token_required
def get_chantier_entries(current_user, chantier_id):
    # Everyone can see all entries for a chantier
    entries = Entry.query.filter_by(chantier_id=chantier_id).all()
    return jsonify([e.to_dict() for e in entries])

@app.route('/api/entries', methods=['POST'])
@token_required
def add_entry(current_user):
    data = request.json or {}

    # Seul un admin peut créer une entrée pour un autre user
    target_user_id = data.get('user_id', current_user.id)
    if target_user_id != current_user.id and current_user.role != 'admin':
        return jsonify({'error': 'Cannot create entry for another user'}), 403

    chantier_id = data.get('chantier_id')
    date = data.get('date')
    if not chantier_id or not date:
        return jsonify({'error': 'chantier_id and date are required'}), 400
    if not db.session.get(Chantier, chantier_id):
        return jsonify({'error': 'Chantier not found'}), 404

    try:
        heures = float(data.get('heures', 0))
        materiel = float(data.get('materiel', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'heures/materiel must be numbers'}), 400
    if heures < 0 or materiel < 0:
        return jsonify({'error': 'heures/materiel cannot be negative'}), 400

    # Offline-queued submissions (see frontend offlineQueue.ts) carry a
    # client-generated ref — if a retry's earlier attempt actually succeeded
    # but its response got lost (dropped connection), this recognizes it as
    # already-done instead of creating a duplicate entry.
    client_ref = data.get('client_ref')
    if client_ref:
        existing = Entry.query.filter_by(client_ref=client_ref).first()
        if existing:
            return jsonify(existing.to_dict()), 200

    new_entry = Entry(
        user_id=target_user_id,
        chantier_id=chantier_id,
        date=date,
        heures=heures,
        materiel=materiel,
        status='PENDING',
        created_by_id=data.get('created_by_id', current_user.id),
        client_ref=client_ref
    )
    db.session.add(new_entry)
    db.session.commit()

    if target_user_id != current_user.id:
        target_user = db.session.get(User, target_user_id)
        chantier = db.session.get(Chantier, chantier_id)
        audit_log('entries', current_user,
                   f"created entry #{new_entry.id} on behalf of {target_user.username if target_user else target_user_id} "
                   f"(chantier {chantier.nom if chantier else chantier_id}, date {date}, heures {heures})")

    return jsonify(new_entry.to_dict()), 201

@app.route('/api/entries/pending', methods=['GET'])
@token_required
def get_pending_entries(current_user):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    entries = Entry.query.filter_by(status='PENDING').all()
    return jsonify([e.to_dict() for e in entries])

@app.route('/api/entries/<int:entry_id>/validate', methods=['PUT'])
@token_required
def validate_entry(current_user, entry_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404
    entry.status = 'VALIDATED'
    db.session.commit()
    audit_log('entries', current_user,
               f"validated entry #{entry.id} ({entry.user.username}, chantier {entry.chantier.nom if entry.chantier else entry.chantier_id}, "
               f"date {entry.date}, {entry.heures}h)")
    return jsonify(entry.to_dict())

@app.route('/api/entries/<int:entry_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_entry(current_user, entry_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    if request.method == 'DELETE':
        audit_log('entries', current_user,
                   f"deleted/rejected entry #{entry.id} ({entry.user.username}, chantier {entry.chantier.nom if entry.chantier else entry.chantier_id}, "
                   f"date {entry.date}, {entry.heures}h, materiel {entry.materiel})")
        db.session.delete(entry)
        db.session.commit()
        return jsonify({'message': 'Entry deleted'})

    if request.method == 'PUT':
        data = request.json or {}
        try:
            heures = float(data.get('heures', entry.heures))
            materiel = float(data.get('materiel', entry.materiel))
        except (TypeError, ValueError):
            return jsonify({'error': 'heures/materiel must be numbers'}), 400
        if heures < 0 or materiel < 0:
            return jsonify({'error': 'heures/materiel cannot be negative'}), 400

        # Admin can reassign an entry to a different user (e.g. it was logged
        # under the wrong name).
        new_user_id = data.get('user_id')
        old_user = entry.user
        reassigned_to = None
        if new_user_id is not None and int(new_user_id) != entry.user_id:
            new_user = db.session.get(User, int(new_user_id))
            if not new_user:
                return jsonify({'error': 'User not found'}), 404
            reassigned_to = new_user
            entry.user_id = new_user.id

        changes = []
        if heures != entry.heures:
            changes.append(f'heures {entry.heures} -> {heures}')
        if materiel != entry.materiel:
            changes.append(f'materiel {entry.materiel} -> {materiel}')
        if reassigned_to:
            changes.append(f'user {old_user.username} -> {reassigned_to.username}')

        entry.heures = heures
        entry.materiel = materiel
        if 'status' in data:
            if data['status'] != entry.status:
                changes.append(f"status {entry.status} -> {data['status']}")
            entry.status = data['status']
        if 'admin_note' in data:
            entry.admin_note = data['admin_note']

        db.session.commit()

        if changes:
            audit_log('entries', current_user,
                       f"edited entry #{entry.id} (chantier {entry.chantier.nom if entry.chantier else entry.chantier_id}, date {entry.date}): "
                       + '; '.join(changes))

        return jsonify(entry.to_dict())

def compute_days_count(date_start, date_end):
    """Calendar-day count, inclusive, computed server-side (never trust client input)."""
    start = datetime.datetime.strptime(date_start, "%Y-%m-%d").date()
    end = datetime.datetime.strptime(date_end, "%Y-%m-%d").date()
    if end < start:
        raise ValueError("date_end is before date_start")
    return float((end - start).days + 1)

@app.route('/api/leaves', methods=['GET', 'POST'])
@token_required
def manage_leaves(current_user):
    if request.method == 'GET':
        user_id = request.args.get('user_id')
        if user_id:
             leaves = Leave.query.filter_by(user_id=user_id).all()
        else:
             leaves = Leave.query.all() # Admin sees all
        return jsonify([l.to_dict() for l in leaves])

    if request.method == 'POST':
        data = request.json or {}

        target_user_id = data.get('user_id', current_user.id)
        # Same rule as entries: only admin can file a leave request for someone else.
        if target_user_id != current_user.id and current_user.role != 'admin':
            return jsonify({'error': 'Cannot create a leave request for another user'}), 403
        if not db.session.get(User, target_user_id):
            return jsonify({'error': 'User not found'}), 404

        leave_type = data.get('type')
        if leave_type not in ['VACATION', 'SICKNESS', 'OTHER']:
            return jsonify({'error': 'Invalid type'}), 400

        try:
            days_count = compute_days_count(data['date_start'], data['date_end'])
        except (KeyError, ValueError) as e:
            return jsonify({'error': f'Invalid dates: {e}'}), 400

        new_leave = Leave(
            user_id=target_user_id,
            type=leave_type,
            date_start=data['date_start'],
            date_end=data['date_end'],
            days_count=days_count,
            status='PENDING'
        )
        db.session.add(new_leave)
        db.session.commit()
        return jsonify(new_leave.to_dict()), 201

@app.route('/api/leaves/<int:leave_id>/status', methods=['PUT'])
@token_required
def update_leave_status(current_user, leave_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    leave = Leave.query.get(leave_id)
    if not leave:
        return jsonify({'error': 'Leave not found'}), 404
        
    data = request.json
    status = data.get('status')
    if status not in ['APPROVED', 'REJECTED', 'PENDING']:
        return jsonify({'error': 'Invalid status'}), 400
        
    leave.status = status
    
    # Logic: Deduct balance if approved?
    if status == 'APPROVED' and leave.type == 'VACATION':
        # Deduct from user balance
        user = db.session.get(User, leave.user_id)
        if user:
             # Logic to calculate days should be robust, here relying on frontend/data
             user.vacation_balance -= leave.days_count
             
    db.session.commit()
    return jsonify(leave.to_dict())

@app.route('/api/leaves/<int:leave_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_single_leave(current_user, leave_id):
    leave = Leave.query.get(leave_id)
    if not leave:
        return jsonify({'error': 'Leave not found'}), 404

    is_admin = current_user.role == 'admin'
    is_owner = leave.user_id == current_user.id

    # Only admin, or the owner while the request is still PENDING, may touch it.
    # Approving/rejecting stays exclusive to PUT /api/leaves/<id>/status.
    if not is_admin and not (is_owner and leave.status == 'PENDING'):
        return jsonify({'error': 'Admin access required'}), 403

    if request.method == 'DELETE':
        db.session.delete(leave)
        db.session.commit()
        return jsonify({'message': 'Leave deleted'})

    if request.method == 'PUT':
        data = request.json or {}
        if 'type' in data:
            if data['type'] not in ['VACATION', 'SICKNESS', 'OTHER']:
                return jsonify({'error': 'Invalid type'}), 400
            leave.type = data['type']
        if 'date_start' in data:
            leave.date_start = data['date_start']
        if 'date_end' in data:
            leave.date_end = data['date_end']
        # Only admin can attach an admin note or change status from here.
        if is_admin and 'admin_note' in data:
            leave.admin_note = data['admin_note']
        if is_admin and 'status' in data:
            leave.status = data['status']
        # days_count is always recomputed server-side from the (possibly just
        # updated) dates — never trust a client-supplied value here.
        try:
            leave.days_count = compute_days_count(leave.date_start, leave.date_end)
        except ValueError as e:
            return jsonify({'error': f'Invalid dates: {e}'}), 400

        db.session.commit()
        return jsonify(leave.to_dict())

@app.route('/api/chantiers/<int:chantier_id>/alerts', methods=['GET', 'POST'])
@token_required
def manage_alerts(current_user, chantier_id):
    if request.method == 'GET':
        alerts = Alert.query.filter_by(chantier_id=chantier_id).all()
        return jsonify([a.to_dict() for a in alerts])

    if request.method == 'POST':
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        if not db.session.get(Chantier, chantier_id):
            return jsonify({'error': 'Chantier not found'}), 404
        data = request.json or {}
        if not (data.get('title') or '').strip():
            return jsonify({'error': 'Title is required'}), 400
        new_alert = Alert(
            chantier_id=chantier_id,
            title=data['title'],
            description=data.get('description'),
            due_date=data.get('due_date'),
            is_resolved=False
        )
        db.session.add(new_alert)
        db.session.commit()
        return jsonify(new_alert.to_dict()), 201

@app.route('/api/alerts/<int:alert_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_single_alert(current_user, alert_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    alert = Alert.query.get(alert_id)
    if not alert:
         return jsonify({'error': 'Alert not found'}), 404
         
    if request.method == 'DELETE':
        db.session.delete(alert)
        db.session.commit()
        return jsonify({'message': 'Alert deleted'})
        
    if request.method == 'PUT':
        data = request.json
        alert.is_resolved = data.get('is_resolved', alert.is_resolved)
        db.session.commit()
        return jsonify(alert.to_dict())

# --- Annonces admin (bandeau "au prochain login") ---

@app.route('/api/notices', methods=['GET', 'POST'])
@token_required
def manage_notices(current_user):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    if request.method == 'GET':
        notices = AdminNotice.query.order_by(AdminNotice.created_at.desc()).all()
        return jsonify([n.to_dict() for n in notices])

    if request.method == 'POST':
        data = request.json or {}
        message = (data.get('message') or '').strip()
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        date_start = data.get('date_start') or datetime.datetime.now().strftime('%Y-%m-%d')
        try:
            datetime.datetime.strptime(date_start, "%Y-%m-%d")
        except ValueError:
            return jsonify({'error': 'date_start must be YYYY-MM-DD'}), 400
        try:
            duration_days = int(data.get('duration_days', 7))
        except (TypeError, ValueError):
            return jsonify({'error': 'duration_days must be an integer'}), 400
        if duration_days < 1:
            return jsonify({'error': 'duration_days must be at least 1'}), 400

        notice = AdminNotice(
            message=message,
            date_start=date_start,
            duration_days=duration_days,
            created_by_id=current_user.id,
        )
        db.session.add(notice)
        db.session.commit()
        audit_log('notices', current_user, f"created notice #{notice.id}: \"{message[:80]}\" (from {date_start}, {duration_days}j)")
        return jsonify(notice.to_dict()), 201


@app.route('/api/notices/<int:notice_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_single_notice(current_user, notice_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    notice = db.session.get(AdminNotice, notice_id)
    if not notice:
        return jsonify({'error': 'Notice not found'}), 404

    if request.method == 'DELETE':
        NoticeAck.query.filter_by(notice_id=notice.id).delete()
        db.session.delete(notice)
        db.session.commit()
        audit_log('notices', current_user, f"deleted notice #{notice_id}")
        return jsonify({'message': 'Notice deleted'})

    if request.method == 'PUT':
        data = request.json or {}
        if 'message' in data:
            notice.message = data['message'].strip()
        if 'date_start' in data:
            notice.date_start = data['date_start']
        if 'duration_days' in data:
            notice.duration_days = int(data['duration_days'])
        if 'active' in data:
            notice.active = bool(data['active'])
        db.session.commit()
        audit_log('notices', current_user, f"edited notice #{notice.id}")
        return jsonify(notice.to_dict())


@app.route('/api/notices/active', methods=['GET'])
@token_required
def get_active_notices(current_user):
    """Notices currently in their display window, active, and not yet
    acknowledged by the calling user — what the app checks on open."""
    today_str = datetime.datetime.now().strftime('%Y-%m-%d')
    acked_ids = {a.notice_id for a in NoticeAck.query.filter_by(user_id=current_user.id).all()}
    notices = AdminNotice.query.filter_by(active=True).all()
    pending = [n for n in notices if n.id not in acked_ids and n.is_in_window(today_str)]
    pending.sort(key=lambda n: n.created_at or datetime.datetime.min)
    return jsonify([n.to_dict() for n in pending])


@app.route('/api/notices/<int:notice_id>/ack', methods=['POST'])
@token_required
def ack_notice(current_user, notice_id):
    if not db.session.get(AdminNotice, notice_id):
        return jsonify({'error': 'Notice not found'}), 404
    if not NoticeAck.query.filter_by(notice_id=notice_id, user_id=current_user.id).first():
        db.session.add(NoticeAck(notice_id=notice_id, user_id=current_user.id))
        db.session.commit()
    return jsonify({'message': 'ok'})

# --- Module financier ---
# Admin-only across the board — margins/costs are the most sensitive business
# data in the app (same tier as the old plan/devis contractual documents).

def _parse_amount(data, key, required, default=0.0):
    """Pull a numeric field out of a request body: required -> 400 if absent,
    optional -> falls back to `default`. Either way, rejects non-numbers and
    negatives (400) rather than letting a bad value hit the DB."""
    if key not in data or data.get(key) is None:
        if required:
            return None, (jsonify({'error': f'{key} is required'}), 400)
        return default, None
    try:
        value = float(data[key])
    except (TypeError, ValueError):
        return None, (jsonify({'error': f'{key} must be a number'}), 400)
    if value < 0:
        return None, (jsonify({'error': f'{key} cannot be negative'}), 400)
    return value, None

def _parse_iso_date(data, key, required):
    if key not in data or not data.get(key):
        if required:
            return None, (jsonify({'error': f'{key} is required'}), 400)
        return None, None
    try:
        datetime.date.fromisoformat(data[key])
    except (TypeError, ValueError):
        return None, (jsonify({'error': f'{key} must be an ISO date (YYYY-MM-DD)'}), 400)
    return data[key], None

def sync_petites_fournitures(chantier_id, financier):
    """Keep the one estimation_petites_fournitures achat row in sync with
    charge_materiel_prevue * pct_petites_fournitures (réf. Excel G19=C26*D19).
    Creates it on first use, otherwise just updates the amount — never touched
    by the achats CRUD routes directly."""
    row = AchatMateriel.query.filter_by(chantier_id=chantier_id, type='estimation_petites_fournitures').first()
    montant = financier.charge_materiel_prevue * financier.pct_petites_fournitures
    if row:
        row.montant = montant
    else:
        db.session.add(AchatMateriel(
            chantier_id=chantier_id,
            libelle='Petites fournitures (estimation automatique)',
            montant=montant,
            type='estimation_petites_fournitures',
        ))
    db.session.commit()

def _financier_payload(chantier_id):
    """Shared by GET and PUT /financier — the full prévisionnel/réel/écart
    structure, ready to render with no client-side recomputation."""
    financier = ChantierFinancier.query.filter_by(chantier_id=chantier_id).first()
    ca_lignes = CaLignePrevue.query.filter_by(chantier_id=chantier_id).order_by(CaLignePrevue.id).all()
    acomptes = Acompte.query.filter_by(chantier_id=chantier_id).order_by(Acompte.date.desc()).all()
    achats = AchatMateriel.query.filter_by(chantier_id=chantier_id).all()
    payload = {
        'chantier_id': chantier_id,
        'financier': financier.to_dict() if financier else None,
        'ca_lignes': [l.to_dict() for l in ca_lignes],
        'acomptes': [a.to_dict() for a in acomptes],
        'achats': [a.to_dict() for a in achats],
    }
    if financier:
        heures_reelles = db.session.query(func.coalesce(func.sum(Entry.heures), 0.0)).filter(
            Entry.chantier_id == chantier_id
        ).scalar()
        payload.update(compute_financier(
            ca_lignes_montants=[l.montant for l in ca_lignes],
            ca_lignes_heures=[l.heures for l in ca_lignes],
            charge_materiel_prevue=financier.charge_materiel_prevue,
            taux_horaire=financier.taux_horaire,
            acomptes_montants=[a.montant for a in acomptes],
            achats_montants=[a.montant for a in achats],
            heures_reelles=heures_reelles,
        ))
    return payload

@app.route('/api/chantiers/<int:chantier_id>/financier', methods=['GET', 'PUT'])
@token_required
def manage_financier(current_user, chantier_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    if not db.session.get(Chantier, chantier_id):
        return jsonify({'error': 'Chantier not found'}), 404

    if request.method == 'GET':
        return jsonify(_financier_payload(chantier_id))

    # PUT — upsert: first call creates the prévisionnel, later calls update it.
    # Le CA prévisionnel n'est plus ici (voir /ca_lignes) — il ne reste que le
    # matériel/taux horaire, donc plus aucun champ n'est obligatoire : un
    # prévisionnel peut se créer "vide" puis se remplir via les lignes CA.
    data = request.json or {}
    financier = ChantierFinancier.query.filter_by(chantier_id=chantier_id).first()

    charge_materiel_prevue, err = _parse_amount(data, 'charge_materiel_prevue', required=False, default=financier.charge_materiel_prevue if financier else 0.0)
    if err: return err
    taux_horaire, err = _parse_amount(data, 'taux_horaire', required=False, default=financier.taux_horaire if financier else 0.0)
    if err: return err
    pct_petites_fournitures, err = _parse_amount(data, 'pct_petites_fournitures', required=False, default=financier.pct_petites_fournitures if financier else 0.0)
    if err: return err

    materiel_or_pct_changed = financier is None or (
        financier.charge_materiel_prevue != charge_materiel_prevue
        or financier.pct_petites_fournitures != pct_petites_fournitures
    )

    if not financier:
        financier = ChantierFinancier(chantier_id=chantier_id)
        db.session.add(financier)

    financier.charge_materiel_prevue = charge_materiel_prevue
    financier.taux_horaire = taux_horaire
    financier.pct_petites_fournitures = pct_petites_fournitures
    db.session.commit()

    if materiel_or_pct_changed:
        sync_petites_fournitures(chantier_id, financier)

    return jsonify(_financier_payload(chantier_id))

@app.route('/api/chantiers/<int:chantier_id>/ca_lignes', methods=['POST'])
@token_required
def create_ca_ligne(current_user, chantier_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    if not db.session.get(Chantier, chantier_id):
        return jsonify({'error': 'Chantier not found'}), 404
    if not ChantierFinancier.query.filter_by(chantier_id=chantier_id).first():
        return jsonify({'error': 'Configurez le prévisionnel avant d\'ajouter une ligne de CA'}), 409

    data = request.json or {}
    if not (data.get('libelle') or '').strip():
        return jsonify({'error': 'libelle is required'}), 400
    montant, err = _parse_amount(data, 'montant', required=True)
    if err: return err
    heures, err = _parse_amount(data, 'heures', required=False, default=0.0)
    if err: return err

    ligne = CaLignePrevue(chantier_id=chantier_id, libelle=data['libelle'].strip(), montant=montant, heures=heures)
    db.session.add(ligne)
    db.session.commit()
    return jsonify(ligne.to_dict()), 201

@app.route('/api/chantiers/<int:chantier_id>/ca_lignes/<int:ligne_id>', methods=['PUT', 'DELETE'])
@token_required
def ca_ligne_detail(current_user, chantier_id, ligne_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    ligne = CaLignePrevue.query.filter_by(id=ligne_id, chantier_id=chantier_id).first()
    if not ligne:
        return jsonify({'error': 'Ligne not found'}), 404

    if request.method == 'DELETE':
        db.session.delete(ligne)
        db.session.commit()
        return jsonify({'message': 'Ligne deleted'})

    data = request.json or {}
    if 'libelle' in data:
        if not (data.get('libelle') or '').strip():
            return jsonify({'error': 'libelle cannot be empty'}), 400
        ligne.libelle = data['libelle'].strip()
    if 'montant' in data:
        montant, err = _parse_amount(data, 'montant', required=True)
        if err: return err
        ligne.montant = montant
    if 'heures' in data:
        heures, err = _parse_amount(data, 'heures', required=True)
        if err: return err
        ligne.heures = heures
    db.session.commit()
    return jsonify(ligne.to_dict())

@app.route('/api/chantiers/<int:chantier_id>/acomptes', methods=['POST'])
@token_required
def create_acompte(current_user, chantier_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    if not db.session.get(Chantier, chantier_id):
        return jsonify({'error': 'Chantier not found'}), 404

    data = request.json or {}
    if not (data.get('libelle') or '').strip():
        return jsonify({'error': 'libelle is required'}), 400
    montant, err = _parse_amount(data, 'montant', required=True)
    if err: return err
    heures, err = _parse_amount(data, 'heures', required=False, default=0.0)
    if err: return err
    date, err = _parse_iso_date(data, 'date', required=True)
    if err: return err

    acompte = Acompte(chantier_id=chantier_id, libelle=data['libelle'].strip(), montant=montant, heures=heures, date=date)
    db.session.add(acompte)
    db.session.commit()
    return jsonify(acompte.to_dict()), 201

@app.route('/api/chantiers/<int:chantier_id>/acomptes/<int:acompte_id>', methods=['PUT', 'DELETE'])
@token_required
def acompte_detail(current_user, chantier_id, acompte_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    acompte = Acompte.query.filter_by(id=acompte_id, chantier_id=chantier_id).first()
    if not acompte:
        return jsonify({'error': 'Acompte not found'}), 404

    if request.method == 'DELETE':
        db.session.delete(acompte)
        db.session.commit()
        return jsonify({'message': 'Acompte deleted'})

    data = request.json or {}
    if 'libelle' in data:
        if not (data.get('libelle') or '').strip():
            return jsonify({'error': 'libelle cannot be empty'}), 400
        acompte.libelle = data['libelle'].strip()
    if 'montant' in data:
        montant, err = _parse_amount(data, 'montant', required=True)
        if err: return err
        acompte.montant = montant
    if 'heures' in data:
        heures, err = _parse_amount(data, 'heures', required=True)
        if err: return err
        acompte.heures = heures
    if 'date' in data:
        date, err = _parse_iso_date(data, 'date', required=True)
        if err: return err
        acompte.date = date
    db.session.commit()
    return jsonify(acompte.to_dict())

@app.route('/api/chantiers/<int:chantier_id>/achats', methods=['POST'])
@token_required
def create_achat(current_user, chantier_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    if not db.session.get(Chantier, chantier_id):
        return jsonify({'error': 'Chantier not found'}), 404

    data = request.json or {}
    requested_type = data.get('type', 'facture')
    if requested_type == 'estimation_petites_fournitures':
        return jsonify({'error': "La ligne 'estimation_petites_fournitures' est calculée automatiquement, elle ne peut pas être créée manuellement"}), 400
    if requested_type not in ACHAT_TYPES:
        return jsonify({'error': f'type must be one of {ACHAT_TYPES}'}), 400
    if not (data.get('libelle') or '').strip():
        return jsonify({'error': 'libelle is required'}), 400
    montant, err = _parse_amount(data, 'montant', required=True)
    if err: return err
    date, err = _parse_iso_date(data, 'date', required=False)
    if err: return err

    achat = AchatMateriel(chantier_id=chantier_id, libelle=data['libelle'].strip(), montant=montant, date=date, type=requested_type)
    db.session.add(achat)
    db.session.commit()
    return jsonify(achat.to_dict()), 201

@app.route('/api/chantiers/<int:chantier_id>/achats/<int:achat_id>', methods=['PUT', 'DELETE'])
@token_required
def achat_detail(current_user, chantier_id, achat_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    achat = AchatMateriel.query.filter_by(id=achat_id, chantier_id=chantier_id).first()
    if not achat:
        return jsonify({'error': 'Achat not found'}), 404
    if achat.type == 'estimation_petites_fournitures':
        return jsonify({'error': "La ligne 'estimation_petites_fournitures' est gérée automatiquement (modifiable uniquement via charge_materiel_prevue / pct_petites_fournitures)"}), 400

    if request.method == 'DELETE':
        db.session.delete(achat)
        db.session.commit()
        return jsonify({'message': 'Achat deleted'})

    data = request.json or {}
    if 'libelle' in data:
        if not (data.get('libelle') or '').strip():
            return jsonify({'error': 'libelle cannot be empty'}), 400
        achat.libelle = data['libelle'].strip()
    if 'montant' in data:
        montant, err = _parse_amount(data, 'montant', required=True)
        if err: return err
        achat.montant = montant
    if 'date' in data:
        date, err = _parse_iso_date(data, 'date', required=False)
        if err: return err
        achat.date = date
    db.session.commit()
    return jsonify(achat.to_dict())

PREVISION_STATUTS = ('prevu', 'confirme')

def _prevision_validate_body(data, existing=None):
    """Shared validation for POST/PUT on /api/prevision. `existing` is the
    ChantierPrevision being updated (None on create) — used only to fall back
    to its current values for fields not present in a partial PUT payload.
    Returns (fields_dict, error_response_or_None)."""
    fields = {}

    if 'nom' in data or existing is None:
        nom = (data.get('nom') or '').strip()
        if not nom:
            return None, (jsonify({'error': 'nom is required'}), 400)
        fields['nom'] = nom

    if 'statut' in data or existing is None:
        statut = data.get('statut', 'prevu')
        if statut not in PREVISION_STATUTS:
            return None, (jsonify({'error': f"statut must be one of {PREVISION_STATUTS}"}), 400)
        fields['statut'] = statut

    if 'referent_id' in data:
        referent_id = data.get('referent_id')
        if referent_id is not None:
            if not db.session.get(User, referent_id):
                return None, (jsonify({'error': 'referent_id does not reference an existing user'}), 400)
        fields['referent_id'] = referent_id

    if 'chantier_id' in data:
        chantier_id = data.get('chantier_id')
        if chantier_id is not None:
            if not db.session.get(Chantier, chantier_id):
                return None, (jsonify({'error': 'chantier_id does not reference an existing chantier'}), 400)
        fields['chantier_id'] = chantier_id

    if 'montant_estime' in data:
        montant_estime, err = _parse_amount(data, 'montant_estime', required=False, default=None)
        if err: return None, err
        fields['montant_estime'] = montant_estime

    if 'date_debut_theorique' in data:
        date_debut, err = _parse_iso_date(data, 'date_debut_theorique', required=False)
        if err: return None, err
        fields['date_debut_theorique'] = date_debut

    if 'date_fin_theorique' in data:
        date_fin, err = _parse_iso_date(data, 'date_fin_theorique', required=False)
        if err: return None, err
        fields['date_fin_theorique'] = date_fin

    debut = fields.get('date_debut_theorique', existing.date_debut_theorique if existing else None)
    fin = fields.get('date_fin_theorique', existing.date_fin_theorique if existing else None)
    if debut and fin and debut > fin:
        return None, (jsonify({'error': 'date_debut_theorique must be before or equal to date_fin_theorique'}), 400)

    return fields, None

@app.route('/api/prevision', methods=['GET', 'POST'])
@token_required
def manage_prevision(current_user):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    if request.method == 'GET':
        query = ChantierPrevision.query
        statut = request.args.get('statut')
        if statut:
            if statut not in PREVISION_STATUTS:
                return jsonify({'error': f"statut must be one of {PREVISION_STATUTS}"}), 400
            query = query.filter(ChantierPrevision.statut == statut)
        annee = request.args.get('annee')
        if annee:
            # Une prévision "concerne" l'année si sa plage théorique la touche —
            # simple préfixe sur les dates ISO stockées en texte (YYYY-MM-DD).
            query = query.filter(
                db.or_(
                    ChantierPrevision.date_debut_theorique.like(f'{annee}%'),
                    ChantierPrevision.date_fin_theorique.like(f'{annee}%'),
                )
            )
        items = query.order_by(ChantierPrevision.date_debut_theorique.is_(None), ChantierPrevision.date_debut_theorique).all()
        return jsonify([p.to_dict() for p in items])

    # POST — always creates a fresh prévision, statut defaults to 'prevu'
    # (an explicit statut='confirme' + chantier_id can still be posted
    # directly, e.g. a manual link, but /api/prevision/import is the normal
    # way real chantiers get in here).
    data = request.json or {}
    fields, err = _prevision_validate_body(data, existing=None)
    if err: return err

    prevision = ChantierPrevision(
        nom=fields['nom'],
        statut=fields.get('statut', 'prevu'),
        referent_id=fields.get('referent_id'),
        chantier_id=fields.get('chantier_id'),
        montant_estime=fields.get('montant_estime'),
        date_debut_theorique=fields.get('date_debut_theorique'),
        date_fin_theorique=fields.get('date_fin_theorique'),
    )
    db.session.add(prevision)
    db.session.commit()
    return jsonify(prevision.to_dict()), 201

@app.route('/api/prevision/<int:prevision_id>', methods=['GET', 'PUT', 'DELETE'])
@token_required
def prevision_detail(current_user, prevision_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    prevision = db.session.get(ChantierPrevision, prevision_id)
    if not prevision:
        return jsonify({'error': 'Prevision not found'}), 404

    if request.method == 'GET':
        return jsonify(prevision.to_dict())

    if request.method == 'DELETE':
        db.session.delete(prevision)
        db.session.commit()
        return jsonify({'message': 'Prevision deleted'})

    # PUT — partial update, only fields present in the payload are touched.
    data = request.json or {}
    fields, err = _prevision_validate_body(data, existing=prevision)
    if err: return err
    for key, value in fields.items():
        setattr(prevision, key, value)
    db.session.commit()
    return jsonify(prevision.to_dict())

@app.route('/api/prevision/import', methods=['POST'])
@token_required
def import_prevision(current_user):
    """Read-only import of real chantiers into the prévision calendar, as
    statut='confirme'. NEVER writes to `chantiers` or any other table outside
    chantiers_prevision — only reads Chantier.date_start/date_end here.

    Note (base main @ this branch's fork point): there is no chantier_assignments
    table / Agenda module yet in this codebase (it lives in a separate,
    unmerged branch) — theoretical dates are sourced from the chantier's own
    date_start/date_end fields instead, staying empty when those are unset.
    If/when an Agenda module with confirmed assignments lands, this is the
    one place to extend (still read-only) to prefer assignment-derived dates.

    Idempotent: a chantier already linked to a chantiers_prevision row
    (chantier_id set) is left untouched — re-running the import only picks up
    chantiers that aren't in the prévision calendar yet, so it never clobbers
    dates a user has since edited by hand."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    already_imported_ids = {
        row.chantier_id for row in ChantierPrevision.query.filter(ChantierPrevision.chantier_id.isnot(None)).all()
    }
    to_import = Chantier.query.filter(~Chantier.id.in_(already_imported_ids)).all() if already_imported_ids else Chantier.query.all()

    created = []
    for chantier in to_import:
        prevision = ChantierPrevision(
            nom=chantier.nom,
            statut='confirme',
            chantier_id=chantier.id,
            date_debut_theorique=chantier.date_start,
            date_fin_theorique=chantier.date_end,
        )
        db.session.add(prevision)
        created.append(prevision)
    db.session.commit()

    return jsonify({
        'created_count': len(created),
        'already_imported_count': len(already_imported_ids),
        'created': [p.to_dict() for p in created],
    }), 200

def csv_safe(value):
    """Neutralize CSV/formula injection: Excel/Sheets execute a cell starting
    with =, +, -, @, tab or CR as a formula when the file is opened. Any of
    those fields here (chantier name, username) is admin/employee-controlled
    input, so prefix with a literal apostrophe to force text interpretation."""
    s = str(value)
    if s and s[0] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + s
    return s

@app.route('/api/export', methods=['GET'])
@token_required
def export_data(current_user):
    # Export entries to CSV
    import csv
    import io
    from flask import make_response
    
    chantier_id = request.args.get('chantier_id')
    year = request.args.get('year')
    semester = request.args.get('semester') # S1, S2
    
    query = Entry.query
    
    if chantier_id:
        query = query.filter_by(chantier_id=chantier_id)
        
    entries = query.all()
    
    # Filter in Python for simplicity with string dates
    filtered_entries = []
    for e in entries:
        include = True
        
        # Date format YYYY-MM-DD
        if year:
            if not e.date.startswith(str(year)):
                include = False
                
        if semester and include:
            try:
                month = int(e.date.split('-')[1])
                if semester == 'S1':
                    if month > 6: include = False
                elif semester == 'S2':
                    if month <= 6: include = False
            except:
                pass # potentially malformed date
                
        if include:
            filtered_entries.append(e)
    
    # Create CSV in memory
    si = io.StringIO()
    cw = csv.writer(si)
    # Headers
    cw.writerow(['ID', 'Date', 'Chantier', 'Ouvrier', 'Heures', 'Materiel', 'Statut'])
    
    for e in filtered_entries:
        cw.writerow([
            e.id,
            e.date,
            csv_safe(e.chantier.nom if e.chantier else 'Supprimé'),
            csv_safe(e.user.username if e.user else 'Inconnu'),
            e.heures,
            e.materiel,
            e.status
        ])
    
    output = make_response(si.getvalue())
    
    # Filename construction
    parts = ["export"]
    if chantier_id: parts.append(f"chantier_{chantier_id}")
    else: parts.append("global")
    
    if year: parts.append(str(year))
    if semester: parts.append(semester)
    
    filename = "_".join(parts) + ".csv"
    
    output.headers["Content-Disposition"] = f"attachment; filename={filename}"
    output.headers["Content-type"] = "text/csv"
    return output

@app.route('/api/stats', methods=['GET'])
@token_required
def get_stats(current_user):
    from sqlalchemy import func
    from datetime import datetime, timedelta
    from collections import defaultdict
    
    total_entries = db.session.query(func.count(Entry.id)).scalar() or 0
    total_hours = db.session.query(func.sum(Entry.heures)).scalar() or 0
    total_material = db.session.query(func.sum(Entry.materiel)).scalar() or 0
    
    # Active chantiers count
    active_chantiers = db.session.query(func.count(Chantier.id)).filter(Chantier.status == 'ACTIVE').scalar() or 0
    
    # History Processing (Last 12 Months)
    entries = Entry.query.all()
    
    # Group by Month and Year for Comparison
    monthly_data = defaultdict(lambda: {'hours': 0, 'material': 0})
    current_year = datetime.now().year
    last_year = current_year - 1
    
    total_hours_curr = 0
    total_hours_last = 0
    total_mat_curr = 0
    total_mat_last = 0

    for e in entries:
        try:
            # Assumes e.date is YYYY-MM-DD
            year = int(e.date[:4])
            month_key = e.date[:7] # YYYY-MM
            
            monthly_data[month_key]['hours'] += e.heures
            monthly_data[month_key]['material'] += e.materiel
            
            if year == current_year:
                total_hours_curr += e.heures
                total_mat_curr += e.materiel
            elif year == last_year:
                total_hours_last += e.heures
                total_mat_last += e.materiel
        except:
            continue
            
    # Format for Frontend (Sorted keys)
    sorted_months = sorted(monthly_data.keys())[-12:] # Last 12 months
    
    history = []
    for m in sorted_months:
        history.append({
            'month': m,
            'hours': round(monthly_data[m]['hours'], 1),
            'material': round(monthly_data[m]['material'], 2)
        })

    # Calculate Growth
    hours_growth = 0
    if total_hours_last > 0:
        hours_growth = ((total_hours_curr - total_hours_last) / total_hours_last) * 100
        
    mat_growth = 0
    if total_mat_last > 0:
        mat_growth = ((total_mat_curr - total_mat_last) / total_mat_last) * 100

    return jsonify({
        'total_entries': total_entries,
        'total_hours': round(total_hours, 1),
        'total_material': round(total_material, 2),
        'active_chantiers': active_chantiers,
        'history': history,
        'comparison': {
            'hours_growth': round(hours_growth, 1),
            'material_growth': round(mat_growth, 1),
            'hours_curr': round(total_hours_curr, 1),
            'hours_last': round(total_hours_last, 1)
        }
    })

@app.route('/api/stats/financier', methods=['GET'])
@token_required
def get_financier_stats(current_user):
    """Vue agrégée du module financier sur tous les chantiers qui ont un
    prévisionnel configuré — alimente la page Statistiques (marge par
    chantier, avancement global, CA prévu/réel). Réutilise compute_financier()
    chantier par chantier, jamais un calcul dupliqué ici."""
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    from collections import defaultdict

    financiers = ChantierFinancier.query.all()
    if not financiers:
        return jsonify({'chantiers': [], 'totals': None})

    chantier_ids = [f.chantier_id for f in financiers]
    chantiers_by_id = {c.id: c for c in Chantier.query.filter(Chantier.id.in_(chantier_ids)).all()}

    ca_lignes_by = defaultdict(list)
    for l in CaLignePrevue.query.filter(CaLignePrevue.chantier_id.in_(chantier_ids)).all():
        ca_lignes_by[l.chantier_id].append(l)
    acomptes_by = defaultdict(list)
    for a in Acompte.query.filter(Acompte.chantier_id.in_(chantier_ids)).all():
        acomptes_by[a.chantier_id].append(a)
    achats_by = defaultdict(list)
    for a in AchatMateriel.query.filter(AchatMateriel.chantier_id.in_(chantier_ids)).all():
        achats_by[a.chantier_id].append(a)
    heures_by = dict(
        db.session.query(Entry.chantier_id, func.sum(Entry.heures))
        .filter(Entry.chantier_id.in_(chantier_ids))
        .group_by(Entry.chantier_id).all()
    )

    per_chantier = []
    for fin in financiers:
        cid = fin.chantier_id
        chantier = chantiers_by_id.get(cid)
        if not chantier:
            continue  # chantier deleted but its financier row lingered somehow
        calc = compute_financier(
            ca_lignes_montants=[l.montant for l in ca_lignes_by.get(cid, [])],
            ca_lignes_heures=[l.heures for l in ca_lignes_by.get(cid, [])],
            charge_materiel_prevue=fin.charge_materiel_prevue,
            taux_horaire=fin.taux_horaire,
            acomptes_montants=[a.montant for a in acomptes_by.get(cid, [])],
            achats_montants=[a.montant for a in achats_by.get(cid, [])],
            heures_reelles=heures_by.get(cid, 0.0),
        )
        per_chantier.append({'id': cid, 'nom': chantier.nom, 'status': chantier.status, **calc})

    def safe_div(n, d):
        return round(n / d, 4) if d else None

    def total(key):
        return round(sum(c[key] for c in per_chantier), 2)

    totals = {
        'chantiers_count': len(per_chantier),
        'chantiers_positive_marge': sum(1 for c in per_chantier if c['marge_reelle'] >= 0),
        'chantiers_negative_marge': sum(1 for c in per_chantier if c['marge_reelle'] < 0),
        'ca_prevu': total('ca_prevu'),
        'ca_reel': total('ca_reel'),
        'charge_materiel_prevue': round(sum(f.charge_materiel_prevue for f in financiers), 2),
        'total_achats_reel': total('total_achats_reel'),
        'cout_mo_prevu': total('cout_mo_prevu'),
        'cout_mo_reel': total('cout_mo_reel'),
        'debourse_sec_prevu': total('debourse_sec_prevu'),
        'debourse_sec_reel': total('debourse_sec_reel'),
        'marge_prevue': total('marge_prevue'),
        'marge_reelle': total('marge_reelle'),
    }
    # Ratios calculés sur les SOMMES (pas une moyenne des ratios par chantier)
    # — un grand chantier ne doit pas peser autant qu'un petit dans le taux global.
    totals['pct_marge_reelle'] = safe_div(totals['marge_reelle'], totals['ca_reel'])
    totals['pct_avancement_ca'] = safe_div(totals['ca_reel'], totals['ca_prevu'])
    totals['pct_avancement_materiel'] = safe_div(totals['total_achats_reel'], totals['charge_materiel_prevue'])
    totals['pct_avancement_mo'] = safe_div(totals['cout_mo_reel'], totals['cout_mo_prevu'])
    totals['pct_avancement_debourse_sec'] = safe_div(totals['debourse_sec_reel'], totals['debourse_sec_prevu'])

    per_chantier.sort(key=lambda c: c['marge_reelle'], reverse=True)
    return jsonify({'chantiers': per_chantier, 'totals': totals})

# Error handlers: never leak a raw traceback to the client, always JSON.
from sqlalchemy.exc import IntegrityError

@app.errorhandler(IntegrityError)
def handle_integrity_error(e):
    db.session.rollback()
    logger.warning(f"IntegrityError: {e}")
    return jsonify({'error': 'Invalid or inconsistent data (constraint violation)'}), 400

@app.errorhandler(500)
def handle_internal_error(e):
    db.session.rollback()
    logger.error(f"Unhandled error: {e}")
    return jsonify({'error': 'Internal server error'}), 500

# Security Headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    # img-src explicitly allows data: — the 2FA enrollment QR code is
    # rendered server-side as an inline data:image/svg+xml URI (see mfa.py),
    # which default-src 'self' alone silently blocks (no data: scheme).
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
    return response

# Initialize Database (Run migration)
init_db()

if __name__ == '__main__':
    # Fail closed: debug only turns on if FLASK_ENV is explicitly 'development'.
    # Previously this defaulted to debug=True whenever FLASK_ENV was unset/misspelled.
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('FLASK_ENV') == 'development')
