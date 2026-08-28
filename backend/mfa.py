"""TOTP-based 2FA — secret generation/verification, QR rendering, at-rest
encryption of secrets, and one-time backup codes. Kept separate from app.py
so the crypto/encoding logic is independently testable (same convention as
financier_calculs.py).

- TOTP: pyotp (RFC 6238), ±30s clock-skew tolerance via valid_window=1.
- QR: rendered fully server-side as an SVG data URI (qrcode.image.svg) —
  the frontend just does <img src={qr_code_data_uri}>, no client-side QR
  library needed.
- Secrets are never stored in plaintext: Fernet-encrypted at rest with a
  key kept separate from the app's cookie-signing SECRET_KEY, so a leaked
  SECRET_KEY alone doesn't also expose every admin's TOTP seed.
"""
import os
import base64
import secrets as _secrets

import pyotp
import qrcode
import qrcode.image.svg
from cryptography.fernet import Fernet
from werkzeug.security import generate_password_hash, check_password_hash

TOTP_ISSUER_NAME = 'OHM-FLOW'
BACKUP_CODES_COUNT = 10

_MFA_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.mfa_key')
_fernet = None


def _get_fernet():
    """Lazily resolves the Fernet key: env var if set, else a key persisted
    to a local file (generated once on first use) — same low-ops-friction
    fallback pattern as this app's other local secrets, and deliberately a
    *different* key than SECRET_KEY (cookie signing) so the two are not
    interchangeable."""
    global _fernet
    if _fernet is not None:
        return _fernet

    key = os.environ.get('MFA_ENCRYPTION_KEY')
    if not key:
        if os.path.exists(_MFA_KEY_FILE):
            with open(_MFA_KEY_FILE, 'r', encoding='utf-8') as f:
                key = f.read().strip()
        else:
            key = Fernet.generate_key().decode('utf-8')
            with open(_MFA_KEY_FILE, 'w', encoding='utf-8') as f:
                f.write(key)

    _fernet = Fernet(key.encode('utf-8') if isinstance(key, str) else key)
    return _fernet


def generate_secret():
    """A fresh random base32 TOTP seed (pyotp's own generator — 160-bit)."""
    return pyotp.random_base32()


def encrypt_secret(secret):
    return _get_fernet().encrypt(secret.encode('utf-8')).decode('utf-8')


def decrypt_secret(encrypted):
    return _get_fernet().decrypt(encrypted.encode('utf-8')).decode('utf-8')


def provisioning_uri(secret, username):
    return pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=TOTP_ISSUER_NAME)


def verify_totp(secret, code):
    if not code or not secret:
        return False
    try:
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
    except Exception:
        return False


def qr_code_data_uri(uri):
    """Renders the otpauth:// URI as an SVG QR code, returned as a data URI
    ready for <img src=...> — no Pillow/raster dependency, no frontend QR lib."""
    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(uri, image_factory=factory)
    buf = __import__('io').BytesIO()
    img.save(buf)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return f"data:image/svg+xml;base64,{b64}"


def generate_backup_codes(count=BACKUP_CODES_COUNT):
    """Plaintext one-time recovery codes — caller is responsible for hashing
    each before storing and showing the plaintext to the user exactly once."""
    return [f"{_secrets.randbelow(10_000_000_000):010d}" for _ in range(count)]


def hash_backup_code(code):
    return generate_password_hash(code)


def verify_backup_code(code, code_hash):
    return check_password_hash(code_hash, code)
