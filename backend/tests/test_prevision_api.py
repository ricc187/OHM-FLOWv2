"""Tests du module de prévision annuelle : modèle ChantierPrevision +
endpoints CRUD /api/prevision + import /api/prevision/import.

Module isolé : pas de dépendance vers l'Agenda / chantier_assignments /
financier — l'import ne lit que Chantier.date_start/date_end, en lecture
seule, jamais d'écriture vers `chantiers`.

Isolation : importe app.py avec cwd pointé sur un dossier temporaire, donc
data/chantier.db et data/uploads/ se créent là (jamais dans le vrai data/ du
projet) — voir le bloc d'import ci-dessous, avant toute autre importation.

Lancer : python -m unittest tests.test_prevision_api -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_prevision_test_')
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


class PrevisionApiTestCase(unittest.TestCase):
    """Une seule app/DB en mémoire pour toute la classe — chaque test crée ses
    propres lignes chantiers_prevision (et, si besoin, ses propres chantiers
    réels) pour rester isolé des autres tests."""

    @classmethod
    def setUpClass(cls):
        cls.client = ohmapp.app.test_client()
        with ohmapp.app.app_context():
            admin = ohmapp.User.query.filter_by(username='Admin').first()
            cls.token = ohmapp.serializer.dumps({'user_id': admin.id})
            cls.admin_id = admin.id
        cls.client.set_cookie(ohmapp.COOKIE_NAME, cls.token)

    def _create_real_chantier(self, nom, date_start=None, date_end=None, annee=2026):
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=nom, annee=annee, status='ACTIVE',
                                        date_start=date_start, date_end=date_end)
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            return chantier.id

    def _post_prevision(self, **overrides):
        body = {'nom': 'Chantier test prevision'}
        body.update(overrides)
        return self.client.post('/api/prevision', json=body)

    # --- Modèle / table ---

    def test_table_exists_with_expected_columns(self):
        with ohmapp.app.app_context():
            inspector = ohmapp.inspect(ohmapp.db.engine)
            self.assertIn('chantiers_prevision', inspector.get_table_names())
            cols = {c['name'] for c in inspector.get_columns('chantiers_prevision')}
            expected = {'id', 'nom', 'referent_id', 'montant_estime',
                        'date_debut_theorique', 'date_fin_theorique', 'statut',
                        'chantier_id', 'created_at'}
            self.assertTrue(expected.issubset(cols), cols)

    # --- CRUD ---

    def test_create_prevu_minimal(self):
        res = self._post_prevision(nom='Villa Dupont')
        self.assertEqual(res.status_code, 201, res.get_json())
        data = res.get_json()
        self.assertEqual(data['nom'], 'Villa Dupont')
        self.assertEqual(data['statut'], 'prevu')
        self.assertIsNone(data['chantier_id'])
        self.assertIsNone(data['montant_estime'])

    def test_create_requires_nom(self):
        res = self._post_prevision(nom='   ')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/prevision', json={})
        self.assertEqual(res.status_code, 400)

    def test_create_full_payload(self):
        res = self._post_prevision(
            nom='Rénovation Sion', montant_estime=45000,
            date_debut_theorique='2026-03-01', date_fin_theorique='2026-05-31',
            referent_id=self.admin_id,
        )
        self.assertEqual(res.status_code, 201, res.get_json())
        data = res.get_json()
        self.assertEqual(data['montant_estime'], 45000)
        self.assertEqual(data['referent_id'], self.admin_id)
        self.assertEqual(data['referent_username'], 'Admin')
        self.assertEqual(data['date_debut_theorique'], '2026-03-01')

    def test_create_invalid_statut_rejected(self):
        res = self._post_prevision(statut='bogus')
        self.assertEqual(res.status_code, 400)

    def test_create_unknown_referent_rejected(self):
        res = self._post_prevision(referent_id=999999)
        self.assertEqual(res.status_code, 400)

    def test_create_unknown_chantier_id_rejected(self):
        res = self._post_prevision(chantier_id=999999)
        self.assertEqual(res.status_code, 400)

    def test_create_negative_montant_rejected(self):
        res = self._post_prevision(montant_estime=-1)
        self.assertEqual(res.status_code, 400)

    def test_create_invalid_date_rejected(self):
        res = self._post_prevision(date_debut_theorique='01/03/2026')
        self.assertEqual(res.status_code, 400)

    def test_create_date_range_inverted_rejected(self):
        res = self._post_prevision(date_debut_theorique='2026-06-01', date_fin_theorique='2026-01-01')
        self.assertEqual(res.status_code, 400)

    def test_get_list_and_detail(self):
        created = self._post_prevision(nom='Get me').get_json()
        res = self.client.get('/api/prevision')
        self.assertEqual(res.status_code, 200)
        ids = [p['id'] for p in res.get_json()]
        self.assertIn(created['id'], ids)

        res = self.client.get(f"/api/prevision/{created['id']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['nom'], 'Get me')

        res = self.client.get('/api/prevision/999999')
        self.assertEqual(res.status_code, 404)

    def test_list_filter_by_statut(self):
        self._post_prevision(nom='Prevu 1', statut='prevu')
        chantier_id = self._create_real_chantier('Reel 1')
        self._post_prevision(nom='Reel 1', statut='confirme', chantier_id=chantier_id)

        res = self.client.get('/api/prevision?statut=confirme')
        self.assertEqual(res.status_code, 200)
        for p in res.get_json():
            self.assertEqual(p['statut'], 'confirme')

        res = self.client.get('/api/prevision?statut=bogus')
        self.assertEqual(res.status_code, 400)

    def test_list_filter_by_annee(self):
        self._post_prevision(nom='Annee 2026', date_debut_theorique='2026-02-01', date_fin_theorique='2026-02-20')
        self._post_prevision(nom='Annee 2027', date_debut_theorique='2027-02-01', date_fin_theorique='2027-02-20')

        res = self.client.get('/api/prevision?annee=2027')
        self.assertEqual(res.status_code, 200)
        noms = [p['nom'] for p in res.get_json()]
        self.assertIn('Annee 2027', noms)
        self.assertNotIn('Annee 2026', noms)

    def test_update_partial(self):
        created = self._post_prevision(nom='A modifier').get_json()
        res = self.client.put(f"/api/prevision/{created['id']}", json={'montant_estime': 12345})
        self.assertEqual(res.status_code, 200, res.get_json())
        data = res.get_json()
        self.assertEqual(data['montant_estime'], 12345)
        self.assertEqual(data['nom'], 'A modifier')  # untouched

        res = self.client.put(f"/api/prevision/{created['id']}", json={'nom': '   '})
        self.assertEqual(res.status_code, 400)

        res = self.client.put('/api/prevision/999999', json={'nom': 'x'})
        self.assertEqual(res.status_code, 404)

    def test_update_statut_to_confirme_with_chantier_link(self):
        created = self._post_prevision(nom='Devient reel').get_json()
        chantier_id = self._create_real_chantier('Le vrai chantier')
        res = self.client.put(f"/api/prevision/{created['id']}",
                               json={'statut': 'confirme', 'chantier_id': chantier_id})
        self.assertEqual(res.status_code, 200, res.get_json())
        data = res.get_json()
        self.assertEqual(data['statut'], 'confirme')
        self.assertEqual(data['chantier_id'], chantier_id)

    def test_delete(self):
        created = self._post_prevision(nom='A supprimer').get_json()
        res = self.client.delete(f"/api/prevision/{created['id']}")
        self.assertEqual(res.status_code, 200)
        res = self.client.get(f"/api/prevision/{created['id']}")
        self.assertEqual(res.status_code, 404)

        res = self.client.delete('/api/prevision/999999')
        self.assertEqual(res.status_code, 404)

    # --- Import (lecture seule depuis chantiers) ---

    def test_import_creates_confirme_rows_from_real_chantiers(self):
        c1 = self._create_real_chantier('Import A', date_start='2026-04-01', date_end='2026-04-30')
        c2 = self._create_real_chantier('Import B')  # pas de dates -> reste vide

        res = self.client.post('/api/prevision/import')
        self.assertEqual(res.status_code, 200, res.get_json())
        data = res.get_json()
        self.assertGreaterEqual(data['created_count'], 2)

        by_chantier_id = {p['chantier_id']: p for p in data['created']}
        self.assertEqual(by_chantier_id[c1]['statut'], 'confirme')
        self.assertEqual(by_chantier_id[c1]['date_debut_theorique'], '2026-04-01')
        self.assertEqual(by_chantier_id[c1]['date_fin_theorique'], '2026-04-30')
        self.assertIsNone(by_chantier_id[c2]['date_debut_theorique'])

    def test_import_is_idempotent_and_never_writes_to_chantiers(self):
        c1 = self._create_real_chantier('Import Idempotent', date_start='2026-05-01', date_end='2026-05-10')

        res1 = self.client.post('/api/prevision/import')
        self.assertEqual(res1.status_code, 200)

        with ohmapp.app.app_context():
            chantier_before = ohmapp.db.session.get(ohmapp.Chantier, c1)
            snapshot = chantier_before.to_dict()

        # Second run must not duplicate the already-imported chantier, and
        # must leave the source `chantiers` row byte-for-byte untouched
        # (read-only contract).
        res2 = self.client.post('/api/prevision/import')
        self.assertEqual(res2.status_code, 200)
        data2 = res2.get_json()
        self.assertNotIn(c1, [p['chantier_id'] for p in data2['created']])

        with ohmapp.app.app_context():
            chantier_after = ohmapp.db.session.get(ohmapp.Chantier, c1)
            self.assertEqual(chantier_after.to_dict(), snapshot)

        with ohmapp.app.app_context():
            rows = ohmapp.ChantierPrevision.query.filter_by(chantier_id=c1).all()
            self.assertEqual(len(rows), 1)

    def test_import_does_not_clobber_manually_edited_dates(self):
        c1 = self._create_real_chantier('Import Edite', date_start='2026-06-01', date_end='2026-06-10')
        res = self.client.post('/api/prevision/import')
        prevision_id = next(p['id'] for p in res.get_json()['created'] if p['chantier_id'] == c1)

        self.client.put(f'/api/prevision/{prevision_id}', json={'date_fin_theorique': '2026-06-20'})

        self.client.post('/api/prevision/import')  # re-run
        res = self.client.get(f'/api/prevision/{prevision_id}')
        self.assertEqual(res.get_json()['date_fin_theorique'], '2026-06-20')

    # --- Auth ---

    def test_requires_auth(self):
        anon = ohmapp.app.test_client()
        self.assertEqual(anon.get('/api/prevision').status_code, 401)
        self.assertEqual(anon.post('/api/prevision', json={'nom': 'x'}).status_code, 401)
        self.assertEqual(anon.post('/api/prevision/import').status_code, 401)

    def test_requires_admin(self):
        with ohmapp.app.app_context():
            user = ohmapp.User(username=f'plain_{self._testMethodName}', pin_hash='x',
                                role='user', password_hash=None)
            user.set_password('irrelevant-but-valid-Passw0rd!')
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': user.id})
        client = ohmapp.app.test_client()
        client.set_cookie(ohmapp.COOKIE_NAME, token)
        self.assertEqual(client.get('/api/prevision').status_code, 403)
        self.assertEqual(client.post('/api/prevision', json={'nom': 'x'}).status_code, 403)
        self.assertEqual(client.post('/api/prevision/import').status_code, 403)


if __name__ == '__main__':
    unittest.main()
