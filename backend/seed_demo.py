"""Peuple des données de démonstration COMPLÈTES pour présenter toutes les
fonctionnalités livrées aujourd'hui : Agenda (grille par ressource, barres
multi-jours, chantiers à planifier), module financier (backend), Référent +
Pot à chantier, Statistiques RH & Planning (absentéisme, effectifs, planifié
vs réel), Heures non entrées, Validation des congés, Deadline + code couleur.

Tous les chantiers créés ici ont "[DEMO]" dans client_repere — facilement
identifiables et supprimables (voir clean_demo_data() en bas du fichier).
Réutilise les users déjà en base (Admin + non-admins) — n'en crée aucun.

Lancer (depuis backend/, avec le bon SECRET_KEY en env) :
    python seed_demo.py            # crée les données
    python seed_demo.py --clean    # supprime tout ce qui a été créé par ce script
"""
import sys
import datetime
import random
import uuid

from app import (
    app, db, User, Chantier, ChantierAssignment, Entry, Leave,
    ChantierFinancier, CaLignePrevue, Acompte, AchatMateriel,
    _next_chantier_numero,
)

random.seed(42)  # reproductible — deux lancements produisent le même jeu de données

TASK_DESCRIPTIONS = [
    "Pose de tuyaux", "Raccordement électrique", "Coffrage béton",
    "Isolation combles", "Pose de cloisons", "Peinture façade",
    "Installation sanitaire", "Câblage réseau", "Terrassement",
    "Pose de carrelage", "Montage échafaudage", "Étanchéité toiture",
]

DEMO_MARKER = '[DEMO]'


def business_days(start, end):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += datetime.timedelta(days=1)


