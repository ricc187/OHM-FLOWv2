import os
import shutil
import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text, inspect
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

app = Flask(__name__, static_folder='../dist', static_url_path='/')
CORS(app)  # Enable CORS for development
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(os.getcwd(), 'data', 'chantier.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# --- Models ---

# --- Models ---

# Association table for User <-> Chantier
chantier_members = db.Table('chantier_members',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
    db.Column('chantier_id', db.Integer, db.ForeignKey('chantiers.id'), primary_key=True)
)

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    pin = db.Column(db.String(6), nullable=False) # 6 digits PIN
    role = db.Column(db.String(20), nullable=False) # 'admin' or 'user'
    vacation_balance = db.Column(db.Float, default=0.0)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
            'vacation_balance': self.vacation_balance
        }

class Chantier(db.Model):
    __tablename__ = 'chantiers'
    id = db.Column(db.Integer, primary_key=True)
    nom = db.Column(db.String(100), nullable=False)
    annee = db.Column(db.Integer, nullable=False)
    pdf_path = db.Column(db.String(200), nullable=True)
    
    # New fields
    address_work = db.Column(db.String(200), nullable=True)
    address_billing = db.Column(db.String(200), nullable=True)
    date_start = db.Column(db.String(20), nullable=True)
    date_end = db.Column(db.String(20), nullable=True)
    remarque = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default='FUTURE') # FUTURE, ACTIVE, DONE
    
    # Relationships
    members = db.relationship('User', secondary=chantier_members, lazy='subquery',
        backref=db.backref('chantiers', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'nom': self.nom,
            'annee': self.annee,
            'pdf_path': self.pdf_path,
            'address_work': self.address_work,
            'address_billing': self.address_billing,
            'date_start': self.date_start,
            'date_end': self.date_end,
            'remarque': self.remarque,
            'status': self.status,
            'members': [u.id for u in self.members]
        }

class Entry(db.Model):
    __tablename__ = 'entries'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    date = db.Column(db.String(20), nullable=False)
    heures = db.Column(db.Float, nullable=False, default=0.0)
    materiel = db.Column(db.Float, nullable=False, default=0.0)
    
    # New fields
    status = db.Column(db.String(20), default='PENDING') # PENDING, VALIDATED
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    user = db.relationship('User', foreign_keys=[user_id], backref='entries')
    created_by = db.relationship('User', foreign_keys=[created_by_id])
    chantier = db.relationship('Chantier', backref='entries')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.username,
            'chantier_id': self.chantier_id,
            'chantier_nom': self.chantier.nom if self.chantier else 'Chantier Inconnu',
            'date': self.date,
            'heures': self.heures,
            'materiel': self.materiel,
            'status': self.status,
            'created_by_id': self.created_by_id
        }

class Leave(db.Model):
    __tablename__ = 'leaves'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    type = db.Column(db.String(20), nullable=False) # VACATION, SICKNESS
    date_start = db.Column(db.String(20), nullable=False)
    date_end = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), default='PENDING') # PENDING, APPROVED, REJECTED
    days_count = db.Column(db.Float, default=0.0) 

    user = db.relationship('User', backref='leaves')

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_name': self.user.username,
            'type': self.type,
            'date_start': self.date_start,
            'date_end': self.date_end,
            'status': self.status,
            'days_count': self.days_count
        }

class Alert(db.Model):
    __tablename__ = 'alerts'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    due_date = db.Column(db.String(20), nullable=True)
    is_resolved = db.Column(db.Boolean, default=False)
    
    chantier = db.relationship('Chantier', backref='alerts')

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'chantier_nom': self.chantier.nom,
            'title': self.title,
            'description': self.description,
            'due_date': self.due_date,
            'is_resolved': self.is_resolved
        }

