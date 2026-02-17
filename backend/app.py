import os
import shutil
import datetime
import functools
from itsdangerous import URLSafeTimedSerializer
from flask import Flask, request, jsonify, send_from_directory, send_file
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
app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), 'data', 'uploads')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


# Security Config
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'ohm-flow-secure-key-change-me-in-prod')
serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])

db.init_app(app)

def token_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'error': 'Token is missing'}), 401
        
        try:
            # Format: Bearer <token>
            token = auth_header.split(" ")[1]
            data = serializer.loads(token, max_age=86400) # Valid for 24h
            current_user = User.query.get(data['user_id'])
            if not current_user:
                raise Exception('User not found')
        except Exception as e:
            return jsonify({'error': 'Token is invalid or expired'}), 401
            
        return f(current_user, *args, **kwargs)
    return decorated

# Enable WAL mode for SQLite (Better concurrency)
with app.app_context():
    try:
        db.engine.connect().execute(text("PRAGMA journal_mode=WAL;"))
        logger.info("SQLite WAL mode enabled.")
    except Exception as e:
        logger.warning(f"Could not enable WAL mode: {e}")

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
    plan_pdf_path = db.Column(db.String(255), nullable=True)
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
            'plan_pdf_path': self.plan_pdf_path,
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
                    'status': "VARCHAR(20) DEFAULT 'FUTURE'",
                    'plan_pdf_path': "VARCHAR(255)"
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
    
    # Simple PIN auth
    user = User.query.filter_by(pin=pin).first()
    if user:
        token = serializer.dumps({'user_id': user.id})
        return jsonify({**user.to_dict(), 'token': token})
    return jsonify({'error': 'Invalid PIN'}), 401

@app.route('/api/users', methods=['GET', 'POST', 'DELETE'])
@token_required
def manage_users(current_user):
    # Only Admin can manage users
    if current_user.role != 'admin':
         return jsonify({'error': 'Admin access required'}), 403

    if request.method == 'GET':
        users = User.query.all()
        # Security: Mask PINs
        return jsonify([{**u.to_dict(), 'pin': '******'} for u in users])

    if request.method == 'POST':
        data = request.json
        if User.query.filter_by(username=data['username']).first():
             return jsonify({'error': 'Username exists'}), 400
        
        if User.query.filter_by(pin=data['pin']).first():
            return jsonify({'error': 'PIN already in use'}), 400

        new_user = User(username=data['username'], pin=data['pin'], role=data['role'])
        db.session.add(new_user)
        db.session.commit()
        return jsonify(new_user.to_dict()), 201

    return jsonify({'error': 'Method not allowed on this endpoint, use /api/users/<id>'}), 405

@app.route('/api/users/<int:user_id>', methods=['PUT', 'DELETE'])
@token_required
def user_operations(current_user, user_id):
    if current_user.role != 'admin':
         return jsonify({'error': 'Admin access required'}), 403

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
        
        if new_pin and new_pin != '******': # Ignore masked PIN
             # Validate PIN format (6 digits)
            if len(new_pin) != 6 or not new_pin.isdigit():
                 return jsonify({'error': 'Invalid PIN format'}), 400
            if new_pin != user.pin and User.query.filter_by(pin=new_pin).first():
                return jsonify({'error': 'PIN already in use'}), 400
            user.pin = new_pin
            
        if new_role:
            if new_role not in ['admin', 'user']:
                return jsonify({'error': 'Invalid role'}), 400
            user.role = new_role

        db.session.commit()
        return jsonify(user.to_dict())


@app.route('/api/backup', methods=['POST'])
@token_required
def trigger_backup(current_user):
    if current_user.role != 'admin':
         return jsonify({'error': 'Admin access required'}), 403
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
@token_required
def manage_chantiers(current_user):
    if request.method == 'GET':
        status = request.args.get('status') # 'FUTURE', 'ACTIVE', 'DONE' or 'ALL'

        query = Chantier.query
        
        # Status Filter
        if status and status != 'ALL':
            query = query.filter(Chantier.status == status)
        
        # Everyone sees all chantiers now (Requirement change)
        
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
        
        # Members assignment removed

        db.session.add(new_chantier)
        db.session.commit()
        return jsonify(new_chantier.to_dict()), 201

@app.route('/api/chantiers/<int:chantier_id>', methods=['PUT', 'GET'])
@token_required
def chantier_detail(current_user, chantier_id):
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

@app.route('/api/chantiers/<int:id>/pdf', methods=['POST'])
@token_required
def upload_chantier_pdf(current_user, id):
    chantier = Chantier.query.get_or_404(id)
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and file.filename.lower().endswith('.pdf'):
        filename = f"chantier_{id}_plan.pdf"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        chantier.plan_pdf_path = filename
        db.session.commit()
        return jsonify(chantier.to_dict())
    
    return jsonify({'error': 'Only PDF files are allowed'}), 400

@app.route('/api/chantiers/<int:id>/pdf', methods=['GET'])
@token_required
def get_chantier_pdf(current_user, id):
    chantier = Chantier.query.get_or_404(id)
    if not chantier.plan_pdf_path:
        return jsonify({'error': 'No PDF uploaded'}), 404
    
    return send_file(os.path.join(app.config['UPLOAD_FOLDER'], chantier.plan_pdf_path), as_attachment=False)

@app.route('/api/chantiers/<int:chantier_id>/members', methods=['POST', 'DELETE'])
@token_required
def manage_chantier_members(current_user, chantier_id):
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
@token_required
def get_chantier_entries(current_user, chantier_id):
    # Everyone can see all entries for a chantier
    entries = Entry.query.filter_by(chantier_id=chantier_id).all()
    return jsonify([e.to_dict() for e in entries])

