"""Tests des endpoints /api/chantiers/<id>/financier, /ca_lignes, /acomptes, /achats.

Isolation : importe app.py avec cwd pointé sur un dossier temporaire, donc
data/chantier.db et data/uploads/ se créent là (jamais dans le vrai data/ du
projet) — voir le bloc d'import ci-dessous, avant toute autre importation.

Lancer : python -m unittest tests.test_financier_api -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_financier_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402 — must import with cwd=_TEST_DIR (paths/init_db baked in at import time)
finally:
    os.chdir(_orig_cwd)


def _addCleanupModule():
    import atexit
    atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))


_addCleanupModule()

# Same "La Baita" reference numbers as test_financier_calculs.py. Le CA
# prévisionnel (montant_adjuge/heures_adjugees/... d'avant) est maintenant
# une liste de lignes libres (ca_lignes), postée séparément.
LA_BAITA_PREVU = dict(charge_materiel_prevue=66824, taux_horaire=71, pct_petites_fournitures=0.05)
LA_BAITA_CA_LIGNES = [
    ('Adjugé', 145750.05, 1052),
    ('Travaux en régie', 2734.8, 0),
    ('PV clients', 32986.85, 0),
]
LA_BAITA_ACOMPTES = [
    ('Acompte N°1-2-3-4', 117600, '2026-01-10'),
    ('Acompte N°2', 29400, '2026-02-10'),
    ('Régie 1', 2734.8, '2026-03-10'),
]
# G20-G25 — G19 (estimation_petites_fournitures) is auto-created by the PUT above.
LA_BAITA_ACHATS_MANUELS = [
    ('EM 11.06 - 17.11', 11447.35),
    ('05.01-10.02', 7997.05),
    ('19.02-08.07', 17456.9),
    ('Zaptec', 766.3),
    ('Electrophil', 5469.85),
    ('eclairage', 5100),
]
LA_BAITA_HEURES_REELLES = 1823.75


class FinancierApiTestCase(unittest.TestCase):
    """Une seule app/DB en mémoire pour toute la classe — chaque test travaille
    sur son propre chantier fraîchement créé dans setUp() pour rester isolé."""

    @classmethod
    def setUpClass(cls):
        cls.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.token = ohmapp.serializer.dumps({'user_id': admin.id})
            cls.admin_id = admin.id
        cls.client.set_cookie(ohmapp.COOKIE_NAME, cls.token)

    def setUp(self):
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=f'Test {self._testMethodName}', annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            self.chantier_id = chantier.id

    def _add_entry(self, heures):
        with ohmapp.app.app_context():
            e = ohmapp.Entry(user_id=self.admin_id, chantier_id=self.chantier_id, date='2026-01-01',
                              heures=heures, created_by_id=self.admin_id)
            ohmapp.db.session.add(e)
            ohmapp.db.session.commit()

    def _put_financier(self, **overrides):
        body = {**LA_BAITA_PREVU, **overrides}
        return self.client.put(f'/api/chantiers/{self.chantier_id}/financier', json=body)

    def _post_ca_ligne(self, libelle, montant, heures=0):
        return self.client.post(f'/api/chantiers/{self.chantier_id}/ca_lignes',
                                 json={'libelle': libelle, 'montant': montant, 'heures': heures})

    # --- GET matche financier_calculs (mêmes valeurs que test_financier_calculs.py) ---

    def test_get_financier_matches_calcul_module(self):
        res = self._put_financier()
        self.assertEqual(res.status_code, 200, res.get_json())

        for libelle, montant, heures in LA_BAITA_CA_LIGNES:
            res = self._post_ca_ligne(libelle, montant, heures)
            self.assertEqual(res.status_code, 201, res.get_json())

        for libelle, montant, date in LA_BAITA_ACOMPTES:
            res = self.client.post(f'/api/chantiers/{self.chantier_id}/acomptes',
                                    json={'libelle': libelle, 'montant': montant, 'date': date})
            self.assertEqual(res.status_code, 201, res.get_json())

        for libelle, montant in LA_BAITA_ACHATS_MANUELS:
            res = self.client.post(f'/api/chantiers/{self.chantier_id}/achats',
                                    json={'libelle': libelle, 'montant': montant})
            self.assertEqual(res.status_code, 201, res.get_json())

        self._add_entry(LA_BAITA_HEURES_REELLES)

        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()

        self.assertEqual(len(data['ca_lignes']), 3)
        self.assertEqual(len(data['acomptes']), 3)
        self.assertEqual(len(data['achats']), 7)  # 6 manuels + 1 estimation auto

        expected = {
            'heures_reelles': 1823.75, 'ca_prevu': 181471.70, 'heures_prevues': 1052.0,
            'ca_reel': 149734.80, 'reste_a_facturer': 31736.90, 'total_achats_reel': 51578.65,
            'ecart_materiel': 15245.35, 'cout_mo_prevu': 74692.00, 'cout_mo_reel': 129486.25,
            'ecart_heures': 771.75, 'ecart_cout_mo': 54794.25, 'marge_prevue': 39955.70,
            'marge_reelle': -31330.10, 'ecart_marge': -71285.80,
            'debourse_sec_prevu': 141516.00, 'debourse_sec_reel': 181064.90,
        }
        for field, value in expected.items():
            self.assertAlmostEqual(data[field], value, places=2, msg=field)
        self.assertAlmostEqual(data['pct_marge_prevue'], 0.2202, places=4)
        self.assertAlmostEqual(data['pct_marge_reelle'], -0.2092, places=4)
        self.assertAlmostEqual(data['pct_avancement_ca'], 0.8251, places=4)
        self.assertAlmostEqual(data['pct_avancement_materiel'], 0.7719, places=4)
        self.assertAlmostEqual(data['pct_avancement_mo'], 1.7336, places=4)
        self.assertAlmostEqual(data['pct_avancement_debourse_sec'], 1.2795, places=4)

    def test_get_before_any_financier_created(self):
        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIsNone(data['financier'])
        self.assertEqual(data['ca_lignes'], [])
        self.assertEqual(data['acomptes'], [])
        self.assertEqual(data['achats'], [])
        self.assertNotIn('ca_prevu', data)  # pas de calcul possible sans prévisionnel

    def test_get_put_chantier_not_found_404(self):
        res = self.client.get('/api/chantiers/999999/financier')
        self.assertEqual(res.status_code, 404)
        res = self.client.put('/api/chantiers/999999/financier', json=LA_BAITA_PREVU)
        self.assertEqual(res.status_code, 404)

    def test_financier_put_sans_aucun_champ_cree_avec_defauts(self):
        # Plus aucun champ obligatoire depuis que le CA vit dans ca_lignes —
        # un PUT vide doit créer le prévisionnel avec des 0 partout.
        res = self.client.put(f'/api/chantiers/{self.chantier_id}/financier', json={})
        self.assertEqual(res.status_code, 200, res.get_json())
        data = res.get_json()
        self.assertEqual(data['financier']['charge_materiel_prevue'], 0)
        self.assertEqual(data['financier']['taux_horaire'], 0)

    # --- CA lignes : dynamiques, 1 à 5 lignes (pas 3 champs fixes) ---

    def test_ca_ligne_requires_financier_first(self):
        res = self._post_ca_ligne('Adjugé', 1000, 10)
        self.assertEqual(res.status_code, 409)

    def test_ca_ligne_crud_une_seule_ligne(self):
        self._put_financier()
        res = self._post_ca_ligne('Adjugé', 5000, 50)
        self.assertEqual(res.status_code, 201, res.get_json())
        ligne_id = res.get_json()['id']

        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        data = res.get_json()
        self.assertEqual(len(data['ca_lignes']), 1)
        self.assertAlmostEqual(data['ca_prevu'], 5000, places=2)
        self.assertAlmostEqual(data['heures_prevues'], 50, places=2)

        res = self.client.put(f'/api/chantiers/{self.chantier_id}/ca_lignes/{ligne_id}', json={'montant': 6000})
        self.assertEqual(res.status_code, 200)
        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        self.assertAlmostEqual(res.get_json()['ca_prevu'], 6000, places=2)

        res = self.client.delete(f'/api/chantiers/{self.chantier_id}/ca_lignes/{ligne_id}')
        self.assertEqual(res.status_code, 200)
        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        self.assertEqual(res.get_json()['ca_lignes'], [])
        self.assertAlmostEqual(res.get_json()['ca_prevu'], 0, places=2)

    def test_ca_ligne_cinq_lignes(self):
        self._put_financier()
        for i in range(5):
            res = self._post_ca_ligne(f'Ligne {i}', 100 * (i + 1), 10 * (i + 1))
            self.assertEqual(res.status_code, 201)
        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        data = res.get_json()
        self.assertEqual(len(data['ca_lignes']), 5)
        self.assertAlmostEqual(data['ca_prevu'], 1500, places=2)  # 100+200+300+400+500
        self.assertAlmostEqual(data['heures_prevues'], 150, places=2)  # 10+20+30+40+50

    def test_ca_ligne_montant_negatif_rejete(self):
        self._put_financier()
        res = self._post_ca_ligne('x', -10, 0)
        self.assertEqual(res.status_code, 400)

    # --- Rejet des modifs manuelles sur estimation_petites_fournitures ---

    def test_reject_manual_crud_on_estimation_row(self):
        self._put_financier(charge_materiel_prevue=66824, pct_petites_fournitures=0.05)

        res = self.client.post(f'/api/chantiers/{self.chantier_id}/achats',
                                json={'libelle': 'Triche', 'montant': 1, 'type': 'estimation_petites_fournitures'})
        self.assertEqual(res.status_code, 400)

        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        estim = next(a for a in res.get_json()['achats'] if a['type'] == 'estimation_petites_fournitures')

        res = self.client.put(f'/api/chantiers/{self.chantier_id}/achats/{estim["id"]}', json={'montant': 1})
        self.assertEqual(res.status_code, 400)

        res = self.client.delete(f'/api/chantiers/{self.chantier_id}/achats/{estim["id"]}')
        self.assertEqual(res.status_code, 400)

    # --- Sync auto sur changement charge_materiel_prevue / pct_petites_fournitures ---

    def test_estimation_row_auto_syncs_on_update(self):
        self._put_financier(charge_materiel_prevue=1000, pct_petites_fournitures=0.10)
        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        achats = res.get_json()['achats']
        self.assertEqual(len(achats), 1)
        self.assertAlmostEqual(achats[0]['montant'], 100.0, places=2)

        # Change pct only -> estimation row updates, still exactly one row.
        self._put_financier(charge_materiel_prevue=1000, pct_petites_fournitures=0.20)
        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        achats = res.get_json()['achats']
        self.assertEqual(len(achats), 1)
        self.assertAlmostEqual(achats[0]['montant'], 200.0, places=2)

        # Change an unrelated field (taux_horaire) -> estimation amount stays put.
        self._put_financier(charge_materiel_prevue=1000, pct_petites_fournitures=0.20, taux_horaire=99)
        res = self.client.get(f'/api/chantiers/{self.chantier_id}/financier')
        achats = res.get_json()['achats']
        self.assertEqual(len(achats), 1)
        self.assertAlmostEqual(achats[0]['montant'], 200.0, places=2)

    # --- Validations ---

    def test_negative_montant_rejected(self):
        res = self._put_financier(charge_materiel_prevue=-5)
        self.assertEqual(res.status_code, 400)

        self._put_financier()
        res = self.client.post(f'/api/chantiers/{self.chantier_id}/acomptes',
                                json={'libelle': 'x', 'montant': -1, 'date': '2026-01-01'})
        self.assertEqual(res.status_code, 400)

        res = self.client.post(f'/api/chantiers/{self.chantier_id}/achats',
                                json={'libelle': 'x', 'montant': -1})
        self.assertEqual(res.status_code, 400)

    def test_acompte_invalid_date_rejected(self):
        self._put_financier()
        res = self.client.post(f'/api/chantiers/{self.chantier_id}/acomptes',
                                json={'libelle': 'x', 'montant': 100, 'date': '10/01/2026'})
        self.assertEqual(res.status_code, 400)

    def test_acompte_heures_optionnelle_et_modifiable(self):
        self._put_financier()
        res = self.client.post(f'/api/chantiers/{self.chantier_id}/acomptes',
                                json={'libelle': 'x', 'montant': 100, 'date': '2026-01-01'})
        self.assertEqual(res.status_code, 201)
        acompte = res.get_json()
        self.assertEqual(acompte['heures'], 0)  # défaut

        res = self.client.put(f'/api/chantiers/{self.chantier_id}/acomptes/{acompte["id"]}', json={'heures': 12.5})
        self.assertEqual(res.status_code, 200)
        self.assertAlmostEqual(res.get_json()['heures'], 12.5, places=2)


if __name__ == '__main__':
    unittest.main()