# --- Database Initialization ---
# --- Database Initialization ---
def init_db():
    data_dir = os.path.join(os.getcwd(), 'data')
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    
    with app.app_context():
        db.create_all()
        
        # --- Auto-Migration for existing databases ---
        inspector = inspect(db.engine)
        existing_tables = inspector.get_table_names()

        with db.engine.connect() as conn:
            # 1. Users Table
            if 'users' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('users')]
                if 'vacation_balance' not in cols:
                    logger.info("Migrating users: adding vacation_balance")
                    conn.execute(text("ALTER TABLE users ADD COLUMN vacation_balance FLOAT DEFAULT 0.0"))
                    conn.commit()

            # 2. Chantiers Table
            if 'chantiers' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('chantiers')]
                new_cols = {
                    'address_work': 'VARCHAR(200)',
                    'address_billing': 'VARCHAR(200)',
                    'date_start': 'VARCHAR(20)',
                    'date_end': 'VARCHAR(20)',
                    'remarque': 'TEXT',
                    'status': "VARCHAR(20) DEFAULT 'FUTURE'"
                }
                for col_name, col_type in new_cols.items():
                    if col_name not in cols:
                        logger.info(f"Migrating chantiers: adding {col_name}")
                        conn.execute(text(f"ALTER TABLE chantiers ADD COLUMN {col_name} {col_type}"))
                        conn.commit()

            # 3. Entries Table
            if 'entries' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('entries')]
                if 'status' not in cols:
                    logger.info("Migrating entries: adding status")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN status VARCHAR(20) DEFAULT 'PENDING'"))
                    conn.commit()
                if 'created_by_id' not in cols:
                    logger.info("Migrating entries: adding created_by_id")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN created_by_id INTEGER REFERENCES users(id)"))
                    conn.commit()

        # Create default admin if not exists
        if not User.query.filter_by(username='Admin').first():
            # Default Admin PIN: 000000
            admin = User(username='Admin', pin='000000', role='admin')
            db.session.add(admin)
            db.session.commit()
            logger.info("Default Admin user created with PIN 000000.")

# --- Routes ---

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.errorhandler(404)
def not_found(e):
    return send_from_directory(app.static_folder, 'index.html')

# API Routes
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    pin = data.get('pin')
    
    # Simple PIN auth: check if ANY user has this PIN? 
    # Or username + pin? 
    # User said: "pour me loguer on mette simplement un pin a 6 chiffre... permet d'accéder".
    # This implies NO username field on login. Just PIN.
    # What if 2 users have same PIN? Assume uniqueness or strict enforcement.
    
    user = User.query.filter_by(pin=pin).first()
    if user:
        return jsonify(user.to_dict())
    return jsonify({'error': 'Invalid PIN'}), 401

@app.route('/api/users', methods=['GET', 'POST', 'DELETE'])
def manage_users():
    if request.method == 'GET':
        users = User.query.all()
        # Should we return PINs? Maybe unsafe but requested "on pourra creer... avec un pin".
        # For admin view, showing PIN might be useful/requested.
        return jsonify([{**u.to_dict(), 'pin': u.pin} for u in users])

    if request.method == 'POST':
        data = request.json
        if User.query.filter_by(username=data['username']).first():
             return jsonify({'error': 'Username exists'}), 400
        
        # Enforce PIN uniqueness? Maybe.
        if User.query.filter_by(pin=data['pin']).first():
            return jsonify({'error': 'PIN already in use'}), 400

        new_user = User(username=data['username'], pin=data['pin'], role=data['role'])
        db.session.add(new_user)
        db.session.commit()
        return jsonify(new_user.to_dict()), 201

    return jsonify({'error': 'Method not allowed on this endpoint, use /api/users/<id>'}), 405

@app.route('/api/users/<int:user_id>', methods=['PUT', 'DELETE'])
def user_operations(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    if request.method == 'DELETE':
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'User deleted'})

    if request.method == 'PUT':
        data = request.json
        new_username = data.get('username')
        new_pin = data.get('pin')
        new_role = data.get('role')

        # Validation: Check uniqueness if changed
        if new_username and new_username != user.username:
            if User.query.filter_by(username=new_username).first():
                return jsonify({'error': 'Username exists'}), 400
            user.username = new_username
        
        if new_pin and new_pin != user.pin:
             # Validate PIN format (6 digits) - although frontend should handle, backend must enforce
            if len(new_pin) != 6 or not new_pin.isdigit():
                 return jsonify({'error': 'Invalid PIN format'}), 400
            if User.query.filter_by(pin=new_pin).first():
                return jsonify({'error': 'PIN already in use'}), 400
            user.pin = new_pin
            
        if new_role:
            if new_role not in ['admin', 'user']:
                return jsonify({'error': 'Invalid role'}), 400
            user.role = new_role

        db.session.commit()
        return jsonify(user.to_dict())


