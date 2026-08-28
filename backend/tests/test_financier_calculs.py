"""Tests du module financier_calculs — valeurs de référence tirées directement
de G 500 Analyse Chantier.xlsx, chantier "La Baita" (feuille active du classeur,
valeurs mises en cache par Excel, lues avec openpyxl(data_only=True)).

Lancer : python -m unittest backend.tests.test_financier_calculs -v
      ou (depuis backend/) : python -m unittest tests.test_financier_calculs -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from financier_calculs import compute_financier


# --- CA prévisionnel "La Baita" (C10:D14 — désormais une liste, plus 3 champs fixes) ---
LA_BAITA_CA_MONTANTS = [145750.05, 2734.8, 32986.85]  # C10, C11, C12 (adjugé/régie/PV clients)
LA_BAITA_CA_HEURES = [1052, 0, 0]                      # D10, D11 (vide), D12 (vide)

LA_BAITA_PREVU = dict(
    ca_lignes_montants=LA_BAITA_CA_MONTANTS,
    ca_lignes_heures=LA_BAITA_CA_HEURES,
    charge_materiel_prevue=66824,  # C26
    taux_horaire=71,               # D30
)

# Acomptes réels (F10:G14) — G12/G13 vides, seuls G10/G11/G14 sont remplis.
LA_BAITA_ACOMPTES = [117600, 29400, 2734.8]

# Achats réels (F19:G25) — G19 est la ligne estimation_petites_fournitures
# (= charge_materiel_prevue * pct_petites_fournitures = 66824 * 0.05 = 3341.2).
LA_BAITA_ACHATS = [3341.2, 11447.35, 7997.05, 17456.9, 766.3, 5469.85, 5100]

# Heures réellement pointées (G30 = K4 dans le classeur).
LA_BAITA_HEURES_REELLES = 1823.75


class TestComputeFinancierLaBaita(unittest.TestCase):
    """Chaque assertion matche une cellule calculée du classeur Excel —
    voir la référence en commentaire à côté de chacune."""

    @classmethod
    def setUpClass(cls):
        cls.result = compute_financier(
            **LA_BAITA_PREVU,
            acomptes_montants=LA_BAITA_ACOMPTES,
            achats_montants=LA_BAITA_ACHATS,
            heures_reelles=LA_BAITA_HEURES_REELLES,
        )

    def test_heures_reelles(self):
        self.assertAlmostEqual(self.result['heures_reelles'], 1823.75, places=2)  # G30

    def test_ca_prevu(self):
        self.assertAlmostEqual(self.result['ca_prevu'], 181471.70, places=2)  # C15

    def test_heures_prevues(self):
        self.assertAlmostEqual(self.result['heures_prevues'], 1052.0, places=2)  # D15

    def test_ca_reel(self):
        self.assertAlmostEqual(self.result['ca_reel'], 149734.80, places=2)  # G15

    def test_reste_a_facturer(self):
        self.assertAlmostEqual(self.result['reste_a_facturer'], 31736.90, places=2)  # I15

    def test_total_achats_reel(self):
        self.assertAlmostEqual(self.result['total_achats_reel'], 51578.65, places=2)  # G26

    def test_ecart_materiel(self):
        self.assertAlmostEqual(self.result['ecart_materiel'], 15245.35, places=2)  # I26

    def test_cout_mo_prevu(self):
        self.assertAlmostEqual(self.result['cout_mo_prevu'], 74692.00, places=2)  # C32

    def test_cout_mo_reel(self):
        self.assertAlmostEqual(self.result['cout_mo_reel'], 129486.25, places=2)  # G32

    def test_ecart_heures(self):
        self.assertAlmostEqual(self.result['ecart_heures'], 771.75, places=2)  # I30

    def test_ecart_cout_mo(self):
        self.assertAlmostEqual(self.result['ecart_cout_mo'], 54794.25, places=2)  # I32

    def test_marge_prevue(self):
        self.assertAlmostEqual(self.result['marge_prevue'], 39955.70, places=2)  # C35

    def test_pct_marge_prevue(self):
        self.assertAlmostEqual(self.result['pct_marge_prevue'], 0.2202, places=4)  # D35

    def test_marge_reelle(self):
        self.assertAlmostEqual(self.result['marge_reelle'], -31330.10, places=2)  # G35

    def test_pct_marge_reelle(self):
        self.assertAlmostEqual(self.result['pct_marge_reelle'], -0.2092, places=4)  # H35

    def test_ecart_marge(self):
        self.assertAlmostEqual(self.result['ecart_marge'], -71285.80, places=2)  # I35

    # --- Débours sec (coût direct = main d'œuvre + matériel) et avancement ---
    # Nouveaux dans Excel — pas de réf. cellule, formules données directement
    # par l'utilisateur : debourse_sec = cout_mo + charge/achats matériel.

    def test_debourse_sec_prevu(self):
        self.assertAlmostEqual(self.result['debourse_sec_prevu'], 141516.00, places=2)  # C32+C26

    def test_debourse_sec_reel(self):
        self.assertAlmostEqual(self.result['debourse_sec_reel'], 181064.90, places=2)  # G32+G26

    def test_pct_avancement_ca(self):
        self.assertAlmostEqual(self.result['pct_avancement_ca'], 0.8251, places=4)  # G15/C15

    def test_pct_avancement_materiel(self):
        self.assertAlmostEqual(self.result['pct_avancement_materiel'], 0.7719, places=4)  # G26/C26

    def test_pct_avancement_mo(self):
        self.assertAlmostEqual(self.result['pct_avancement_mo'], 1.7336, places=4)  # G32/C32

    def test_pct_avancement_debourse_sec(self):
        self.assertAlmostEqual(self.result['pct_avancement_debourse_sec'], 1.2795, places=4)


class TestComputeFinancierDivisionParZero(unittest.TestCase):
    """Dénominateur nul (ca_prevu, ca_reel, charge matériel, cout MO prévu,
    débours sec prévu) -> ratio correspondant = None, jamais d'exception."""

    def test_pct_marge_prevue_none_si_ca_prevu_nul(self):
        result = compute_financier(
            ca_lignes_montants=[], ca_lignes_heures=[],
            charge_materiel_prevue=0, taux_horaire=71,
            acomptes_montants=[1000], achats_montants=[],
            heures_reelles=0,
        )
        self.assertEqual(result['ca_prevu'], 0)
        self.assertIsNone(result['pct_marge_prevue'])
        self.assertIsNone(result['pct_avancement_ca'])
        # ca_reel non nul ici -> pct_marge_reelle doit lui rester calculable
        self.assertIsNotNone(result['pct_marge_reelle'])

    def test_pct_marge_reelle_none_si_ca_reel_nul(self):
        result = compute_financier(
            ca_lignes_montants=[10000], ca_lignes_heures=[100],
            charge_materiel_prevue=1000, taux_horaire=50,
            acomptes_montants=[], achats_montants=[500],
            heures_reelles=80,
        )
        self.assertEqual(result['ca_reel'], 0)
        self.assertIsNone(result['pct_marge_reelle'])
        self.assertIsNotNone(result['pct_marge_prevue'])

    def test_pct_avancement_materiel_none_si_charge_prevue_nulle(self):
        result = compute_financier(
            ca_lignes_montants=[1000], ca_lignes_heures=[10],
            charge_materiel_prevue=0, taux_horaire=50,
            acomptes_montants=[500], achats_montants=[200],
            heures_reelles=5,
        )
        self.assertIsNone(result['pct_avancement_materiel'])

    def test_pct_avancement_mo_none_si_heures_prevues_nulles(self):
        result = compute_financier(
            ca_lignes_montants=[1000], ca_lignes_heures=[0],
            charge_materiel_prevue=100, taux_horaire=50,
            acomptes_montants=[500], achats_montants=[50],
            heures_reelles=5,
        )
        self.assertEqual(result['cout_mo_prevu'], 0)
        self.assertIsNone(result['pct_avancement_mo'])

    def test_les_deux_nuls_aucune_exception(self):
        result = compute_financier(
            ca_lignes_montants=[], ca_lignes_heures=[],
            charge_materiel_prevue=0, taux_horaire=0,
            acomptes_montants=[], achats_montants=[],
            heures_reelles=0,
        )
        self.assertIsNone(result['pct_marge_prevue'])
        self.assertIsNone(result['pct_marge_reelle'])
        self.assertIsNone(result['pct_avancement_ca'])
        self.assertIsNone(result['pct_avancement_materiel'])
        self.assertIsNone(result['pct_avancement_mo'])
        self.assertIsNone(result['pct_avancement_debourse_sec'])


