import os
from app import app, db, User, Chantier, Entry
from datetime import datetime, timedelta
import random

def seed_data():
    with app.app_context():
        print("Seeding mock data...")
        
        # Ensure Users
        users = User.query.all()
        if not users:
            print("Creating users...")
            admin = User(username='Admin', pin='000000', role='admin')
            worker = User(username='Ouvrier', pin='123456', role='user')
            db.session.add(admin)
            db.session.add(worker)
            db.session.commit()
            users = [admin, worker]
            
        # Ensure Chantiers
        chantiers = Chantier.query.all()
        if not chantiers:
            print("Creating chantiers...")
            c1 = Chantier(nom='Renovation Villa A', annee=2024, status='ACTIVE', address_work='Geneva')
            c2 = Chantier(nom='Immeuble Centre', annee=2024, status='ACTIVE', address_work='Lausanne')
            c3 = Chantier(nom='Projet Gare', annee=2023, status='DONE', address_work='Nyon')
            db.session.add_all([c1, c2, c3])
            db.session.commit()
            chantiers = [c1, c2, c3]
            
        # Seed Entries (Last 15 months to cover YoY comparisons)
        entries = []
        start_date = datetime.now() - timedelta(days=450)
        
        for i in range(200): # 200 mock entries
            random_days = random.randint(0, 450)
            entry_date = start_date + timedelta(days=random_days)
            date_str = entry_date.strftime('%Y-%m-%d')
            
            user = random.choice(users)
            chantier = random.choice(chantiers)
            
            # Weighted random hours (more likely standard days)
            heures = random.choices([4, 8, 8.5, 9, 2], weights=[1, 5, 2, 1, 0.5])[0]
            materiel = random.uniform(0, 500) if random.random() > 0.7 else 0 # 30% chance of materiel
            
            entry = Entry(
                user_id=user.id,
                chantier_id=chantier.id,
                date=date_str,
                heures=heures,
                materiel=round(materiel, 2),
                status='VALIDATED',
                created_by_id=user.id
            )
            entries.append(entry)
            
        db.session.add_all(entries)
        db.session.commit()
        print(f"Added {len(entries)} mock entries.")

if __name__ == '__main__':
    seed_data()