@app.route('/api/backup', methods=['POST'])
def trigger_backup():
    # Level 1: Local Backup
    try:
        backup_dir = os.path.join(os.getcwd(), 'backup')
        if not os.path.exists(backup_dir):
            os.makedirs(backup_dir)
            
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Backup DB
        db_path = os.path.join(os.getcwd(), 'data', 'chantier.db')
        if os.path.exists(db_path):
            shutil.copy2(db_path, os.path.join(backup_dir, f'chantier_{timestamp}.db'))
            
        # Backup PDFs (assuming they are in data/pdfs or similar, user said "dossier PDF")
        # For now, let's assume they are stored relative to app.
        
        # Level 2: Cloud (Placeholder for rclone/script trigger)
        # os.system("rclone copy ...")
        
        return jsonify({'message': 'Backup created successfully', 'timestamp': timestamp})
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/chantiers', methods=['GET', 'POST'])
def manage_chantiers():
    if request.method == 'GET':
        user_id = request.args.get('user_id', type=int)
        role = request.args.get('role', 'user')
        status = request.args.get('status') # 'FUTURE', 'ACTIVE', 'DONE' or 'ALL'

        query = Chantier.query
        
        # Status Filter
        if status and status != 'ALL':
            query = query.filter(Chantier.status == status)
        
        # Access Rule: User sees only their chantiers, Admin sees all
        if role != 'admin' and user_id:
             query = query.join(chantier_members).join(User).filter(User.id == user_id)
        
        chantiers = query.all()
        return jsonify([c.to_dict() for c in chantiers])

    if request.method == 'POST':
        data = request.json
        new_chantier = Chantier(
            nom=data['nom'],
            annee=data.get('annee', 2024),
            pdf_path=data.get('pdf_path', ''),
            address_work=data.get('address_work'),
            address_billing=data.get('address_billing'),
            date_start=data.get('date_start'),
            date_end=data.get('date_end'),
            remarque=data.get('remarque'),
            status=data.get('status', 'FUTURE')
        )
        
        # Handle initial members
        if 'members' in data:
            for uid in data['members']:
                u = db.session.get(User, uid)
                if u:
                    new_chantier.members.append(u)

        db.session.add(new_chantier)
        db.session.commit()
        return jsonify(new_chantier.to_dict()), 201

@app.route('/api/chantiers/<int:chantier_id>', methods=['PUT', 'GET'])
def chantier_detail(chantier_id):
    chantier = db.session.get(Chantier, chantier_id)
    if not chantier:
        return jsonify({'error': 'Chantier not found'}), 404
        
    if request.method == 'GET':
        return jsonify(chantier.to_dict())

    if request.method == 'PUT':
        data = request.json
        chantier.nom = data.get('nom', chantier.nom)
        chantier.annee = data.get('annee', chantier.annee)
        chantier.pdf_path = data.get('pdf_path', chantier.pdf_path)
        chantier.address_work = data.get('address_work', chantier.address_work)
        chantier.address_billing = data.get('address_billing', chantier.address_billing)
        chantier.date_start = data.get('date_start', chantier.date_start)
        chantier.date_end = data.get('date_end', chantier.date_end)
        chantier.remarque = data.get('remarque', chantier.remarque)
        chantier.status = data.get('status', chantier.status)
        db.session.commit()
        return jsonify(chantier.to_dict())

@app.route('/api/chantiers/<int:chantier_id>/members', methods=['POST', 'DELETE'])
def manage_chantier_members(chantier_id):
    chantier = db.session.get(Chantier, chantier_id)
    if not chantier:
        return jsonify({'error': 'Chantier not found'}), 404
        
    data = request.json
    user_id = data.get('user_id')
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    if request.method == 'POST':
        if user not in chantier.members:
            chantier.members.append(user)
            db.session.commit()
        return jsonify(chantier.to_dict())
        
    if request.method == 'DELETE':
        if user in chantier.members:
            chantier.members.remove(user)
            db.session.commit()
        return jsonify(chantier.to_dict())


@app.route('/api/chantiers/<int:chantier_id>/entries', methods=['GET'])
def get_chantier_entries(chantier_id):
    role = request.args.get('role') 
    user_id = request.args.get('user_id')

    if role == 'admin':
        entries = Entry.query.filter_by(chantier_id=chantier_id).all()
    elif role == 'user' and user_id:
        entries = Entry.query.filter_by(chantier_id=chantier_id, user_id=user_id).all()
    else:
        return jsonify({'error': 'Unauthorized or missing params'}), 403
        
    return jsonify([e.to_dict() for e in entries])

@app.route('/api/entries', methods=['POST'])
def add_entry():
    data = request.json
    
    # Delegation Logic:
    # If 'user_id' is provided and different from current user (if we had auth context), 
    # check role. Here we rely on frontend sending the correct user_id.
    # Status is consistently PENDING for new entries.
    
    new_entry = Entry(
        user_id=data['user_id'],
        chantier_id=data['chantier_id'],
        date=data['date'],
        heures=float(data.get('heures', 0)),
        materiel=float(data.get('materiel', 0)),
        status='PENDING',
        created_by_id=data.get('created_by_id', data['user_id']) # Track who entered it
    )
    db.session.add(new_entry)
    db.session.commit()
    return jsonify(new_entry.to_dict()), 201