def seed():
    with app.app_context():
        today = datetime.date.today()

        non_admins = User.query.filter(User.role != 'admin').order_by(User.id).all()
        admin = User.query.filter_by(role='admin').first()
        if not non_admins or not admin:
            print("Il faut au moins un admin et un employé non-admin en base avant de lancer ce script.")
            return
        print(f"{len(non_admins)} employé(s) trouvé(s) : {[u.username for u in non_admins]}")

        def make_chantier(commune, client, referent, deadline=None, status='FUTURE'):
            numero = _next_chantier_numero(today.year)
            nom = f"{numero}-{commune}-{client}"
            c = Chantier(
                nom=nom, numero=numero, commune=commune, client_repere=client,
                annee=today.year, referent_id=referent.id, deadline=deadline, status=status,
                address_work=f"Rue de la Gare {random.randint(1, 50)}, {commune}",
            )
            db.session.add(c)
            db.session.commit()
            return c

        u = non_admins
        n = len(u)

        chantiers = {}
        chantiers['en_cours_1'] = make_chantier('Sion', f'{DEMO_MARKER} Rochat', u[0 % n])
        chantiers['en_cours_2'] = make_chantier('Martigny', f'{DEMO_MARKER} Favre', u[1 % n])
        chantiers['deadline_depassee'] = make_chantier('Monthey', f'{DEMO_MARKER} Urgence', u[0 % n], deadline=(today - datetime.timedelta(days=5)).isoformat())
        chantiers['deadline_rouge'] = make_chantier('Bex', f'{DEMO_MARKER} Critique', u[1 % n], deadline=(today + datetime.timedelta(days=2)).isoformat())
        chantiers['deadline_orange'] = make_chantier('Aigle', f'{DEMO_MARKER} Attention', u[2 % n], deadline=(today + datetime.timedelta(days=5)).isoformat())
        chantiers['deadline_jaune'] = make_chantier('Vevey', f'{DEMO_MARKER} A surveiller', u[0 % n], deadline=(today + datetime.timedelta(days=10)).isoformat())
        chantiers['termine'] = make_chantier('Nyon', f'{DEMO_MARKER} Livre', u[1 % n], status='DONE')
        chantiers['pot_planifie'] = make_chantier('Sierre', f'{DEMO_MARKER} Propositions en attente', u[2 % n])
        chantiers['pot_vide'] = make_chantier('Gland', f'{DEMO_MARKER} En attente de planification', u[0 % n])

        chantiers['en_cours_1'].avancement_declare = 40
        chantiers['en_cours_2'].avancement_declare = 65
        chantiers['deadline_rouge'].avancement_declare = 80
        chantiers['deadline_orange'].avancement_declare = 55
        chantiers['termine'].avancement_declare = 100
        db.session.commit()
        print(f"{len(chantiers)} chantiers créés.")

        # --- Module financier (backend complet) sur 2 chantiers ---
        for key in ('en_cours_1', 'deadline_rouge'):
            c = chantiers[key]
            fin = ChantierFinancier(chantier_id=c.id, charge_materiel_prevue=15000, taux_horaire=75, pct_petites_fournitures=0.05)
            db.session.add(fin)
            db.session.add(CaLignePrevue(chantier_id=c.id, libelle='Devis principal', montant=45000, heures=350))
            db.session.add(Acompte(chantier_id=c.id, libelle='Acompte 1', montant=15000, date=(today - datetime.timedelta(days=20)).isoformat()))
            db.session.add(AchatMateriel(chantier_id=c.id, libelle='Fournitures diverses', montant=6200, type='facture', date=(today - datetime.timedelta(days=10)).isoformat()))
        db.session.commit()
        print("Module financier configuré sur 2 chantiers.")

        # --- Affectations confirmées : 3 semaines passées + celle en cours,
        # pour peupler l'Agenda (barres multi-jours) et le planifié/réel des Stats RH ---
        window_start = today - datetime.timedelta(days=21)
        for chantier_key in ('en_cours_1', 'en_cours_2', 'deadline_rouge', 'deadline_orange', 'deadline_jaune'):
            c = chantiers[chantier_key]
            for employe in u:
                if random.random() > 0.55:
                    continue
                span = random.randint(2, 4)
                start = window_start + datetime.timedelta(days=random.randint(0, 18))
                days = list(business_days(start, start + datetime.timedelta(days=span + 2)))[:span]
                if not days:
                    continue
                db.session.add(ChantierAssignment(
                    chantier_id=c.id, user_id=employe.id,
                    date_debut=days[0].isoformat(), date_fin=days[-1].isoformat(),
                    toute_la_journee=True, statut='confirme', created_by_id=admin.id,
                ))
        db.session.commit()
        print("Affectations confirmées créées (Agenda + planifié/réel).")

        # --- "Chantier à planifier" : plusieurs dates candidates pour 2 employés ---
        group_id = uuid.uuid4().hex
        candidate_dates = [today + datetime.timedelta(days=delta) for delta in (7, 8, 14)]
        for employe in u[:2]:
            for d in candidate_dates:
                db.session.add(ChantierAssignment(
                    chantier_id=chantiers['pot_planifie'].id, user_id=employe.id,
                    date_debut=d.isoformat(), date_fin=d.isoformat(),
                    toute_la_journee=True, statut='proposition', proposal_group_id=group_id,
                    created_by_id=admin.id,
                ))
        db.session.commit()
        print("Chantier 'à planifier' (propositions multi-dates) créé.")

        # --- Heures pointées, avec description, pour la plupart des affectations
        # passées confirmées — quelques-unes volontairement sautées pour peupler
        # "Heures non entrées". ---
        assignments = ChantierAssignment.query.filter_by(statut='confirme').all()
        skipped = 0
        entries_created = 0
        for a in assignments:
            d1 = datetime.datetime.strptime(a.date_debut, '%Y-%m-%d').date()
            d2 = datetime.datetime.strptime(a.date_fin, '%Y-%m-%d').date()
            for day in business_days(d1, d2):
                if day >= today:
                    continue  # jour pas encore passé
                if skipped < 4 and random.random() < 0.15:
                    skipped += 1
                    continue
                db.session.add(Entry(
                    user_id=a.user_id, chantier_id=a.chantier_id, date=day.isoformat(),
                    heures=random.choice([7.5, 8, 8.5, 9]),
                    description=random.choice(TASK_DESCRIPTIONS),
                    status=random.choice(['VALIDATED', 'VALIDATED', 'PENDING']),
                    created_by_id=a.user_id,
                ))
                entries_created += 1
        db.session.commit()
        print(f"{entries_created} saisies d'heures créées ({skipped} affectations volontairement sans saisie -> Heures non entrées).")

        # --- Congés : quelques APPROVED (absentéisme), quelques PENDING (Validation congés) ---
        leave_types = ['CONGE', 'MALADIE', 'ABSENCE']
        for i, employe in enumerate(u):
            start = today - datetime.timedelta(days=10 + i * 3)
            end = start + datetime.timedelta(days=random.randint(0, 2))
            db.session.add(Leave(
                user_id=employe.id, type=random.choice(leave_types), status='APPROVED',
                date_start=start.isoformat(), date_end=end.isoformat(),
                days_count=float((end - start).days + 1), created_by_id=employe.id,
            ))
        for i, employe in enumerate(u[:2]):
            start = today + datetime.timedelta(days=5 + i * 4)
            db.session.add(Leave(
                user_id=employe.id, type='CONGE', status='PENDING',
                date_start=start.isoformat(), date_end=start.isoformat(),
                days_count=1.0, created_by_id=employe.id,
            ))
        db.session.commit()
        print("Congés créés (approuvés + en attente).")

        print("\nDonnées de démo créées avec succès.")
        print(f"Chantiers : {', '.join(c.nom for c in chantiers.values())}")


def clean_demo_data():
    with app.app_context():
        demo_chantiers = Chantier.query.filter(Chantier.client_repere.like(f'{DEMO_MARKER}%')).all()
        ids = [c.id for c in demo_chantiers]
        if not ids:
            print("Aucune donnée de démo trouvée.")
            return
        ChantierAssignment.query.filter(ChantierAssignment.chantier_id.in_(ids)).delete(synchronize_session=False)
        Entry.query.filter(Entry.chantier_id.in_(ids)).delete(synchronize_session=False)
        ChantierFinancier.query.filter(ChantierFinancier.chantier_id.in_(ids)).delete(synchronize_session=False)
        CaLignePrevue.query.filter(CaLignePrevue.chantier_id.in_(ids)).delete(synchronize_session=False)
        Acompte.query.filter(Acompte.chantier_id.in_(ids)).delete(synchronize_session=False)
        AchatMateriel.query.filter(AchatMateriel.chantier_id.in_(ids)).delete(synchronize_session=False)
        for c in demo_chantiers:
            db.session.delete(c)
        db.session.commit()
        print(f"{len(ids)} chantier(s) de démo et leurs données associées supprimés.")
        print("Note : les congés créés par ce script ne sont pas préfixés (rattachés aux vrais employés) — pas supprimés automatiquement, à faire à la main si besoin.")


if __name__ == '__main__':
    if '--clean' in sys.argv:
        clean_demo_data()
    else:
        seed()
