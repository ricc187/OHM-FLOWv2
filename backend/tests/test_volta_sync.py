"""Tests du module de synchro Volta : VoltaDocumentLink, VoltaApiCallLog,
process_volta_sync_queue() et l'endpoint POST /api/volta-sync/run.

Les deux fonctions injectables (fetch_invoice_amount,
fetch_project_offers_or_contracts) sont TOUJOURS passées explicitement en
mock ici — jamais les vraies (celles du module, branchées sur le vrai
Volta depuis l'étape 2) : ces tests ne doivent JAMAIS faire de vrai appel
réseau. Ça marche par construction tant que ce process n'a pas
VOLTA_API_BASE_URL/VOLTA_USERNAME/etc. dans son environnement (jamais le
cas ici — .env n'est pas chargé par ce fichier ni par app.py) : les vraies
fonctions échouent alors immédiatement avec VoltaSyncError avant tout appel
réseau (voir test_default_functions_fail_fast_without_volta_env_vars) —
un filet de sécurité, pas une excuse pour s'appuyer dessus ailleurs que
dans ces deux tests dédiés.

La validation d'un VRAI branchement Volta (étape 2) s'est faite
manuellement, hors suite automatisée (voir VOLTA_API_NOTES.md et le
rapport de cette passe) — jamais dans ce fichier, pour ne pas consommer le
quota Volta à chaque lancement de la suite de tests.

Isolation : importe app.py avec cwd pointé sur un dossier temporaire, comme
test_prevision_api.py.

Lancer : python -m unittest tests.test_volta_sync -v   (depuis backend/)
"""
import os
import sys
import shutil
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-unittests-only')
# Doit être positionné AVANT `import app` : app.py démarre le thread de cron
# Volta au niveau module (juste après init_db()), gardé par cette variable —
# sans ça, importer app.py ici démarrerait un vrai thread de fond qui
# tournerait pendant (et après) toute la suite. Voir test_cron_thread_does_not_start_during_tests.
os.environ['OHM_DISABLE_VOLTA_CRON'] = '1'

_TEST_DIR = tempfile.mkdtemp(prefix='ohmflow_volta_sync_test_')
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


def _ok_invoice(montant=2734.8):
    def _fetch(numero_facture):
        return {'montant': montant}
    return _fetch


def _failing_fetch(message='boom'):
    def _fetch(*args, **kwargs):
        raise ohmapp.VoltaSyncError(message)
    return _fetch


def _ok_offers(offers):
    calls = []

    def _fetch(numero_projet):
        calls.append(numero_projet)
        return offers
    _fetch.calls = calls
    return _fetch


