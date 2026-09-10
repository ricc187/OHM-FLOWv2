"""Import ponctuel des chantiers historiques (déjà en cours, jamais planifiés
dans l'app) depuis les 175 feuilles du classeur Excel fourni par le client
("Chantier_en_cours_Fully.xlsx", feuille "EXEMPLE" exclue — c'est un gabarit,
pas un chantier réel).

Chaque chantier doit apparaître directement en "EN COURS" côté Dashboard,
sans passer par le Pot à chantier. Le Dashboard dérive cette phase de
`has_assignments` (voir chantierPhase.ts), pas du champ `status` — donc pour
chaque chantier on crée aussi une ChantierAssignment (statut='confirme') qui
sert uniquement à déclencher ce statut dérivé, pas une vraie planification.

Nomenclature : on réutilise exactement le mécanisme déjà en place pour un
chantier créé normalement (voir POST /api/chantiers dans app.py) — numero via
_next_chantier_numero, nom = f"{numero}-{commune}-{client_repere}" — avec
commune="ANCIEN" (fixe) et client_repere=nom de la feuille (trim uniquement).
Résultat : nom = "{numero}-ANCIEN-{nom_de_la_feuille}", et surtout ce nom
reste stable si un admin modifie plus tard le chantier via l'écran standard
(PUT /api/chantiers/<id> re-dérive nom depuis numero+commune+client_repere
dès que numero est renseigné — un nom construit à la main sans peupler ces
deux colonnes se serait fait écraser au premier edit).

Isolation : importe app.py avec cwd=backend/ (comme en dev normal — la
convention SQLALCHEMY_DATABASE_URI est relative à os.getcwd(), voir
app.py:71), donc ça écrit dans la VRAIE base backend/data/chantier.db.
Aucune option pour cibler une autre base : ce script n'est pas fait pour
tourner sur le VPS depuis ce poste.

Dry-run par défaut (aucune écriture) ; `--execute` pour créer réellement.
Lancer depuis la racine du repo :
    python scripts/import_chantiers_historiques.py            # dry-run
    python scripts/import_chantiers_historiques.py --execute  # écriture réelle
"""
from __future__ import annotations

import argparse
import datetime
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

# data/chantier.db est résolu par app.py relativement à os.getcwd() (app.py:71)
# — mais ce cwd diffère entre dev local (on lance `python app.py` depuis
# backend/, donc backend/data/) et le conteneur Docker (gunicorn tourne
# depuis WORKDIR=/app, et c'est ./data:/app/data qui est monté — pas
# backend/data/, qui resterait vide/éphémère dans le conteneur). On détecte
# le bon cwd en cherchant lequel des deux contient réellement chantier.db,
# plutôt que de figer un choix qui casserait silencieusement l'autre
# environnement (voir l'incident .mfa_key : même piège, un chemin qui
# "marche en dev" mais pointe dans le vide en conteneur).
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
    import app as ohmapp  # noqa: E402 — doit s'importer avec le cwd où vit réellement data/
finally:
    os.chdir(_orig_cwd)

ADMIN_USERNAME = "Admin"
ASSIGNMENT_DESCRIPTION = (
    "Affectation administrative — import historique, ne reflète pas un vrai "
    "jour de travail planifié."
)