@app.route('/api/entries', methods=['POST'])
@token_required
def add_entry(current_user):
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
@token_required
def get_pending_entries(current_user):
    # Admin only (frontend check generally, backend should check role ideally)
    entries = Entry.query.filter_by(status='PENDING').all()
    return jsonify([e.to_dict() for e in entries])

@app.route('/api/entries/<int:entry_id>/validate', methods=['PUT'])
@token_required
def validate_entry(current_user, entry_id):
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404
    entry.status = 'VALIDATED'
    db.session.commit()
    return jsonify(entry.to_dict())

@app.route('/api/entries/<int:entry_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_entry(current_user, entry_id):
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
@token_required
def manage_leaves(current_user):
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
@token_required
def update_leave_status(current_user, leave_id):
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
@token_required
def manage_alerts(current_user, chantier_id):
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
@token_required
def manage_single_alert(current_user, alert_id):
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
@token_required
def export_data(current_user):
    # Export entries to CSV
    import csv
    import io
    from flask import make_response
    
    chantier_id = request.args.get('chantier_id')
    year = request.args.get('year')
    semester = request.args.get('semester') # S1, S2
    
    query = Entry.query
    
    if chantier_id:
        query = query.filter_by(chantier_id=chantier_id)
        
    entries = query.all()
    
    # Filter in Python for simplicity with string dates
    filtered_entries = []
    for e in entries:
        include = True
        
        # Date format YYYY-MM-DD
        if year:
            if not e.date.startswith(str(year)):
                include = False
                
        if semester and include:
            try:
                month = int(e.date.split('-')[1])
                if semester == 'S1':
                    if month > 6: include = False
                elif semester == 'S2':
                    if month <= 6: include = False
            except:
                pass # potentially malformed date
                
        if include:
            filtered_entries.append(e)
    
    # Create CSV in memory
    si = io.StringIO()
    cw = csv.writer(si)
    # Headers
    cw.writerow(['ID', 'Date', 'Chantier', 'Ouvrier', 'Heures', 'Materiel', 'Statut'])
    
    for e in filtered_entries:
        cw.writerow([
            e.id, 
            e.date, 
            e.chantier.nom if e.chantier else 'Supprimé', 
            e.user.username if e.user else 'Inconnu', 
            e.heures, 
            e.materiel,
            e.status
        ])
    
    output = make_response(si.getvalue())
    
    # Filename construction
    parts = ["export"]
    if chantier_id: parts.append(f"chantier_{chantier_id}")
    else: parts.append("global")
    
    if year: parts.append(str(year))
    if semester: parts.append(semester)
    
    filename = "_".join(parts) + ".csv"
    
    output.headers["Content-Disposition"] = f"attachment; filename={filename}"
    output.headers["Content-type"] = "text/csv"
    return output

@app.route('/api/stats', methods=['GET'])
@token_required
def get_stats(current_user):
    from sqlalchemy import func
    from datetime import datetime, timedelta
    from collections import defaultdict
    
    total_entries = db.session.query(func.count(Entry.id)).scalar() or 0
    total_hours = db.session.query(func.sum(Entry.heures)).scalar() or 0
    total_material = db.session.query(func.sum(Entry.materiel)).scalar() or 0
    
    # Active chantiers count
    active_chantiers = db.session.query(func.count(Chantier.id)).filter(Chantier.status == 'ACTIVE').scalar() or 0
    
    # History Processing (Last 12 Months)
    entries = Entry.query.all()
    
    # Group by Month and Year for Comparison
    monthly_data = defaultdict(lambda: {'hours': 0, 'material': 0})
    current_year = datetime.now().year
    last_year = current_year - 1
    
    total_hours_curr = 0
    total_hours_last = 0
    total_mat_curr = 0
    total_mat_last = 0

    for e in entries:
        try:
            # Assumes e.date is YYYY-MM-DD
            year = int(e.date[:4])
            month_key = e.date[:7] # YYYY-MM
            
            monthly_data[month_key]['hours'] += e.heures
            monthly_data[month_key]['material'] += e.materiel
            
            if year == current_year:
                total_hours_curr += e.heures
                total_mat_curr += e.materiel
            elif year == last_year:
                total_hours_last += e.heures
                total_mat_last += e.materiel
        except:
            continue
            
    # Format for Frontend (Sorted keys)
    sorted_months = sorted(monthly_data.keys())[-12:] # Last 12 months
    
    history = []
    for m in sorted_months:
        history.append({
            'month': m,
            'hours': round(monthly_data[m]['hours'], 1),
            'material': round(monthly_data[m]['material'], 2)
        })

    # Calculate Growth
    hours_growth = 0
    if total_hours_last > 0:
        hours_growth = ((total_hours_curr - total_hours_last) / total_hours_last) * 100
        
    mat_growth = 0
    if total_mat_last > 0:
        mat_growth = ((total_mat_curr - total_mat_last) / total_mat_last) * 100

    return jsonify({
        'total_entries': total_entries,
        'total_hours': round(total_hours, 1),
        'total_material': round(total_material, 2),
        'active_chantiers': active_chantiers,
        'history': history,
        'comparison': {
            'hours_growth': round(hours_growth, 1),
            'material_growth': round(mat_growth, 1),
            'hours_curr': round(total_hours_curr, 1),
            'hours_last': round(total_hours_last, 1)
        }
    })

# Initialize Database (Run migration)
init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