class VoltaSyncTestCase(unittest.TestCase):
    """Une seule app/DB en mémoire pour toute la classe — chaque test crée
    ses propres chantiers/links pour rester isolé, et nettoie
    VoltaApiCallLog avant de s'exécuter pour ne jamais hériter du quota
    consommé par un test précédent (le rate-limit est un état global,
    contrairement au reste)."""

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
            ohmapp.VoltaApiCallLog.query.delete()
            # process_volta_sync_queue()/l'endpoint /api/volta-sync/run
            # traitent TOUTES les entrées 'en_attente' tous chantiers
            # confondus — un test qui en laisse une derrière (ex: le gating
            # de clôture n'en consomme aucune, il vérifie juste qu'il en
            # existe une 'synced') pollue sinon n'importe quel test suivant
            # qui appelle le worker global. Table repartie à vide à chaque
            # test pour rester déterministe quel que soit l'ordre.
            ohmapp.VoltaDocumentLink.query.delete()
            ohmapp.db.session.commit()

    def _create_chantier(self, nom):
        with ohmapp.app.app_context():
            chantier = ohmapp.Chantier(nom=nom, annee=2026, status='ACTIVE')
            ohmapp.db.session.add(chantier)
            ohmapp.db.session.commit()
            return chantier.id

    def _create_link(self, chantier_id, numero_projet='024042.001', numero_facture='7098', numero_offre=None, statut_sync='en_attente'):
        with ohmapp.app.app_context():
            link = ohmapp.VoltaDocumentLink(
                chantier_id=chantier_id, numero_projet=numero_projet,
                numero_facture=numero_facture, numero_offre=numero_offre,
                statut_sync=statut_sync,
            )
            ohmapp.db.session.add(link)
            ohmapp.db.session.commit()
            return link.id

    def _reload_link(self, link_id):
        with ohmapp.app.app_context():
            return ohmapp.db.session.get(ohmapp.VoltaDocumentLink, link_id)

    # --- Modèle / tables ---

    def test_tables_exist_with_expected_columns(self):
        with ohmapp.app.app_context():
            inspector = ohmapp.inspect(ohmapp.db.engine)
            tables = inspector.get_table_names()
            self.assertIn('volta_document_links', tables)
            self.assertIn('volta_api_call_log', tables)

            link_cols = {c['name'] for c in inspector.get_columns('volta_document_links')}
            self.assertTrue({
                'id', 'chantier_id', 'numero_projet', 'numero_facture', 'numero_offre',
                'statut_sync', 'derniere_sync_at', 'erreur_message', 'created_at',
            }.issubset(link_cols), link_cols)

            log_cols = {c['name'] for c in inspector.get_columns('volta_api_call_log')}
            self.assertTrue({'id', 'called_at', 'endpoint', 'succes'}.issubset(log_cols), log_cols)

    def test_no_separate_queue_table(self):
        # Décision documentée : la file FIFO est directement
        # VoltaDocumentLink.statut_sync='en_attente', pas de table à part.
        with ohmapp.app.app_context():
            inspector = ohmapp.inspect(ohmapp.db.engine)
            self.assertNotIn('volta_sync_queue', inspector.get_table_names())

    def test_default_functions_fail_fast_without_volta_env_vars(self):
        # Depuis l'étape 2, les vraies fonctions du module font de vrais
        # appels HTTP — mais ce process de test n'a jamais les variables
        # d'environnement Volta (VOLTA_API_BASE_URL etc., voir .env, jamais
        # chargé ici), donc elles doivent échouer par VoltaSyncError AVANT
        # toute tentative réseau, jamais par un KeyError brut ni un vrai
        # appel sortant.
        for key in ('VOLTA_API_BASE_URL', 'VOLTA_USERNAME', 'VOLTA_PASSWORD', 'VOLTA_CLIENT_ACCOUNT_CODE', 'VOLTA_ORG_UNIT_PROJECTS'):
            self.assertNotIn(key, os.environ, f"{key} ne doit pas être défini pendant cette suite de tests (sécurité anti-appel-réseau)")
        with self.assertRaises(ohmapp.VoltaSyncError):
            ohmapp.fetch_invoice_amount('7098')
        with self.assertRaises(ohmapp.VoltaSyncError):
            ohmapp.fetch_project_offers_or_contracts('024042.001')

    # --- Cas nominal : facture seule ---

    def test_invoice_only_success_upserts_acompte(self):
        chantier_id = self._create_chantier('Baita sync 1')
        link_id = self._create_link(chantier_id, numero_facture='7098')

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(2734.8))
        self.assertEqual(result, {'processed': 1, 'stopped_reason': None})

        link = self._reload_link(link_id)
        self.assertEqual(link.statut_sync, 'synced')
        self.assertIsNotNone(link.derniere_sync_at)
        self.assertIsNone(link.erreur_message)

        with ohmapp.app.app_context():
            acompte = ohmapp.Acompte.query.filter_by(chantier_id=chantier_id).first()
            self.assertIsNotNone(acompte)
            self.assertEqual(acompte.libelle, 'Facture 7098')
            self.assertEqual(acompte.montant, 2734.8)

    def test_invoice_upsert_updates_existing_acompte_not_duplicate(self):
        chantier_id = self._create_chantier('Baita sync upsert')
        link_id = self._create_link(chantier_id, numero_facture='7098')

        with ohmapp.app.app_context():
            ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(1000.0))
        with ohmapp.app.app_context():
            ohmapp.VoltaDocumentLink.query.filter_by(id=link_id).update({'statut_sync': 'en_attente'})
            ohmapp.db.session.commit()
        with ohmapp.app.app_context():
            ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(2734.8))

        with ohmapp.app.app_context():
            acomptes = ohmapp.Acompte.query.filter_by(chantier_id=chantier_id).all()
            self.assertEqual(len(acomptes), 1)  # pas de doublon
            self.assertEqual(acomptes[0].montant, 2734.8)  # dernière valeur gagne

    def test_api_call_logged_on_success(self):
        chantier_id = self._create_chantier('Baita log')
        self._create_link(chantier_id)
        with ohmapp.app.app_context():
            ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice())
            logs = ohmapp.VoltaApiCallLog.query.all()
            self.assertEqual(len(logs), 1)
            self.assertEqual(logs[0].endpoint, 'fetch_invoice_amount')
            self.assertTrue(logs[0].succes)

    # --- Erreur ---

    def test_invoice_failure_marks_erreur_and_logs_failed_call(self):
        chantier_id = self._create_chantier('Baita erreur')
        link_id = self._create_link(chantier_id)

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_failing_fetch('facture introuvable'))
        self.assertEqual(result, {'processed': 1, 'stopped_reason': None})

        link = self._reload_link(link_id)
        self.assertEqual(link.statut_sync, 'erreur')
        self.assertIn('facture introuvable', link.erreur_message)

        with ohmapp.app.app_context():
            logs = ohmapp.VoltaApiCallLog.query.all()
            self.assertEqual(len(logs), 1)
            self.assertFalse(logs[0].succes)
            acompte = ohmapp.Acompte.query.filter_by(chantier_id=chantier_id).first()
            self.assertIsNone(acompte)  # rien upserté sur échec

    def test_error_does_not_block_the_queue(self):
        c1 = self._create_chantier('Erreur 1')
        c2 = self._create_chantier('OK apres erreur')
        link1 = self._create_link(c1, numero_facture='FAIL')
        link2 = self._create_link(c2, numero_facture='7098')

        calls = {'n': 0}

        def flaky(numero_facture):
            calls['n'] += 1
            if numero_facture == 'FAIL':
                raise ohmapp.VoltaSyncError('échec simulé')
            return {'montant': 42.0}

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=flaky)
        self.assertEqual(result, {'processed': 2, 'stopped_reason': None})
        self.assertEqual(self._reload_link(link1).statut_sync, 'erreur')
        self.assertEqual(self._reload_link(link2).statut_sync, 'synced')

    # --- Offre + cache projet ---

    def test_offer_upserts_ca_ligne_and_materiel(self):
        chantier_id = self._create_chantier('Baita offre')
        link_id = self._create_link(chantier_id, numero_offre='7747')
        offers_fetch = _ok_offers([
            {'numero_offre': '7747', 'montant': 145750.05, 'heures': 1052.0, 'materiel': 66824.0},
        ])

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(), fetch_project_offers_or_contracts=offers_fetch)
        self.assertEqual(result, {'processed': 1, 'stopped_reason': None})
        self.assertEqual(self._reload_link(link_id).statut_sync, 'synced')

        with ohmapp.app.app_context():
            ligne = ohmapp.CaLignePrevue.query.filter_by(chantier_id=chantier_id).first()
            self.assertIsNotNone(ligne)
            self.assertEqual(ligne.libelle, 'Offre 7747')
            self.assertEqual(ligne.montant, 145750.05)
            self.assertEqual(ligne.heures, 1052.0)

            financier = ohmapp.ChantierFinancier.query.filter_by(chantier_id=chantier_id).first()
            self.assertIsNotNone(financier)
            self.assertEqual(financier.charge_materiel_prevue, 66824.0)

    def test_offer_without_materiel_does_not_clobber_existing_charge_materiel(self):
        chantier_id = self._create_chantier('Baita offre sans materiel')
        with ohmapp.app.app_context():
            ohmapp.db.session.add(ohmapp.ChantierFinancier(chantier_id=chantier_id, charge_materiel_prevue=999.0))
            ohmapp.db.session.commit()

        link_id = self._create_link(chantier_id, numero_offre='7747')
        offers_fetch = _ok_offers([
            {'numero_offre': '7747', 'montant': 100.0, 'heures': 1.0, 'materiel': None},
        ])

        with ohmapp.app.app_context():
            ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(), fetch_project_offers_or_contracts=offers_fetch)

        with ohmapp.app.app_context():
            financier = ohmapp.ChantierFinancier.query.filter_by(chantier_id=chantier_id).first()
            self.assertEqual(financier.charge_materiel_prevue, 999.0)  # inchangé

    def test_multiple_offers_same_chantier_sum_materiel(self):
        # Décision explicite : plusieurs offres du même chantier fournissant
        # chacune un montant matériel -> la charge matériel prévue est leur
        # SOMME, pas la dernière valeur traitée qui écraserait les autres.
        chantier_id = self._create_chantier('Baita materiel cumule')
        self._create_link(chantier_id, numero_projet='024042.001', numero_facture='F1', numero_offre='7747')
        self._create_link(chantier_id, numero_projet='024042.001', numero_facture='F2', numero_offre='6638')
        offers_fetch = _ok_offers([
            {'numero_offre': '7747', 'montant': 100.0, 'heures': 1.0, 'materiel': 100.0},
            {'numero_offre': '6638', 'montant': 200.0, 'heures': 2.0, 'materiel': 50.0},
        ])

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(), fetch_project_offers_or_contracts=offers_fetch)
        self.assertEqual(result, {'processed': 2, 'stopped_reason': None})

        with ohmapp.app.app_context():
            financier = ohmapp.ChantierFinancier.query.filter_by(chantier_id=chantier_id).first()
            self.assertEqual(financier.charge_materiel_prevue, 150.0)  # 100 + 50, pas 50 (dernière valeur)

    def test_offer_not_found_in_project_marks_erreur(self):
        chantier_id = self._create_chantier('Baita offre absente')
        link_id = self._create_link(chantier_id, numero_offre='9999')
        offers_fetch = _ok_offers([{'numero_offre': '7747', 'montant': 1.0, 'heures': 0.0}])

        with ohmapp.app.app_context():
            ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(), fetch_project_offers_or_contracts=offers_fetch)

        link = self._reload_link(link_id)
        self.assertEqual(link.statut_sync, 'erreur')
        self.assertIn('9999', link.erreur_message)

    def test_project_cache_hit_avoids_second_call_same_run(self):
        c1 = self._create_chantier('Meme projet 1')
        c2 = self._create_chantier('Meme projet 2')
        self._create_link(c1, numero_projet='024042.001', numero_facture='A1', numero_offre='7747')
        self._create_link(c2, numero_projet='024042.001', numero_facture='A2', numero_offre='6638')
        offers_fetch = _ok_offers([
            {'numero_offre': '7747', 'montant': 145750.05, 'heures': 1052.0},
            {'numero_offre': '6638', 'montant': 3074.8, 'heures': 0.0},
        ])

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(), fetch_project_offers_or_contracts=offers_fetch)
        self.assertEqual(result, {'processed': 2, 'stopped_reason': None})
        self.assertEqual(len(offers_fetch.calls), 1)  # 1 seul appel pour les 2 entrées du même projet

        with ohmapp.app.app_context():
            logs = ohmapp.VoltaApiCallLog.query.filter_by(endpoint='fetch_project_offers_or_contracts').all()
            self.assertEqual(len(logs), 1)

    def test_project_cache_is_local_to_one_run_not_persisted(self):
        c1 = self._create_chantier('Cache non persiste 1')
        c2 = self._create_chantier('Cache non persiste 2')
        link1 = self._create_link(c1, numero_projet='024042.001', numero_facture='A1', numero_offre='7747')
        offers_fetch = _ok_offers([{'numero_offre': '7747', 'montant': 1.0, 'heures': 0.0}])

        with ohmapp.app.app_context():
            ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(), fetch_project_offers_or_contracts=offers_fetch)
        self.assertEqual(len(offers_fetch.calls), 1)

        # Deuxième entrée créée APRÈS le premier run, même projet : un
        # deuxième appel à process_volta_sync_queue() ne doit PAS réutiliser
        # le cache du run précédent (il est local à l'appel de fonction).
        self._create_link(c2, numero_projet='024042.001', numero_facture='A2', numero_offre='7747')
        with ohmapp.app.app_context():
            ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice(), fetch_project_offers_or_contracts=offers_fetch)
        self.assertEqual(len(offers_fetch.calls), 2)

    # --- Rate limit ---

    def test_rate_limit_stops_cycle_and_leaves_rest_en_attente(self):
        chantiers = [self._create_chantier(f'RL {i}') for i in range(3)]
        links = [self._create_link(c, numero_facture=f'F{i}') for i, c in enumerate(chantiers)]

        with ohmapp.app.app_context():
            for _ in range(ohmapp.VOLTA_SYNC_RATE_LIMIT_PER_HOUR):
                ohmapp.db.session.add(ohmapp.VoltaApiCallLog(endpoint='fetch_invoice_amount', succes=True))
            ohmapp.db.session.commit()

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice())
        self.assertEqual(result, {'processed': 0, 'stopped_reason': 'rate_limit'})

        for link_id in links:
            self.assertEqual(self._reload_link(link_id).statut_sync, 'en_attente')

    def test_rate_limit_reached_mid_cycle_stops_remaining_entries(self):
        # Seuil - 1 appel déjà consommé : la 1ère entrée (1 appel facture,
        # pas d'offre) passe encore, la 2e doit être bloquée par le
        # rate-limit avant même d'être tentée.
        c1 = self._create_chantier('Mid cycle 1')
        c2 = self._create_chantier('Mid cycle 2')
        link1 = self._create_link(c1, numero_facture='F1')
        link2 = self._create_link(c2, numero_facture='F2')

        with ohmapp.app.app_context():
            for _ in range(ohmapp.VOLTA_SYNC_RATE_LIMIT_PER_HOUR - 1):
                ohmapp.db.session.add(ohmapp.VoltaApiCallLog(endpoint='fetch_invoice_amount', succes=True))
            ohmapp.db.session.commit()

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice())
        self.assertEqual(result, {'processed': 1, 'stopped_reason': 'rate_limit'})
        self.assertEqual(self._reload_link(link1).statut_sync, 'synced')
        self.assertEqual(self._reload_link(link2).statut_sync, 'en_attente')

    def test_calls_older_than_one_hour_do_not_count(self):
        chantier_id = self._create_chantier('Vieux appels')
        self._create_link(chantier_id)

        with ohmapp.app.app_context():
            old = ohmapp.datetime.datetime.utcnow() - ohmapp.datetime.timedelta(hours=2)
            for _ in range(ohmapp.VOLTA_SYNC_RATE_LIMIT_PER_HOUR + 5):
                ohmapp.db.session.add(ohmapp.VoltaApiCallLog(endpoint='fetch_invoice_amount', succes=True, called_at=old))
            ohmapp.db.session.commit()

        with ohmapp.app.app_context():
            result = ohmapp.process_volta_sync_queue(fetch_invoice_amount=_ok_invoice())
        self.assertEqual(result, {'processed': 1, 'stopped_reason': None})

    # --- Endpoint ---

    def test_endpoint_requires_auth(self):
        anon = ohmapp.app.test_client()
        self.assertEqual(anon.post('/api/volta-sync/run').status_code, 401)

    def test_endpoint_requires_admin(self):
        with ohmapp.app.app_context():
            user = ohmapp.User(username=f'plain_{self._testMethodName}', pin_hash='x', role='user', password_hash=None)
            user.set_password('irrelevant-but-valid-Passw0rd!')
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': user.id})
        client = ohmapp.app.test_client()
        client.set_cookie(ohmapp.COOKIE_NAME, token)
        self.assertEqual(client.post('/api/volta-sync/run').status_code, 403)

    def test_endpoint_runs_with_default_functions_and_stays_safe_without_volta_env(self):
        # Sans override (chemin par défaut de l'endpoint HTTP) et sans
        # variables d'environnement Volta dans ce process de test, le worker
        # utilise les vraies fonctions du module — qui échouent par
        # VoltaSyncError (variable d'environnement manquante) avant tout
        # appel réseau. process_volta_sync_queue() catche ça comme n'importe
        # quelle erreur Volta : la ligne passe 'erreur', l'endpoint répond
        # 200 (pas de crash serveur, pas de vrai appel réseau tenté).
        chantier_id = self._create_chantier('Endpoint sans override')
        self._create_link(chantier_id)
        res = self.client.post('/api/volta-sync/run')
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['processed'], 1)
        with ohmapp.app.app_context():
            link = ohmapp.VoltaDocumentLink.query.filter_by(chantier_id=chantier_id).first()
            self.assertEqual(link.statut_sync, 'erreur')
            self.assertIn('Variable d', link.erreur_message or '')

    # --- Blocage de clôture (même pattern/emplacement que l'ancien gating
    # Mesures/Rapport d'intervention — PUT /api/chantiers/<id>) ---

    def test_closure_blocked_without_any_link(self):
        chantier_id = self._create_chantier('Cloture sans link')
        res = self.client.put(f'/api/chantiers/{chantier_id}', json={'status': 'DONE'})
        self.assertEqual(res.status_code, 409)
        self.assertIn('Volta', res.get_json()['error'])
        with ohmapp.app.app_context():
            chantier = ohmapp.db.session.get(ohmapp.Chantier, chantier_id)
            self.assertEqual(chantier.status, 'ACTIVE')  # inchangé

    def test_closure_blocked_with_only_en_attente_or_erreur_links(self):
        chantier_id = self._create_chantier('Cloture liens pas synced')
        self._create_link(chantier_id, numero_facture='F1', statut_sync='en_attente')
        self._create_link(chantier_id, numero_facture='F2', statut_sync='erreur')
        res = self.client.put(f'/api/chantiers/{chantier_id}', json={'status': 'DONE'})
        self.assertEqual(res.status_code, 409)

    def test_closure_allowed_with_at_least_one_synced_link(self):
        chantier_id = self._create_chantier('Cloture link synced')
        self._create_link(chantier_id, numero_facture='F1', statut_sync='en_attente')
        self._create_link(chantier_id, numero_facture='F2', statut_sync='synced')
        res = self.client.put(f'/api/chantiers/{chantier_id}', json={'status': 'DONE'})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()['status'], 'DONE')

    def test_closure_gating_only_checked_on_real_transition(self):
        chantier_id = self._create_chantier('Deja DONE')
        self._create_link(chantier_id, statut_sync='synced')
        res = self.client.put(f'/api/chantiers/{chantier_id}', json={'status': 'DONE'})
        self.assertEqual(res.status_code, 200, res.get_json())

        # Le lien synced disparaît après coup ; renvoyer status=DONE (déjà
        # DONE, pas une vraie transition) ne doit PAS redéclencher le
        # contrôle.
        with ohmapp.app.app_context():
            ohmapp.VoltaDocumentLink.query.filter_by(chantier_id=chantier_id).delete()
            ohmapp.db.session.commit()
        res2 = self.client.put(f'/api/chantiers/{chantier_id}', json={'status': 'DONE'})
        self.assertEqual(res2.status_code, 200, res2.get_json())

    # --- Endpoint CRUD minimal des VoltaDocumentLink (formulaire étape 4) ---

    def test_volta_links_create_and_list(self):
        chantier_id = self._create_chantier('Links CRUD')
        res = self.client.post(f'/api/chantiers/{chantier_id}/volta-links', json={
            'numero_projet': '024042.001', 'numero_facture': '7098', 'numero_offre': '7747',
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        data = res.get_json()
        self.assertEqual(data['numero_projet'], '024042.001')
        self.assertEqual(data['numero_facture'], '7098')
        self.assertEqual(data['numero_offre'], '7747')
        self.assertEqual(data['statut_sync'], 'en_attente')

        res2 = self.client.get(f'/api/chantiers/{chantier_id}/volta-links')
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(len(res2.get_json()), 1)

    def test_volta_links_numero_offre_optional(self):
        chantier_id = self._create_chantier('Links offre optionnelle')
        res = self.client.post(f'/api/chantiers/{chantier_id}/volta-links', json={
            'numero_projet': '024042.001', 'numero_facture': '7098',
        })
        self.assertEqual(res.status_code, 201, res.get_json())
        self.assertIsNone(res.get_json()['numero_offre'])

    def test_volta_links_requires_numero_projet_and_facture(self):
        chantier_id = self._create_chantier('Links validation')
        res = self.client.post(f'/api/chantiers/{chantier_id}/volta-links', json={'numero_facture': '7098'})
        self.assertEqual(res.status_code, 400)
        res2 = self.client.post(f'/api/chantiers/{chantier_id}/volta-links', json={'numero_projet': '024042.001'})
        self.assertEqual(res2.status_code, 400)

    def test_volta_links_unknown_chantier_404(self):
        res = self.client.post('/api/chantiers/999999/volta-links', json={'numero_projet': 'x', 'numero_facture': 'y'})
        self.assertEqual(res.status_code, 404)
        res2 = self.client.get('/api/chantiers/999999/volta-links')
        self.assertEqual(res2.status_code, 404)

    def test_volta_links_requires_admin(self):
        chantier_id = self._create_chantier('Links admin only')
        with ohmapp.app.app_context():
            user = ohmapp.User(username=f'plain_{self._testMethodName}', pin_hash='x', role='user', password_hash=None)
            user.set_password('irrelevant-but-valid-Passw0rd!')
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': user.id})
        client = ohmapp.app.test_client()
        client.set_cookie(ohmapp.COOKIE_NAME, token)
        self.assertEqual(client.get(f'/api/chantiers/{chantier_id}/volta-links').status_code, 403)
        self.assertEqual(client.post(f'/api/chantiers/{chantier_id}/volta-links', json={}).status_code, 403)

    # --- Indicateur global de la file (tous chantiers confondus) ---

    def test_volta_sync_status_empty_queue(self):
        with ohmapp.app.app_context():
            ohmapp.VoltaDocumentLink.query.delete()
            ohmapp.db.session.commit()
        res = self.client.get('/api/volta-sync/status')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json(), {'en_attente_count': 0, 'estimated_calls': 0, 'estimated_hours': 0})

    def test_volta_sync_status_counts_and_estimates(self):
        with ohmapp.app.app_context():
            ohmapp.VoltaDocumentLink.query.delete()
            ohmapp.db.session.commit()
        c1 = self._create_chantier('Status 1')
        c2 = self._create_chantier('Status 2')
        self._create_link(c1, numero_facture='F1', numero_offre=None)                        # 1 appel
        self._create_link(c2, numero_facture='F2', numero_offre='7747')                      # 2 appels
        self._create_link(c2, numero_facture='F3', numero_offre='6638', statut_sync='synced')  # ignoré, pas en_attente

        res = self.client.get('/api/volta-sync/status')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data['en_attente_count'], 2)
        self.assertEqual(data['estimated_calls'], 3)  # 1 (facture seule) + 2 (facture+offre)
        self.assertEqual(data['estimated_hours'], 1)  # ceil(3 / VOLTA_SYNC_RATE_LIMIT_PER_HOUR=6)

    def test_volta_sync_status_requires_admin(self):
        with ohmapp.app.app_context():
            user = ohmapp.User(username=f'plain_{self._testMethodName}', pin_hash='x', role='user', password_hash=None)
            user.set_password('irrelevant-but-valid-Passw0rd!')
            ohmapp.db.session.add(user)
            ohmapp.db.session.commit()
            token = ohmapp.serializer.dumps({'user_id': user.id})
        client = ohmapp.app.test_client()
        client.set_cookie(ohmapp.COOKIE_NAME, token)
        self.assertEqual(client.get('/api/volta-sync/status').status_code, 403)

    # --- Cron de synchro Volta : garde-fou anti-doublon multi-workers ---

    def test_cron_thread_does_not_start_during_tests(self):
        # OHM_DISABLE_VOLTA_CRON=1 est positionné tout en haut de ce fichier,
        # AVANT `import app` — vérifie que ça a bien empêché le thread de
        # démarrer (import déjà fait une fois pour toute la classe/suite),
        # et qu'aucun thread résiduel de ce nom ne tourne en fond.
        self.assertIsNone(ohmapp._volta_sync_cron_thread)
        self.assertNotIn('volta-sync-cron', [t.name for t in threading.enumerate()])

    def test_claim_guard_only_one_of_two_concurrent_workers_wins(self):
        # Simule 2 "workers" gunicorn qui tentent de déclencher le même
        # cycle au même instant — un seul doit gagner la course.
        with ohmapp.app.app_context():
            ohmapp.VoltaSyncRun.query.delete()
            ohmapp.db.session.commit()

        now = ohmapp.datetime.datetime.utcnow()
        with ohmapp.app.app_context():
            first_worker_claims = ohmapp._try_claim_volta_sync_run(now=now)
        with ohmapp.app.app_context():
            second_worker_claims = ohmapp._try_claim_volta_sync_run(now=now)

        self.assertTrue(first_worker_claims)
        self.assertFalse(second_worker_claims)

        with ohmapp.app.app_context():
            self.assertEqual(ohmapp.VoltaSyncRun.query.count(), 1)  # ligne singleton, pas de doublon

    def test_claim_guard_respects_interval_then_allows_next_cycle(self):
        with ohmapp.app.app_context():
            ohmapp.VoltaSyncRun.query.delete()
            ohmapp.db.session.commit()

        t0 = ohmapp.datetime.datetime.utcnow()
        with ohmapp.app.app_context():
            self.assertTrue(ohmapp._try_claim_volta_sync_run(now=t0))

        # Bien avant la fin de la fenêtre de garde -> toujours refusé,
        # comme un 2e worker qui retenterait trop tôt.
        soon = t0 + ohmapp.datetime.timedelta(minutes=1)
        with ohmapp.app.app_context():
            self.assertFalse(ohmapp._try_claim_volta_sync_run(now=soon))

        # Une fois VOLTA_SYNC_CRON_CLAIM_WINDOW_SECONDS écoulées -> un
        # nouveau cycle peut être réclamé.
        later = t0 + ohmapp.datetime.timedelta(seconds=ohmapp.VOLTA_SYNC_CRON_CLAIM_WINDOW_SECONDS + 1)
        with ohmapp.app.app_context():
            self.assertTrue(ohmapp._try_claim_volta_sync_run(now=later))

    def test_claim_guard_singleton_row_survives_repeated_calls(self):
        with ohmapp.app.app_context():
            ohmapp.VoltaSyncRun.query.delete()
            ohmapp.db.session.commit()
        with ohmapp.app.app_context():
            ohmapp._try_claim_volta_sync_run()
            ohmapp._try_claim_volta_sync_run()  # la ligne id=1 existe déjà — ne doit pas planter
            self.assertEqual(ohmapp.VoltaSyncRun.query.count(), 1)


if __name__ == '__main__':
    unittest.main()