@app.route('/api/entries/pending', methods=['GET'])
def get_pending_entries():
    # Admin only (frontend check generally, backend should check role ideally)
    entries = Entry.query.filter_by(status='PENDING').all()
    return jsonify([e.to_dict() for e in entries])

@app.route('/api/entries/<int:entry_id>/validate', methods=['PUT'])
def validate_entry(entry_id):
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404
    entry.status = 'VALIDATED'
    db.session.commit()
    return jsonify(entry.to_dict())

@app.route('/api/entries/<int:entry_id>', methods=['PUT', 'DELETE'])
def manage_entry(entry_id):
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    if request.method == 'DELETE':
        db.session.delete(entry)
        db.session.commit()
        return jsonify({'message': 'Entry deleted'})

    if request.method == 'PUT':
        data = request.json
        # Admin modification
        entry.heures = float(data.get('heures', entry.heures))
        entry.materiel = float(data.get('materiel', entry.materiel))
        # If modified, does it stay validated? Let's assume yes or user keeps status.
        if 'status' in data:
            entry.status = data['status']
            
        db.session.commit()
        return jsonify(entry.to_dict())

@app.route('/api/leaves', methods=['GET', 'POST'])
def manage_leaves():
    if request.method == 'GET':
        user_id = request.args.get('user_id')
        if user_id:
             leaves = Leave.query.filter_by(user_id=user_id).all()
        else:
             leaves = Leave.query.all() # Admin sees all
        return jsonify([l.to_dict() for l in leaves])

    if request.method == 'POST':
        data = request.json
        new_leave = Leave(
            user_id=data['user_id'],
            type=data['type'],
            date_start=data['date_start'],
            date_end=data['date_end'],
            days_count=float(data.get('days_count', 0)),
            status='PENDING'
        )
        db.session.add(new_leave)
        db.session.commit()
        return jsonify(new_leave.to_dict()), 201

@app.route('/api/leaves/<int:leave_id>/status', methods=['PUT'])
def update_leave_status(leave_id):
    leave = Leave.query.get(leave_id)
    if not leave:
        return jsonify({'error': 'Leave not found'}), 404
        
    data = request.json
    status = data.get('status')
    if status not in ['APPROVED', 'REJECTED', 'PENDING']:
        return jsonify({'error': 'Invalid status'}), 400
        
    leave.status = status
    
    # Logic: Deduct balance if approved?
    if status == 'APPROVED' and leave.type == 'VACATION':
        # Deduct from user balance
        user = db.session.get(User, leave.user_id)
        if user:
             # Logic to calculate days should be robust, here relying on frontend/data
             user.vacation_balance -= leave.days_count
             
    db.session.commit()
    return jsonify(leave.to_dict())

@app.route('/api/chantiers/<int:chantier_id>/alerts', methods=['GET', 'POST'])
def manage_alerts(chantier_id):
    if request.method == 'GET':
        alerts = Alert.query.filter_by(chantier_id=chantier_id).all()
        return jsonify([a.to_dict() for a in alerts])

    if request.method == 'POST':
        data = request.json
        new_alert = Alert(
            chantier_id=chantier_id,
            title=data['title'],
            description=data.get('description'),
            due_date=data.get('due_date'),
            is_resolved=False
        )
        db.session.add(new_alert)
        db.session.commit()
        return jsonify(new_alert.to_dict()), 201

@app.route('/api/alerts/<int:alert_id>', methods=['PUT', 'DELETE'])
def manage_single_alert(alert_id):
    alert = Alert.query.get(alert_id)
    if not alert:
         return jsonify({'error': 'Alert not found'}), 404
         
    if request.method == 'DELETE':
        db.session.delete(alert)
        db.session.commit()
        return jsonify({'message': 'Alert deleted'})
        
    if request.method == 'PUT':
        data = request.json
        alert.is_resolved = data.get('is_resolved', alert.is_resolved)
        db.session.commit()
        return jsonify(alert.to_dict())

@app.route('/api/export', methods=['GET'])
def export_data():
    # Export all entries to CSV
    import csv
    import io
    from flask import make_response

    entries = Entry.query.all()
    
    # Create CSV in memory
    si = io.StringIO()
    cw = csv.writer(si)
    # Headers
    cw.writerow(['ID', 'Date', 'Chantier', 'Ouvrier', 'Heures', 'Materiel'])
    
    for e in entries:
        cw.writerow([
            e.id, 
            e.date, 
            e.chantier.nom, 
            e.user.username, 
            e.heures, 
            e.materiel
        ])
    
    output = make_response(si.getvalue())
    output.headers["Content-Disposition"] = "attachment; filename=export_entries.csv"
    output.headers["Content-type"] = "text/csv"
    return output

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)
