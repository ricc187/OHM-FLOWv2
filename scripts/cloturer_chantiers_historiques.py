"""Clôture manuelle de chantiers déjà facturés avant leur import dans l'app
(voir scripts/import_chantiers_historiques.py) — le classeur Excel contenait
aussi des chantiers déjà soldés côté client, qu'on ne veut pas garder en
"EN COURS".

Pourquoi un script et pas l'écran standard : PUT /api/chantiers/<id> refuse
tout passage à DONE sans au moins un VoltaDocumentLink synchronisé (gating
anti-clôture-sans-preuve, voir app.py). Ces chantiers ont déjà été facturés
dans la vraie vie, juste jamais via Volta dans cette app — ce script
contourne délibérément ce garde-fou pour CE cas précis, en reproduisant sinon
exactement le même comportement de clôture que la route (archive des
documents, renommage du dossier de stockage).

Identifie les chantiers par leur `numero` (ex: "2600205", pas l'id
interne ni le nom complet).

Dry-run par défaut, `--execute` pour écrire réellement. Lancer depuis la
racine du repo :
    python scripts/cloturer_chantiers_historiques.py 2600205 2600207          # dry-run
    python scripts/cloturer_chantiers_historiques.py 2600205 2600207 --execute
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"

sys.path.insert(0, str(BACKEND_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass  # python-dotenv absent : on suppose les variables déjà dans l'environnement

# Même détection dev-local vs conteneur que import_chantiers_historiques.py
# — voir ce fichier pour le pourquoi (data/chantier.db n'est pas au même
# endroit relatif au cwd selon l'environnement).
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
    parser.add_argument("numeros", nargs="+", help="Numéros de chantier à clôturer (colonne 'numero', ex: 2600205)")
    parser.add_argument("--execute", action="store_true", help="Écrit réellement en base (par défaut : dry-run)")
    args = parser.parse_args()

    # Dédoublonne en gardant l'ordre, au cas où le même numéro serait collé deux fois.
    numeros = list(dict.fromkeys(args.numeros))

    with ohmapp.app.app_context():
        rows = []
        for numero in numeros:
            chantier = ohmapp.Chantier.query.filter_by(numero=numero).first()
            if chantier is None:
                rows.append((numero, None, "INTROUVABLE — aucun chantier avec ce numero"))
                continue
            if chantier.status == "DONE":
                rows.append((numero, chantier, "déjà DONE — ignoré"))
                continue
            rows.append((numero, chantier, "à clôturer"))

        print(f"{'DRY-RUN' if not args.execute else 'EXECUTE'} — {len(numeros)} numéro(s) fourni(s) :\n")
        for numero, chantier, note in rows:
            nom = chantier.nom if chantier else "-"
            print(f"  {numero:<10} {nom:<50} status_actuel={(chantier.status if chantier else '-'):<8} -> {note}")

        a_traiter = [(n, c) for n, c, note in rows if note == "à clôturer"]
        introuvables = [n for n, c, note in rows if c is None]

        if introuvables:
            print(f"\nATTENTION : {len(introuvables)} numéro(s) introuvable(s), ignoré(s) : {introuvables}")

        if not args.execute:
            print(f"\nTotal : {len(a_traiter)} chantier(s) seraient clôturés. Relancer avec --execute pour écrire réellement.")
            return

        print()
        clotures, echecs = 0, []
        for numero, chantier in a_traiter:
            try:
                chantier.status = "DONE"
                try:
                    ohmapp.archive_chantier_documents(chantier)
                except Exception as e:
                    # Best-effort, même comportement que PUT /api/chantiers/<id> —
                    # un souci de stockage ne doit pas bloquer la clôture elle-même.
                    print(f"  {numero}: archive_chantier_documents a échoué ({e}), clôture quand même")
                try:
                    ohmapp.chantier_storage_dirname(chantier)
                except Exception as e:
                    print(f"  {numero}: chantier_storage_dirname a échoué ({e}), clôture quand même")
                ohmapp.db.session.commit()
                clotures += 1
                print(f"  {numero}: clôturé (status=DONE)")
            except Exception as e:
                ohmapp.db.session.rollback()
                echecs.append((numero, str(e)))
                print(f"  {numero}: ERREUR, rollback pour ce chantier — {e}")

        print(f"\nOK — {clotures}/{len(a_traiter)} chantier(s) clôturé(s).")
        if echecs:
            print(f"Échecs : {echecs}")


if __name__ == "__main__":
    main()