class TestComputeFinancierListesVariables(unittest.TestCase):
    """Le CA prévisionnel est une liste à taille libre — 1 ligne, 5 lignes,
    ou aucune doivent tous fonctionner (plus de 3 champs fixes obligatoires)."""

    def test_une_seule_ligne(self):
        result = compute_financier(
            ca_lignes_montants=[10000], ca_lignes_heures=[100],
            charge_materiel_prevue=2000, taux_horaire=60,
            acomptes_montants=[5000], achats_montants=[1000],
            heures_reelles=90,
        )
        self.assertAlmostEqual(result['ca_prevu'], 10000, places=2)
        self.assertAlmostEqual(result['heures_prevues'], 100, places=2)

    def test_cinq_lignes(self):
        result = compute_financier(
            ca_lignes_montants=[1000, 2000, 3000, 4000, 5000],
            ca_lignes_heures=[10, 20, 30, 40, 50],
            charge_materiel_prevue=500, taux_horaire=60,
            acomptes_montants=[], achats_montants=[],
            heures_reelles=0,
        )
        self.assertAlmostEqual(result['ca_prevu'], 15000, places=2)
        self.assertAlmostEqual(result['heures_prevues'], 150, places=2)

    def test_aucune_ligne(self):
        result = compute_financier(
            ca_lignes_montants=[], ca_lignes_heures=[],
            charge_materiel_prevue=0, taux_horaire=0,
            acomptes_montants=[], achats_montants=[],
            heures_reelles=0,
        )
        self.assertEqual(result['ca_prevu'], 0)
        self.assertEqual(result['heures_prevues'], 0)


if __name__ == '__main__':
    unittest.main()
