"""Teste DELETE /api/chantiers/<id> — suppression complète et en cascade
d'un chantier "en attente" (Pot à chantier, has_assignments=False) :
admin-only, refusée si le chantier est déjà planifié, et supprime tout ce
qui lui est rattaché (DB + fichiers disque), sauf ChantierPrevision qui est
juste délié (chantier_id -> None), pas supprimé.

Isolation : même pattern que les autres tests API — importe app.py avec cwd
pointé sur un dossier temporaire.

Lancer : python -m unittest tests.test_chantier_cascade_delete -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_cascade_delete_test_')
_orig_cwd = os.getcwd()
os.chdir(_TEST_DIR)
try:
    import app as ohmapp  # noqa: E402
finally:
    os.chdir(_orig_cwd)

ohmapp.limiter.enabled = False  # même raison que test_auth.py

import atexit
atexit.register(lambda: shutil.rmtree(_TEST_DIR, ignore_errors=True))

STRONG_PASSWORD = 'Correct-Horse-Battery-99'


class ChantierCascadeDeleteTestCase(unittest.TestCase):
    def setUp(self):
        self.client = ohmapp.app.test_client()

    def _admin_client(self):
        # role='admin' est dans MFA_REQUIRED_ROLES — mint direct du token de
        # session plutôt que /api/login, même contournement que les autres
        # fichiers de test de cette suite.
        with ohmapp.app.app_context():
            admin = ohmapp.User(
                username=f'admin_{self._testMethodName}', role='admin',
                must_change_password=False, mfa_enabled=True,
                pin_hash=ohmapp.generate_password_hash('unused'),
            )
            admin.set_password(STRONG_PASSWORD)
            ohmapp.db.session.add(admin)
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': admin.id})
            admin_id = admin.id
        client = ohmapp.app.test_client()
        client.set_cookie(ohmapp.COOKIE_NAME, token)
        return client, admin_id

    def _user_client(self):
        with ohmapp.app.app_context():
            user = ohmapp.User(
                username=f'user_{self._testMethodName}', role='user',
                must_change_password=False, mfa_enabled=True,
                pin_hash=ohmapp.generate_password_hash('unused'),
            )
            user.set_password(STRONG_PASSWORD)
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
        client = ohmapp.app.test_client()
        res = client.post('/api/login', json={
            'username': f'user_{self._testMethodName}', 'password': STRONG_PASSWORD,
        })
        self.assertEqual(res.status_code, 200, res.get_json())
        return client

    def test_non_admin_forbidden(self):
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=f'C {self._testMethodName}', annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            chantier_id = chantier.id
        worker = self._user_client()
        res = worker.delete(f'/api/chantiers/{chantier_id}')
        self.assertEqual(res.status_code, 403)

    def test_rejected_if_already_planned(self):
        admin, admin_id = self._admin_client()
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=f'C {self._testMethodName}', annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            ohmapp.db.session.add(ohmapp.ChantierAssignment(
                chantier_id=chantier.id, user_id=admin_id,
                date_debut='2026-01-05', date_fin='2026-01-05',
            ))
            ohmapp.db.session.commit()
            chantier_id = chantier.id

        res = admin.delete(f'/api/chantiers/{chantier_id}')
        self.assertEqual(res.status_code, 400)
        with ohmapp.app.app_context():
            self.assertIsNotNone(ohmapp.db.session.get(ohmapp.Chantier, chantier_id))

    def test_unknown_chantier_404(self):
        admin, _ = self._admin_client()
        res = admin.delete('/api/chantiers/999999')
        self.assertEqual(res.status_code, 404)

    def test_cascade_deletes_everything_and_files_on_disk(self):
        admin, admin_id = self._admin_client()

        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=f'C {self._testMethodName}', annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            chantier_id = chantier.id

            # Une ligne dans chacune des tables rattachées.
            entry = ohmapp.Entry(user_id=admin_id, chantier_id=chantier_id, date='2026-01-05',
                                  heures=1, status='PENDING', description='x')
            alert = ohmapp.Alert(chantier_id=chantier_id, title='Alerte test', description='Alerte test')
            financier = ohmapp.ChantierFinancier(chantier_id=chantier_id)
            ca_ligne = ohmapp.CaLignePrevue(chantier_id=chantier_id, libelle='CA', montant=100, heures=1)
            acompte = ohmapp.Acompte(chantier_id=chantier_id, libelle='Acompte', montant=50, heures=0, date='2026-01-05')
            achat = ohmapp.AchatMateriel(chantier_id=chantier_id, libelle='Achat', montant=20, type='facture')
            volta_link = ohmapp.VoltaDocumentLink(chantier_id=chantier_id, numero_projet='P1', numero_facture='F1')
            ohmapp.db.session.add_all([entry, alert, financier, ca_ligne, acompte, achat, volta_link])
            ohmapp.db.session.commit()

            document = ohmapp.Document(
                chantier_id=chantier_id, category='document', filename='test.pdf',
                original_filename='test.pdf', uploaded_by_id=admin_id,
            )
            ohmapp.db.session.add(document)
            ohmapp.db.session.commit()

            # Fichier réel sur disque, dans le dossier du chantier.
            doc_dir = ohmapp.category_dir(chantier, 'document')
            disk_path = os.path.join(doc_dir, 'test.pdf')
            with open(disk_path, 'w') as f:
                f.write('dummy')
            storage_dir_path = ohmapp.chantier_storage_dir(chantier)
            self.assertTrue(os.path.isfile(disk_path))

            # ChantierPrevision lié — doit survivre, juste délié.
            prevision = ohmapp.ChantierPrevision(nom='Prevision liée', chantier_id=chantier_id, statut='confirme')
            ohmapp.db.session.add(prevision)
            ohmapp.db.session.commit()
            prevision_id = prevision.id

        res = admin.delete(f'/api/chantiers/{chantier_id}')
        self.assertEqual(res.status_code, 200, res.get_json())

        with ohmapp.app.app_context():
            self.assertIsNone(ohmapp.db.session.get(ohmapp.Chantier, chantier_id))
            self.assertEqual(ohmapp.Entry.query.filter_by(chantier_id=chantier_id).count(), 0)
            self.assertEqual(ohmapp.Alert.query.filter_by(chantier_id=chantier_id).count(), 0)
            self.assertIsNone(ohmapp.ChantierFinancier.query.filter_by(chantier_id=chantier_id).first())
            self.assertEqual(ohmapp.CaLignePrevue.query.filter_by(chantier_id=chantier_id).count(), 0)
            self.assertEqual(ohmapp.Acompte.query.filter_by(chantier_id=chantier_id).count(), 0)
            self.assertEqual(ohmapp.AchatMateriel.query.filter_by(chantier_id=chantier_id).count(), 0)
            self.assertEqual(ohmapp.VoltaDocumentLink.query.filter_by(chantier_id=chantier_id).count(), 0)
            self.assertEqual(ohmapp.Document.query.filter_by(chantier_id=chantier_id).count(), 0)

            # ChantierPrevision survit, juste délié.
            prevision = ohmapp.db.session.get(ohmapp.ChantierPrevision, prevision_id)
            self.assertIsNotNone(prevision)
            self.assertIsNone(prevision.chantier_id)

        self.assertFalse(os.path.isfile(disk_path))
        self.assertFalse(os.path.isdir(storage_dir_path))


if __name__ == '__main__':
    unittest.main()
