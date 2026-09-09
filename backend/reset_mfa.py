"""Filet de secours : réinitialise la 2FA d'un compte directement en base,
sans passer par l'application — pour le cas où ce compte est le SEUL admin
et s'est retrouvé bloqué (enrôlement TOTP jamais terminé, appli
d'authentification perdue, etc.) et qu'aucun autre admin n'existe pour
utiliser /api/users/<id>/reset-mfa à sa place.

Ne touche PAS au mot de passe — seulement mfa_enabled, le secret TOTP et les
codes de récupération. Au prochain login, le compte redémarre un enrôlement
2FA propre (voir MFA_REQUIRED_ROLES / token_required dans app.py).

Usage — À LANCER DEPUIS LE WORKDIR DU CONTENEUR (/app), PAS depuis backend/ :
le chemin de la base SQLite est résolu relativement au cwd (voir
SQLALCHEMY_DATABASE_URI dans app.py) et doit être le même que celui de
gunicorn, sans quoi ce script modifierait un fichier .db différent de celui
réellement utilisé par le serveur.

    docker exec -it <nom_du_conteneur> python backend/reset_mfa.py <username>

Lister les comptes admin existants (pour retrouver le bon username) :

    docker exec -it <nom_du_conteneur> python backend/reset_mfa.py --list
"""
import sys

from app import app, db, User, MfaBackupCode, audit_log


def list_admins():
    admins = User.query.filter_by(role='admin').all()
    if not admins:
        print("Aucun compte admin en base.")
        return
    print(f"{'username':<30} {'mfa_enabled':<12} {'must_change_password'}")
    for u in admins:
        print(f"{u.username:<30} {str(u.mfa_enabled):<12} {u.must_change_password}")


def reset_mfa(username):
    user = User.query.filter_by(username=username).first()
    if not user:
        print(f"Erreur : aucun utilisateur '{username}' trouvé.")
        sys.exit(1)

    was_enabled = user.mfa_enabled
    user.mfa_enabled = False
    user.mfa_secret_enc = None
    user.mfa_pending_secret_enc = None
    user.mfa_enrolled_at = None
    MfaBackupCode.query.filter_by(user_id=user.id).delete()
    db.session.commit()

    audit_log('auth', None, f"2FA réinitialisée via reset_mfa.py (CLI) pour '{user.username}' (id={user.id})")

    print(f"OK : 2FA réinitialisée pour '{user.username}' (était activée : {was_enabled}).")
    print("Au prochain login, ce compte devra reconfigurer sa 2FA depuis zéro.")


if __name__ == '__main__':
    with app.app_context():
        if len(sys.argv) < 2:
            print(__doc__)
            sys.exit(1)
        if sys.argv[1] == '--list':
            list_admins()
        else:
            reset_mfa(sys.argv[1])
