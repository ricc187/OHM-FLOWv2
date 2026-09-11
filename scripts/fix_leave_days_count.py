"""Recalcule Leave.days_count avec la formule corrigée (voir compute_days_count,
app.py, fix du 2026-09-11) sur les congés déjà en base, et réajuste le solde de
vacances des utilisateurs déjà impactés.

Contexte : compute_days_count comptait avant un simple nombre de jours
calendaires inclusifs. Le vendredi n'est travaillé que le matin dans cette
boîte (WORKDAY_HOURS : 4.5h vendredi contre 9h lun-jeu) et le weekend jamais —
un congé jeudi->vendredi ne "coûte" donc que 1.5 jour, pas 2. Tout congé
touchant un vendredi ou un weekend, créé avant le fix, a un days_count trop
élevé, et si son type est CONGE et son status déjà APPROVED, le solde de
vacances de l'utilisateur a été sur-débité d'autant (voir _approve_leave/
_approve_leave_if_pending qui déduisent vacation_balance à l'approbation).

Ce script, pour chaque Leave dont le days_count recalculé diffère de l'actuel :
  - corrige toujours Leave.days_count (PENDING/REJECTED inclus, pour que
    l'historique/les stats soient justes même sans impact sur un solde)
  - si status == APPROVED et type == CONGE, recrédite la différence
    (ancien - nouveau, toujours >= 0 avec ce fix) sur vacation_balance de
    l'utilisateur concerné

Dry-run par défaut, --execute pour écrire réellement. Lancer depuis la racine
du repo :
    python scripts/fix_leave_days_count.py            # dry-run
    python scripts/fix_leave_days_count.py --execute
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Évite le mojibake des accents sur une console Windows (codepage non-UTF-8
# par défaut) — sans effet sur le VPS (Linux, déjà en UTF-8).
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"

sys.path.insert(0, str(BACKEND_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass  # python-dotenv absent : on suppose les variables déjà dans l'environnement

# Ne jamais laisser tourner le cron Volta pendant un script one-off comme
# celui-ci (même raison que les tests — voir OHM_DISABLE_VOLTA_CRON dans app.py).
os.environ.setdefault("OHM_DISABLE_VOLTA_CRON", "1")

# Même détection dev-local vs conteneur que les autres scripts/*.py — voir
# import_chantiers_historiques.py pour le pourquoi (data/chantier.db n'est
# pas au même endroit relatif au cwd selon l'environnement).
_candidates = [BACKEND_DIR, REPO_ROOT]
_app_cwd = next((c for c in _candidates if (c / "data" / "chantier.db").exists()), None)
if _app_cwd is None:
    raise SystemExit(
        "FATAL: aucune base data/chantier.db trouvée sous "
        f"{BACKEND_DIR} ni {REPO_ROOT} — abandon (mauvais répertoire de lancement ?)."
    )

_orig_cwd = os.getcwd()
os.chdir(_app_cwd)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="Écrit réellement en base (par défaut : dry-run)")
    args = parser.parse_args()

    with ohmapp.app.app_context():
        leaves = ohmapp.Leave.query.order_by(ohmapp.Leave.date_start).all()

        changed = []
        for leave in leaves:
            try:
                new_count = ohmapp.compute_days_count(leave.date_start, leave.date_end)
            except ValueError:
                continue  # dates invalides — ne devrait pas arriver, ignoré plutôt que planter le script
            old_count = leave.days_count or 0.0
            if new_count == old_count:
                continue
            changed.append((leave, old_count, new_count))

        print(f"{'DRY-RUN' if not args.execute else 'EXECUTE'} — {len(leaves)} congé(s) en base, {len(changed)} à corriger :\n")

        total_balance_given_back = 0.0
        by_user_adjustment = {}
        for leave, old_count, new_count in changed:
            user = ohmapp.db.session.get(ohmapp.User, leave.user_id)
            username = user.username if user else f"user_id={leave.user_id} (introuvable)"
            balance_delta = 0.0
            note = ""
            if leave.status == "APPROVED" and leave.type == "CONGE" and user is not None:
                balance_delta = old_count - new_count  # toujours >= 0 avec ce fix (on ne fait que réduire days_count)
                total_balance_given_back += balance_delta
                by_user_adjustment[username] = by_user_adjustment.get(username, 0.0) + balance_delta
                note = f"  -> solde {username} recrédité de +{balance_delta:g}j"
            print(
                f"  #{leave.id:<5} {leave.date_start} -> {leave.date_end:<10} "
                f"{leave.type:<14} {leave.status:<9} {username:<15} "
                f"days_count {old_count:g} -> {new_count:g}{note}"
            )

        if not changed:
            print("Rien à corriger — tous les days_count sont déjà justes.")
            return

        print(f"\nRécapitulatif : {len(changed)} congé(s) recalculé(s), "
              f"{total_balance_given_back:g}j au total recrédités sur {len(by_user_adjustment)} utilisateur(s) :")
        for username, total in sorted(by_user_adjustment.items(), key=lambda kv: -kv[1]):
            print(f"    {username}: +{total:g}j")

        if not args.execute:
            print("\nDRY-RUN — rien écrit. Relancer avec --execute pour appliquer.")
            return

        print()
        fixed, echecs = 0, []
        for leave, old_count, new_count in changed:
            try:
                leave.days_count = new_count
                if leave.status == "APPROVED" and leave.type == "CONGE":
                    user = ohmapp.db.session.get(ohmapp.User, leave.user_id)
                    if user is not None:
                        user.vacation_balance += (old_count - new_count)
                ohmapp.db.session.commit()
                fixed += 1
            except Exception as e:
                ohmapp.db.session.rollback()
                echecs.append((leave.id, str(e)))
                print(f"  leave #{leave.id}: ERREUR, rollback pour ce congé — {e}")

        print(f"OK — {fixed}/{len(changed)} congé(s) corrigé(s).")
        if echecs:
            print(f"Échecs : {echecs}")


if __name__ == "__main__":
    main()