# Les 175 feuilles à importer, dans l'ordre exact du classeur (fixe la
# séquence de numéros attribués). "EXEMPLE" déjà exclue en amont. Aucune
# correction orthographique/de casse : seul un .strip() est appliqué plus
# bas, y compris sur les entrées qui semblent tronquées ou incohérentes en
# casse (ex: "MOret Branson", "MIchelod Regis") — reprises telles quelles.
SHEET_NAMES = [
    "Abbet Laurence", "Abbet Olivier", "Adam", "Admin Fully", "Agrobio",
    "AlpWater", "Arlettaz Christelle", "Arlettaz Fruits", "Auberson", "Aymon Carine",
    "Baïta", "Barmaz Véronique", "Before", "Bender Emmanuel", "Bender Gabriel",
    "Bender Léonard", "Bestazzoni Lucie", "Bestazzoni Umberto", "Bianco Romain", "Bibliothèque Fully",
    "Biffiger Roland", "Bochatey Geraldine", "Bordy Xavier", "Bossu Geofrey", "Bourgville",
    "Bourneau", "Bougnole Fabien", "Brasserie du Lynx", "Bringhen", "Bruchez Romaine",
    "Buchard Bois", "Buthey Sandrine", "Café de la Poste", "Café de l'Union", "Campanile Hotel",
    "Carron Gregory", "Carron Paul-André", "Carron Sébastien", "Cartel", "Charnot 2",
    "Château Tassonnière", "Chevalley Ovronnaz", "Chiboz", "Cleusix Julien", "Co-Home",
    "Comte Magali", "Corcia Julie", "Coudray Dylan", "Cretton David (DARE)", "Darbellay Piscine",
    "Daves", "Debons Lucienne", "Delèze 8", "DeSalvo", "Dessibourg",
    "DM Bois", "Dorsaz Michel", "Dorsaz SA", "Duay", "Dubosson Marlène",
    "Dubosson Samuel", "Dubosson Yannick", "Ecole de Ville", "Ecole du Bourg", "Ecole batiaz",
    "Esram Isabelle", "Fardel", "Fenner Melinda", "Fidalgo", "Fournier Bertrand",
    "Franzetti", "Fusion 40", "Fusion 48", "Fusion 166", "Garage du Coin",
    "Garage Fully", "Garcia Florian", "Gaspari Halle", "Gaspari Jardins du Rhône", "Gay Louis-Philippe",
    "Gay Philippe", "GerHome Saxon", "Gex Philomène", "Guex Christian", "Hub Martigny",
    "Hugon Véronique Le Fays", "Jaton Chamoson", "Jelena", "Jysk", "La Batiaz appartement",
    "La Grenette 20", "Lattion Léna Saxé", "Le Cèdre", "Leman 22", "Le Manoir",
    "Leibovich", "Les Marecottes", "Les Saules", "Les Touristes", "Les Touristes Verbier",
    "Logibat Saxon", "Lonfat Vicken", "Madjid Hemdane", "Marconi 19", "Marianne PaC",
    "Meillerettes 5", "Mettaz", "MG Cuisine", "Mobilerycicle", "Moloko",
    "Moret Anouck", "MOret Branson", "Michel Olivier", "MIchelod Regis", "Nax",
    "NCO SA", "Neuvilles 21", "Nobs Bastien", "Noé Staub", "Omega",
    "Pagliotti Marco Valloton", "Pannatier Monica", "Patinoire My", "Perrin Charlie", "Perret Gentils",
    "Pistolet 1", "Place Centrale 10", "Rebord", "Rebord chez lui", "Rebord Vétroz",
    "Remondeulaz Isabelle", "Richoz Serge", "Roduit David", "Roduit Eliane", "Roduit Florent",
    "Roduit Marie-Noelle", "Romaine 25 Leytron", "Rossier", "Roulin Patrick", "Roy Daniel",
    "Rui", "Rullo Danièle", "Salvan Biolley 13", "Sarrasin Alexia", "Sarrasin Thierry",
    "Savièse", "Service Jardins Plus", "Sinergy", "Soar", "Solaire Sarreyer",
    "Spielmann", "Staub Martig", "St-Gingolph", "Theux Roger", "Thurre Blaise",
    "Troillet 82 Sion", "Troillet Trient Huber", "Turchi MUrielle", "Tyr solutions", "Verbier Chemin des Fées(Belcomb",
    "Verbier Chopinettes", "Verbier Fioral", "Verbier Heim", "Verbier Mateo Solaris", "Verbier Renikens",
    "Verbier Rosa", "Verbier Taramarcaz Michelle", "Vergers à Suzon", "Versegères Louis Pache", "Villa 5 Collonges",
    "Villa Morisod", "Vilt SA", "Vocat", "Vonarburg Serge", "Vouillamoz Nadia",
]


