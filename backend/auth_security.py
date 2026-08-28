"""Password policy — pure logic, no Flask/SQLAlchemy dependency (same
convention as financier_calculs.py), so it's directly unit-testable.

Design choice (matches current NIST 800-63B guidance, and the reference
implementation this was ported from): length + a known-common-password
check beats arbitrary character-class rules ("must contain 1 uppercase,
1 digit, 1 symbol") — those rules push people toward predictable patterns
like "Password1!" without actually raising entropy. No outbound network
call (e.g. HaveIBeenPwned's k-anonymity API) is made with the plaintext
password — the blocklist is a local, bundled file instead.
"""
import os

MIN_LENGTH = 12

_COMMON_PASSWORDS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'common_passwords.txt')
_common_passwords_cache = None


def _load_common_passwords():
    global _common_passwords_cache
    if _common_passwords_cache is None:
        try:
            with open(_COMMON_PASSWORDS_PATH, encoding='utf-8') as f:
                _common_passwords_cache = {line.strip().lower() for line in f if line.strip()}
        except FileNotFoundError:
            _common_passwords_cache = set()
    return _common_passwords_cache


def validate_password(password):
    """Returns None if the password is acceptable, else a French error
    message describing why (shown directly to the user)."""
    if not password or len(password) < MIN_LENGTH:
        return f"Le mot de passe doit contenir au moins {MIN_LENGTH} caractères"
    if password.lower() in _load_common_passwords():
        return "Ce mot de passe est trop courant — choisissez-en un autre"
    return None
