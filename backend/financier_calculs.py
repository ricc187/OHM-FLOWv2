"""Logique de calcul du module financier — pur Python, aucune dépendance
Flask/SQLAlchemy, pour rester testable seule (voir tests/test_financier_calculs.py).

Toutes les formules sont copiées du classeur Excel de référence
(G 500 Analyse Chantier.xlsx) — les références de cellules sont dans les
docstrings/commentaires pour pouvoir recomparer facilement.

Règle d'arrondi : jamais entre deux étapes de calcul — chaque valeur
intermédiaire (ca_prevu, cout_mo_reel, etc.) est réutilisée en pleine
précision float pour l'étape suivante, exactement comme Excel le fait en
interne. L'arrondi n'intervient qu'une fois, à la toute fin, sur le dict
de sortie — voir _round_output().
"""

# Champs monétaires/heures -> 2 décimales à l'affichage.
# Champs de pourcentage (ratios 0..1) -> 4 décimales, soit 2 décimales une
# fois exprimé en %  (0.220176... -> 0.2202 -> "22.02 %").
_MONEY_HOURS_FIELDS = (
    'heures_reelles', 'ca_prevu', 'heures_prevues', 'ca_reel', 'reste_a_facturer',
    'total_achats_reel', 'ecart_materiel', 'cout_mo_prevu', 'cout_mo_reel',
    'ecart_heures', 'ecart_cout_mo', 'marge_prevue', 'marge_reelle', 'ecart_marge',
    'debourse_sec_prevu', 'debourse_sec_reel',
)
_PCT_FIELDS = (
    'pct_marge_prevue', 'pct_marge_reelle',
    'pct_avancement_ca', 'pct_avancement_materiel', 'pct_avancement_mo', 'pct_avancement_debourse_sec',
)


def _safe_div(numerator, denominator):
    """Division protégée — renvoie None (pas de crash, pas de 0 trompeur)
    quand le dénominateur est nul. Utilisée pour tous les ratios (marge et
    avancement) quand leur dénominateur (ca_prevu/ca_reel/charge prévue/
    cout prévu/débours prévu) est nul."""
    if not denominator:
        return None
    return numerator / denominator


def _round_output(values: dict) -> dict:
    out = dict(values)
    for f in _MONEY_HOURS_FIELDS:
        if f in out and out[f] is not None:
            out[f] = round(out[f], 2)
    for f in _PCT_FIELDS:
        if f in out and out[f] is not None:
            out[f] = round(out[f], 4)
    return out


def compute_financier(
    *,
    ca_lignes_montants: list,
    ca_lignes_heures: list,
    charge_materiel_prevue: float,
    taux_horaire: float,
    acomptes_montants: list,
    achats_montants: list,
    heures_reelles: float,
) -> dict:
    """Calcule le prévisionnel/réel/écart complet d'un chantier.

    Tous les paramètres sont des primitives (pas d'objets ORM) — l'appelant
    (couche API) est responsable d'aller chercher chantier_financier, les
    lignes CA prévisionnelles et la somme des acomptes/achats/heures depuis
    la base.

    ca_lignes_montants/heures : les lignes du CA prévisionnel (réf. Excel
                          C10:D14 — adjugé/régie/PV clients/...), à taille
                          libre (1 chantier peut n'avoir qu'une ligne, un
                          autre 5).
    acomptes_montants   : liste des montants de la table `acomptes` de ce chantier.
    achats_montants     : liste des montants de `achats_materiel` de ce chantier
                          (inclut la ligne type='estimation_petites_fournitures').
    heures_reelles       : SUM(entries.heures) pour ce chantier — vient du module
                          heures existant, pas recalculé ici.
    """
    # --- Prévisionnel ---
    ca_prevu = sum(ca_lignes_montants)  # réf. C15 = SUM(C10:C14)
    heures_prevues = sum(ca_lignes_heures)  # réf. D15 = SUM(D10:D14)
    cout_mo_prevu = taux_horaire * heures_prevues  # réf. C32 = D30*C30
    marge_prevue = ca_prevu - charge_materiel_prevue - cout_mo_prevu  # réf. C35
    pct_marge_prevue = _safe_div(marge_prevue, ca_prevu)  # réf. D35 = C35/C15

    # --- Réel ---
    ca_reel = sum(acomptes_montants)  # réf. G15 = SUM(G10:G14)
    reste_a_facturer = ca_prevu - ca_reel  # réf. I15 = C15-G15
    total_achats_reel = sum(achats_montants)  # réf. G26 = SUM(G19:G25)
    ecart_materiel = charge_materiel_prevue - total_achats_reel  # réf. I26 = C26-G26
    cout_mo_reel = taux_horaire * heures_reelles  # réf. G32 = G30*D30
    ecart_heures = heures_reelles - heures_prevues  # réf. I30 = G30-C30
    ecart_cout_mo = cout_mo_reel - cout_mo_prevu  # réf. I32 = G32-C32
    marge_reelle = ca_reel - total_achats_reel - cout_mo_reel  # réf. G35 = G15-G26-G32
    pct_marge_reelle = _safe_div(marge_reelle, ca_reel)  # réf. H35 = G35/G15

    # --- Écart ---
    ecart_marge = marge_reelle - marge_prevue  # réf. I35 = G35-C35

    # --- Débours sec (coût direct = main d'œuvre + matériel) ---
    debourse_sec_prevu = cout_mo_prevu + charge_materiel_prevue  # C32+C26
    debourse_sec_reel = cout_mo_reel + total_achats_reel  # G32+G26

    # --- Avancement (% réel / prévu) ---
    pct_avancement_ca = _safe_div(ca_reel, ca_prevu)  # G15/C15
    pct_avancement_materiel = _safe_div(total_achats_reel, charge_materiel_prevue)  # G26/C26
    pct_avancement_mo = _safe_div(cout_mo_reel, cout_mo_prevu)  # G32/C32
    pct_avancement_debourse_sec = _safe_div(debourse_sec_reel, debourse_sec_prevu)

    return _round_output({
        'heures_reelles': heures_reelles,
        'ca_prevu': ca_prevu,
        'heures_prevues': heures_prevues,
        'ca_reel': ca_reel,
        'reste_a_facturer': reste_a_facturer,
        'total_achats_reel': total_achats_reel,
        'ecart_materiel': ecart_materiel,
        'cout_mo_prevu': cout_mo_prevu,
        'cout_mo_reel': cout_mo_reel,
        'ecart_heures': ecart_heures,
        'ecart_cout_mo': ecart_cout_mo,
        'marge_prevue': marge_prevue,
        'pct_marge_prevue': pct_marge_prevue,
        'marge_reelle': marge_reelle,
        'pct_marge_reelle': pct_marge_reelle,
        'ecart_marge': ecart_marge,
        'debourse_sec_prevu': debourse_sec_prevu,
        'debourse_sec_reel': debourse_sec_reel,
        'pct_avancement_ca': pct_avancement_ca,
        'pct_avancement_materiel': pct_avancement_materiel,
        'pct_avancement_mo': pct_avancement_mo,
        'pct_avancement_debourse_sec': pct_avancement_debourse_sec,
    })