def _trimmed_names() -> list[str]:
    names = [n.strip() for n in SHEET_NAMES]
    if len(names) != 175:
        raise SystemExit(f"FATAL: {len(names)} feuilles au lieu de 175 attendues — abandon.")
    if any(not n for n in names):
        raise SystemExit("FATAL: une feuille est vide après trim — abandon.")
    if any(n.upper() == "EXEMPLE" for n in names):
        raise SystemExit("FATAL: 'EXEMPLE' présent dans la liste — c'est un gabarit, pas un chantier.")
    seen: dict[str, int] = {}
    for n in names:
        seen[n] = seen.get(n, 0) + 1
    dupes = {n: c for n, c in seen.items() if c > 1}
    if dupes:
        print(f"ATTENTION: noms de feuille dupliqués (créés quand même, chacun avec son propre numéro) : {dupes}")
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Écrit réellement en base (par défaut : dry-run)")
    args = parser.parse_args()

    names = _trimmed_names()
    today_str = datetime.date.today().isoformat()

    with ohmapp.app.app_context():
        admin = ohmapp.User.query.filter_by(username=ADMIN_USERNAME).first()
        if admin is None:
            raise SystemExit(f"FATAL: compte '{ADMIN_USERNAME}' introuvable en base — abandon.")

        annee = datetime.datetime.now().year
        yy = str(annee)[-2:].zfill(2)

        if not args.execute:
            # Dry-run : on ne touche pas au SequenceCounter, on se contente de
            # lire sa valeur actuelle pour PRÉVOIR les numéros qui seraient
            # attribués (peut décaler si un chantier est créé entre-temps par
            # ailleurs — normal pour un dry-run, pas une garantie exacte).
            counter = ohmapp.SequenceCounter.query.filter_by(name="chantier_numero").first()
            base = counter.value if counter else 0
            print(f"DRY-RUN — {len(names)} chantiers seraient créés (référent={admin.username}, année={annee}) :\n")
            for i, name in enumerate(names, start=1):
                numero = f"{yy}{base + i:05d}"
                nom = f"{numero}-ANCIEN-{name}"
                print(
                    f"{i:>3}. numero={numero}  nom={nom!r}  "
                    f"affectation={today_str}->{today_str} (confirme, {admin.username})"
                )
            print(f"\nTotal : {len(names)} chantiers. Relancer avec --execute pour écrire réellement en base.")
            return

        # --execute : création réelle, tout dans une seule transaction — un
        # crash à mi-parcours rollback tout (y compris le SequenceCounter,
        # qui n'est flushé mais pas commité tant qu'on n'a pas fini la boucle).
        created = []
        try:
            for i, name in enumerate(names, start=1):
                numero = ohmapp._next_chantier_numero(annee)
                nom = f"{numero}-ANCIEN-{name}"
                chantier = ohmapp.Chantier(
                    nom=nom,
                    numero=numero,
                    commune="ANCIEN",
                    client_repere=name,
                    referent_id=admin.id,
                    annee=annee,
                    status="FUTURE",
                )
                ohmapp.db.session.add(chantier)
                ohmapp.db.session.flush()  # pour obtenir chantier.id avant la ChantierAssignment

                assignment = ohmapp.ChantierAssignment(
                    chantier_id=chantier.id,
                    user_id=admin.id,
                    date_debut=today_str,
                    date_fin=today_str,
                    toute_la_journee=True,
                    description=ASSIGNMENT_DESCRIPTION,
                    statut="confirme",
                    created_by_id=admin.id,
                )
                ohmapp.db.session.add(assignment)

                created.append((numero, nom))
                print(f"{i:>3}/{len(names)}. numero={numero}  nom={nom!r}  -> créé + affectation confirme")

            if len(created) != 175:
                raise RuntimeError(f"{len(created)} chantiers créés au lieu de 175 attendus — rollback.")

            ohmapp.db.session.commit()
        except Exception:
            ohmapp.db.session.rollback()
            print("\nERREUR — transaction annulée (rollback), rien n'a été écrit en base.")
            raise

        print(f"\nOK — {len(created)} chantiers créés (référent={admin.username}, année={annee}), chacun avec sa ChantierAssignment.")


if __name__ == "__main__":
    main()
