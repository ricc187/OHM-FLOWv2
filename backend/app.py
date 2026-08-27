import os
import secrets
import shutil
import datetime
import functools
import uuid
import re
import unicodedata
import zipfile
import tempfile
from io import BytesIO
from itsdangerous import URLSafeTimedSerializer
from werkzeug.security import generate_password_hash, check_password_hash
from flask import Flask, request, jsonify, send_from_directory, send_file, after_this_request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text, inspect, func
from PIL import Image, ImageOps
import fitz  # PyMuPDF
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

app = Flask(__name__, static_folder='../dist', static_url_path='/')
_default_origins = "https://ohmflow.com,https://www.ohmflow.com"
_allowed_origins = [o.strip() for o in os.environ.get('ALLOWED_ORIGINS', _default_origins).split(',') if o.strip()]
CORS(app, origins=_allowed_origins)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(os.getcwd(), 'data', 'chantier.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), 'data', 'uploads')
app.config['ARCHIVE_FOLDER'] = os.path.join(os.getcwd(), 'data', 'archives')
# 25 MB: raw phone-camera photos (esp. high-res JPEGs) commonly land in the
# 8-15MB range — the old 10MB cap was sized for PDF-only uploads.
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024
try:
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['ARCHIVE_FOLDER'], exist_ok=True)
except OSError as e:
    logger.warning(f"Could not create upload/archive folders: {e}")


# Security Config
secret = os.environ.get('SECRET_KEY')
if not secret:
    raise RuntimeError("FATAL: SECRET_KEY is not set! Set it in your .env file.")
app.config['SECRET_KEY'] = secret
serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])

# Rate Limiter
limiter = Limiter(get_remote_address, app=app, default_limits=["2000 per day"])

db.init_app(app)

COOKIE_NAME = 'ohm_token'
COOKIE_MAX_AGE = 86400  # 24h

def set_auth_cookie(response, token):
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,  # not readable from JS — mitigates token theft via XSS
        secure=os.environ.get('FLASK_ENV') == 'production',  # HTTPS-only in prod
        samesite='Lax',  # blocks the cookie on cross-site POST/PUT/DELETE — CSRF mitigation
        path='/'
    )

def clear_auth_cookie(response):
    response.set_cookie(COOKIE_NAME, '', max_age=0, httponly=True, samesite='Lax', path='/')

def token_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return jsonify({'error': 'Token is missing'}), 401

        try:
            data = serializer.loads(token, max_age=COOKIE_MAX_AGE)
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

    # Enforce foreign key constraints (SQLite disables this by default)
    from sqlalchemy import event

    @event.listens_for(db.engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON;")
        # SQLite allows only one writer at a time even in WAL mode — with 4
        # gunicorn workers, two users submitting at the exact same instant can
        # collide. Without this, the loser gets an immediate "database is
        # locked" error instead of just waiting the few milliseconds it takes
        # for the first tiny write to finish.
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.close()

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
    pin_hash = db.Column(db.String(256), nullable=False)
    pin = db.Column(db.String(6), default='')
    role = db.Column(db.String(20), nullable=False) # 'admin' or 'user'
    vacation_balance = db.Column(db.Float, default=0.0)
    must_change_pin = db.Column(db.Boolean, default=False)

    def set_pin(self, pin):
        self.pin_hash = generate_password_hash(pin)

    def check_pin(self, pin):
        return check_password_hash(self.pin_hash, pin)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
            'vacation_balance': self.vacation_balance,
            'must_change_pin': self.must_change_pin
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

    # Set when a closed chantier's document folder has been zipped and
    # deleted from live storage to free space (see archive_chantier_documents
    # below). Reopening the chantier re-extracts the zip and clears this.
    archived = db.Column(db.Boolean, default=False)
    archive_zip_path = db.Column(db.String(255), nullable=True)
    # Actual on-disk folder name under data/uploads/chantiers/ — the chantier's
    # own name, sanitized (see chantier_storage_dirname). Tracked explicitly
    # so a rename can locate + move the existing folder instead of losing it.
    storage_dir = db.Column(db.String(150), nullable=True)
    # "Pas de mesure nécessaire pour ce chantier" — the one opt-out that
    # clears the missing-mesure warning without requiring a file. Rapport
    # d'intervention has no equivalent opt-out; it's always required.
    no_mesure_needed = db.Column(db.Boolean, default=False)

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
            'archived': bool(self.archived),
            'no_mesure_needed': bool(self.no_mesure_needed),
            'has_mesure': any(d.category == 'mesure' for d in self.documents),
            'has_rapport': any(d.category == 'rapport' for d in self.documents),
            'hours_this_month': round(self._get_hours_this_month(), 2),
            'members': [u.id for u in self.members]
        }

    def _get_hours_this_month(self):
        """Sum of heures logged this month, regardless of PENDING/VALIDATED
        status — matches the "total heures" already shown elsewhere (e.g.
        ChantierDetail's SUIVI tab), which never filtered by status either.
        Uses a precomputed value if the caller already batched it for a list
        (see manage_chantiers) to avoid one query per chantier; otherwise
        runs a single lightweight SUM aggregate instead of loading this
        chantier's entire entries history just to add up one field."""
        if hasattr(self, '_hours_this_month_precomputed'):
            return self._hours_this_month_precomputed
        month_prefix = datetime.datetime.utcnow().strftime('%Y-%m')
        return db.session.query(func.coalesce(func.sum(Entry.heures), 0.0)).filter(
            Entry.chantier_id == self.id, Entry.date.like(f'{month_prefix}%')
        ).scalar()

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
    admin_note = db.Column(db.Text, nullable=True)
    # Client-generated id for offline-queued submissions (see frontend
    # offlineQueue.ts) — lets a retried request that actually succeeded but
    # whose response got lost (dropped connection) be recognized as already
    # done instead of creating a duplicate entry. Nullable/non-unique at the
    # DB level (old entries never set it); add_entry does the existence check.
    client_ref = db.Column(db.String(64), nullable=True, index=True)

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
            'created_by_id': self.created_by_id,
            'admin_note': self.admin_note
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
    admin_note = db.Column(db.Text, nullable=True)

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
            'days_count': self.days_count,
            'admin_note': self.admin_note
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

DOCUMENT_CATEGORIES = ('plan', 'devis', 'photo', 'mesure', 'rapport')
# Categories whose filename must contain a specific word (case/accent-insensitive)
# — a lightweight way to keep these two clearly identifiable in the on-disk
# folder without depending on anyone remembering to name things consistently.
CATEGORY_FILENAME_REQUIREMENTS = {'mesure': 'mesure', 'rapport': 'rapport'}
# On-disk subfolder name per category — kept distinct from the API category
# string in case we ever want to relabel one without a filesystem migration.
CATEGORY_FOLDERS = {'plan': 'plans', 'devis': 'devis', 'photo': 'photos', 'mesure': 'mesures', 'rapport': 'rapports_intervention'}

class Document(db.Model):
    __tablename__ = 'documents'
    id = db.Column(db.Integer, primary_key=True)
    chantier_id = db.Column(db.Integer, db.ForeignKey('chantiers.id'), nullable=False)
    category = db.Column(db.String(20), nullable=False)  # plan | devis | photo
    filename = db.Column(db.String(255), nullable=False)          # name on disk (UUID-based)
    original_filename = db.Column(db.String(255), nullable=False) # name shown to users
    size_bytes = db.Column(db.Integer, default=0)
    mimetype = db.Column(db.String(100))
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    # selectin: one extra batched query for ALL chantiers' documents at once,
    # instead of the default lazy='select' issuing one query per chantier —
    # to_dict()'s has_mesure/has_rapport check touches .documents on every
    # chantier in the list (e.g. the dashboard), which was N+1 queries.
    chantier = db.relationship('Chantier', backref=db.backref('documents', cascade='all, delete-orphan', lazy='selectin'))
    uploaded_by = db.relationship('User')

    def to_dict(self):
        return {
            'id': self.id,
            'chantier_id': self.chantier_id,
            'category': self.category,
            'filename': self.original_filename,
            'size_bytes': self.size_bytes,
            'mimetype': self.mimetype,
            'uploaded_by': self.uploaded_by.username if self.uploaded_by else None,
            'uploaded_at': self.uploaded_at.isoformat() if self.uploaded_at else None,
        }

def _filename_contains_word(filename, word):
    """Case/accent-insensitive substring check used to enforce that mesure/
    rapport uploads are actually named as such (e.g. "Mesures_Cuisine.pdf",
    "rapport-intervention-12.pdf") — strips accents so "Relevé Mesures.pdf"
    also matches "mesure"."""
    def normalize(s):
        s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
        return s.lower()
    return normalize(word) in normalize(filename)

def sanitize_folder_name(name):
    """Make a chantier name safe to use as a filesystem folder name."""
    name = (name or '').strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)  # illegal on Windows/most filesystems
    name = name.strip(' .')  # trailing dot/space is illegal on Windows
    return name[:100] or 'chantier'

def chantier_storage_dirname(chantier):
    """Return the on-disk folder name for this chantier — its own name, kept
    in sync on rename (moves the existing folder rather than orphaning it),
    with a numeric suffix only if that name collides with a DIFFERENT
    chantier's folder."""
    root = os.path.join(app.config['UPLOAD_FOLDER'], 'chantiers')
    os.makedirs(root, exist_ok=True)
    desired = sanitize_folder_name(chantier.nom)

    if chantier.storage_dir == desired:
        return chantier.storage_dir

    old_path = os.path.join(root, chantier.storage_dir) if chantier.storage_dir else None

    target = desired
    n = 2
    while os.path.isdir(os.path.join(root, target)) and target != chantier.storage_dir:
        target = f"{desired}_{n}"
        n += 1

    if old_path and os.path.isdir(old_path) and target != chantier.storage_dir:
        shutil.move(old_path, os.path.join(root, target))

    chantier.storage_dir = target
    db.session.commit()
    return target

def chantier_storage_dir(chantier):
    return os.path.join(app.config['UPLOAD_FOLDER'], 'chantiers', chantier_storage_dirname(chantier))

def category_dir(chantier, category, create=True):
    d = os.path.join(chantier_storage_dir(chantier), CATEGORY_FOLDERS[category])
    if create:
        os.makedirs(d, exist_ok=True)
    return d

def document_disk_path(doc):
    return os.path.join(category_dir(doc.chantier, doc.category, create=False), doc.filename)

def archive_chantier_documents(chantier):
    """Zip the chantier's whole document folder into ARCHIVE_FOLDER, then
    delete the live folder — only once the zip is confirmed complete and
    readable, so a failed/partial zip never costs the original files."""
    src_dir = chantier_storage_dir(chantier)
    if not os.path.isdir(src_dir) or not chantier.documents:
        chantier.archived = False
        chantier.archive_zip_path = None
        return

    zip_name = f"chantier_{chantier.id}.zip"
    zip_path = os.path.join(app.config['ARCHIVE_FOLDER'], zip_name)
    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.zip', dir=app.config['ARCHIVE_FOLDER'])
    os.close(tmp_fd)
    try:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for doc in chantier.documents:
                disk_path = document_disk_path(doc)
                if os.path.isfile(disk_path):
                    arcname = f"{CATEGORY_FOLDERS[doc.category]}/{doc.filename}"
                    zf.write(disk_path, arcname)

        # Verify the archive is intact before touching the originals.
        with zipfile.ZipFile(tmp_path) as zf:
            bad_file = zf.testzip()
            if bad_file is not None:
                raise IOError(f"Corrupt entry in archive: {bad_file}")

        shutil.move(tmp_path, zip_path)
        shutil.rmtree(src_dir, ignore_errors=True)
        chantier.archived = True
        chantier.archive_zip_path = zip_name
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def unarchive_chantier_documents(chantier):
    """Re-extract a closed chantier's archive back to live storage (reopen)."""
    if not chantier.archive_zip_path:
        return
    zip_path = os.path.join(app.config['ARCHIVE_FOLDER'], chantier.archive_zip_path)
    dest_dir = chantier_storage_dir(chantier)
    if os.path.isfile(zip_path):
        os.makedirs(dest_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir)
        os.remove(zip_path)
    chantier.archived = False
    chantier.archive_zip_path = None

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
                if 'pin_hash' not in cols:
                    logger.info("Migrating users: adding pin_hash column")
                    conn.execute(text("ALTER TABLE users ADD COLUMN pin_hash VARCHAR(256)"))
                    conn.commit()
                    # Migrate existing plaintext PINs to hashed PINs
                    if 'pin' in cols:
                        from sqlalchemy import text as sql_text
                        rows = conn.execute(sql_text("SELECT id, pin FROM users")).fetchall()
                        for row in rows:
                            hashed = generate_password_hash(row[1])
                            conn.execute(sql_text("UPDATE users SET pin_hash = :hash WHERE id = :id"), {"hash": hashed, "id": row[0]})
                        conn.commit()
                        logger.info(f"Migrated {len(rows)} user PINs to hashed format.")

                # Security: wipe any leftover plaintext PIN in the legacy `pin` column.
                # This column is never written to by the app anymore (pin_hash only),
                # but old rows migrated from a pre-hash schema can still carry the
                # plaintext value here — clear it unconditionally, every startup.
                if 'pin' in cols:
                    conn.execute(text("UPDATE users SET pin = '' WHERE pin IS NOT NULL AND pin != ''"))
                    conn.commit()
                if 'must_change_pin' not in cols:
                    logger.info("Migrating users: adding must_change_pin")
                    conn.execute(text("ALTER TABLE users ADD COLUMN must_change_pin BOOLEAN DEFAULT 0"))
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
                    'plan_pdf_path': "VARCHAR(255)",
                    'archived': "BOOLEAN DEFAULT 0",
                    'archive_zip_path': "VARCHAR(255)",
                    'storage_dir': "VARCHAR(150)",
                    'no_mesure_needed': "BOOLEAN DEFAULT 0",
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
                if 'admin_note' not in cols:
                    logger.info("Migrating entries: adding admin_note")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN admin_note TEXT"))
                    conn.commit()
                if 'client_ref' not in cols:
                    logger.info("Migrating entries: adding client_ref")
                    conn.execute(text("ALTER TABLE entries ADD COLUMN client_ref VARCHAR(64)"))
                    conn.commit()

            # 4. Leaves Table
            if 'leaves' in existing_tables:
                cols = [c['name'] for c in inspector.get_columns('leaves')]
                if 'admin_note' not in cols:
                    logger.info("Migrating leaves: adding admin_note")
                    conn.execute(text("ALTER TABLE leaves ADD COLUMN admin_note TEXT"))
                    conn.commit()

        # One-time migration: fold each chantier's old single plan_pdf_path
        # file into the new multi-document (Plan/Devis/Photos) system, so the
        # unified file explorer shows plans that were uploaded before it existed.
        for chantier in Chantier.query.filter(Chantier.plan_pdf_path.isnot(None)).all():
            already_migrated = Document.query.filter_by(
                chantier_id=chantier.id, category='plan', original_filename=chantier.plan_pdf_path
            ).first()
            if already_migrated:
                continue
            old_path = os.path.join(app.config['UPLOAD_FOLDER'], chantier.plan_pdf_path)
            if not os.path.isfile(old_path):
                continue
            new_filename = f"{uuid.uuid4().hex}.pdf"
            dest_dir = category_dir(chantier, 'plan')
            shutil.copy2(old_path, os.path.join(dest_dir, new_filename))
            db.session.add(Document(
                chantier_id=chantier.id,
                category='plan',
                filename=new_filename,
                original_filename=chantier.plan_pdf_path,
                size_bytes=os.path.getsize(old_path),
                mimetype='application/pdf',
            ))
            logger.info(f"Migrated legacy plan PDF for chantier {chantier.id} into document store")
        db.session.commit()

        # One-time migration: chantier document folders used to be named by
        # numeric ID ("chantiers/1") — rename them to the chantier's own name
        # so the folder structure reads correctly when browsed on disk.
        chantiers_root = os.path.join(app.config['UPLOAD_FOLDER'], 'chantiers')
        if os.path.isdir(chantiers_root):
            for chantier in Chantier.query.filter(Chantier.storage_dir.is_(None)).all():
                legacy_path = os.path.join(chantiers_root, str(chantier.id))
                if os.path.isdir(legacy_path):
                    chantier.storage_dir = str(chantier.id)
                    chantier_storage_dirname(chantier)  # renames on disk + persists the new name
                    logger.info(f"Renamed chantier {chantier.id} document folder to its own name")

        # Create default admin if not exists
        if not User.query.filter_by(username='Admin').first():
            default_pin = str(secrets.randbelow(900000) + 100000)  # Random 6-digit PIN
            admin = User(username='Admin', pin_hash=generate_password_hash(default_pin), role='admin', must_change_pin=True)
            db.session.add(admin)
            db.session.commit()
            logger.warning(f"⚠️ Default Admin created with PIN: {default_pin} — CHANGE IT IMMEDIATELY!")

# --- Routes ---

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.errorhandler(404)
def not_found(e):
    return send_from_directory(app.static_folder, 'index.html')

# API Routes
@app.route('/api/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    data = request.json
    pin = data.get('pin')
    
    # Secure PIN auth with hash comparison
    users = User.query.all()
    user = next((u for u in users if u.check_pin(pin)), None)
    if user:
        token = serializer.dumps({'user_id': user.id})
        response = jsonify(user.to_dict())
        set_auth_cookie(response, token)
        return response
    return jsonify({'error': 'Invalid PIN'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    response = jsonify({'message': 'Logged out'})
    clear_auth_cookie(response)
    return response

@app.route('/api/me', methods=['GET'])
@token_required
def get_me(current_user):
    return jsonify(current_user.to_dict())

@app.route('/api/change-pin', methods=['POST'])
@token_required
def change_pin(current_user):
    data = request.json
    new_pin = data.get('new_pin')
    if not new_pin or len(new_pin) != 6 or not new_pin.isdigit():
        return jsonify({'error': 'PIN must be exactly 6 digits'}), 400
    # Check uniqueness
    users = User.query.all()
    if any(u.check_pin(new_pin) for u in users if u.id != current_user.id):
        return jsonify({'error': 'PIN already in use'}), 400
    current_user.set_pin(new_pin)
    current_user.must_change_pin = False
    db.session.commit()
    return jsonify({'message': 'PIN changed successfully'})

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
        data = request.json or {}
        username = (data.get('username') or '').strip()
        pin = data.get('pin') or ''
        role = data.get('role')

        if not username:
            return jsonify({'error': 'Username is required'}), 400
        if len(pin) != 6 or not pin.isdigit():
            return jsonify({'error': 'PIN must be exactly 6 digits'}), 400
        if role not in ['admin', 'user', 'depanneur']:
            return jsonify({'error': 'Invalid role'}), 400

        if User.query.filter_by(username=username).first():
             return jsonify({'error': 'Username exists'}), 400

        # Check PIN uniqueness via hash comparison
        users = User.query.all()
        if any(u.check_pin(pin) for u in users):
            return jsonify({'error': 'PIN already in use'}), 400

        new_user = User(username=username, pin_hash=generate_password_hash(pin), role=role)
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
            # Check uniqueness via hash comparison
            users = User.query.all()
            if any(u.check_pin(new_pin) for u in users if u.id != user.id):
                return jsonify({'error': 'PIN already in use'}), 400
            user.set_pin(new_pin)
            
        if new_role:
            if new_role not in ['admin', 'user', 'depanneur']:
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

@app.route('/api/holidays/<int:year>', methods=['GET'])
def get_valais_holidays(year):
    import datetime
    
    # Algorithme de Meeus/Jones/Butcher pour calculer la date de Pâques
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    
    easter = datetime.date(year, month, day)
    
    # L'Ascension est 39 jours après Pâques
    ascension = easter + datetime.timedelta(days=39)
    # La Fête-Dieu est 60 jours après Pâques
    fete_dieu = easter + datetime.timedelta(days=60)
    
    holidays_map = {
        f"{year}-01-01": "Nouvel An",
        f"{year}-03-19": "Saint-Joseph",
        ascension.strftime("%Y-%m-%d"): "Ascension",
        fete_dieu.strftime("%Y-%m-%d"): "Fête-Dieu",
        f"{year}-08-01": "Fête nationale",
        f"{year}-08-15": "Assomption",
        f"{year}-11-01": "Toussaint",
        f"{year}-12-08": "Immaculée Conception",
        f"{year}-12-25": "Noël"
    }
    
    return jsonify(holidays_map)

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

        # Batch hours_this_month for the whole list in one grouped query
        # instead of letting each chantier's to_dict() run its own —
        # avoids reintroducing the N+1 pattern already fixed once here.
        month_prefix = datetime.datetime.utcnow().strftime('%Y-%m')
        hours_by_chantier = dict(
            db.session.query(Entry.chantier_id, func.sum(Entry.heures))
            .filter(Entry.date.like(f'{month_prefix}%'))
            .group_by(Entry.chantier_id).all()
        )
        for c in chantiers:
            c._hours_this_month_precomputed = hours_by_chantier.get(c.id, 0.0)

        return jsonify([c.to_dict() for c in chantiers])

    if request.method == 'POST':
        data = request.json or {}
        if not (data.get('nom') or '').strip():
            return jsonify({'error': 'Nom is required'}), 400
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
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        data = request.json
        previous_status = chantier.status
        chantier.nom = data.get('nom', chantier.nom)
        chantier.annee = data.get('annee', chantier.annee)
        chantier.pdf_path = data.get('pdf_path', chantier.pdf_path)
        chantier.address_work = data.get('address_work', chantier.address_work)
        chantier.address_billing = data.get('address_billing', chantier.address_billing)
        chantier.date_start = data.get('date_start', chantier.date_start)
        chantier.date_end = data.get('date_end', chantier.date_end)
        chantier.remarque = data.get('remarque', chantier.remarque)
        chantier.no_mesure_needed = data.get('no_mesure_needed', chantier.no_mesure_needed)
        new_status = data.get('status', chantier.status)

        # Can't close a chantier while a required document is missing —
        # rapport d'intervention always, mesures unless explicitly marked
        # not needed. Checked after applying no_mesure_needed above so
        # ticking the box and closing in the same request works.
        if new_status == 'DONE' and previous_status != 'DONE':
            missing = []
            has_rapport = any(d.category == 'rapport' for d in chantier.documents)
            has_mesure = any(d.category == 'mesure' for d in chantier.documents)
            if not has_rapport:
                missing.append("le rapport d'intervention")
            if not has_mesure and not chantier.no_mesure_needed:
                missing.append("les mesures")
            if missing:
                db.session.rollback()
                return jsonify({'error': f"Impossible de clôturer : il manque {' et '.join(missing)}."}), 409

        chantier.status = new_status

        # Closing a chantier archives its document folder (zipped + originals
        # freed); reopening one re-extracts it. Best-effort: a storage hiccup
        # here shouldn't block the status change itself.
        try:
            if chantier.status == 'DONE' and previous_status != 'DONE':
                archive_chantier_documents(chantier)
            elif chantier.status != 'DONE' and previous_status == 'DONE' and chantier.archived:
                unarchive_chantier_documents(chantier)
        except Exception as e:
            logger.error(f"Archive/unarchive failed for chantier {chantier.id}: {e}")

        # Renaming the chantier renames its document folder to match right
        # away, rather than leaving it under the old name until the next
        # document upload happens to touch it.
        try:
            chantier_storage_dirname(chantier)
        except Exception as e:
            logger.error(f"Could not rename storage folder for chantier {chantier.id}: {e}")

        db.session.commit()
        return jsonify(chantier.to_dict())

def _process_photo(file_storage):
    """Compress an uploaded photo for storage: correct EXIF rotation, cap the
    longest side at 1600px, re-encode as JPEG q=70. This is a real, permanent
    quality tradeoff (there's no way to shrink storage and hand back the
    untouched original) — 1600px/q70 still reads sharp on a phone/tablet
    screen while cutting typical phone-camera file sizes (5-15MB) down to
    well under 150KB in most cases."""
    img = Image.open(file_storage.stream)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')
    max_side = 1600
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format='JPEG', quality=65, optimize=True)
    buf.seek(0)
    return buf

def _compress_pdf(file_storage):
    """Optimize an uploaded PDF for storage. Two passes:
    1. Structural cleanup (strip unused objects, compress streams) — always
       lossless, applies to any PDF. Gains are small on typical office-export
       plans/devis (they're already compact) but real.
    2. Downsample embedded raster images — this is where the actual size wins
       come from, and only matters for scanned/photographed plans (a PDF
       that's just text/vector, like a normal quote, has none). Same
       permanent quality tradeoff as photos: capped resolution + JPEG
       re-encode. Any single image is skipped (left as-is) if that doesn't
       actually shrink it or if it can't be decoded, so a weird embedded
       asset never risks corrupting the document."""
    doc = fitz.open(stream=file_storage.read(), filetype='pdf')

    for page in doc:
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                extracted = doc.extract_image(xref)
                pil_img = Image.open(BytesIO(extracted['image']))
                if pil_img.mode not in ('RGB', 'L'):
                    pil_img = pil_img.convert('RGB')
                max_side = 1800
                if max(pil_img.size) > max_side:
                    pil_img.thumbnail((max_side, max_side), Image.LANCZOS)
                out = BytesIO()
                pil_img.save(out, format='JPEG', quality=70, optimize=True)
                if len(out.getvalue()) < len(extracted['image']):
                    page.replace_image(xref, stream=out.getvalue())
            except Exception:
                continue

    buf = BytesIO()
    doc.save(buf, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True)
    doc.close()
    buf.seek(0)
    return buf

@app.route('/api/chantiers/<int:id>/documents', methods=['GET', 'POST'])
@token_required
def manage_documents(current_user, id):
    chantier = Chantier.query.get_or_404(id)

    if request.method == 'GET':
        docs = Document.query.filter_by(chantier_id=id).order_by(Document.uploaded_at.desc()).all()
        return jsonify({
            'archived': bool(chantier.archived),
            'documents': [d.to_dict() for d in docs],
        })

    # POST — upload one file
    if chantier.archived:
        return jsonify({'error': 'Ce chantier est clôturé et archivé — rouvrez-le pour ajouter des documents'}), 409

    category = request.form.get('category')
    if category not in DOCUMENT_CATEGORIES:
        return jsonify({'error': 'Invalid category'}), 400
    # Plans/devis are contractual documents — admin only. Photos, mesures and
    # rapports d'intervention are field deliverables — any worker can add them.
    if category in ('plan', 'devis') and current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    if 'file' not in request.files or request.files['file'].filename == '':
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']

    required_word = CATEGORY_FILENAME_REQUIREMENTS.get(category)
    if required_word and not _filename_contains_word(file.filename, required_word):
        return jsonify({'error': f'Le nom du fichier doit contenir le mot "{required_word}"'}), 400

    if category in ('plan', 'devis', 'mesure', 'rapport'):
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Only PDF files are allowed'}), 400
        header = file.read(5)
        file.seek(0)
        if header != b'%PDF-':
            return jsonify({'error': 'File is not a valid PDF'}), 400
        try:
            compressed = _compress_pdf(file)
        except Exception:
            return jsonify({'error': 'File is not a valid PDF'}), 400
        new_filename = f"{uuid.uuid4().hex}.pdf"
        dest = os.path.join(category_dir(chantier, category), new_filename)
        with open(dest, 'wb') as f:
            f.write(compressed.getbuffer())
        mimetype = 'application/pdf'
    else:
        try:
            compressed = _process_photo(file)
        except Exception:
            return jsonify({'error': 'File is not a valid image'}), 400
        new_filename = f"{uuid.uuid4().hex}.jpg"
        dest = os.path.join(category_dir(chantier, category), new_filename)
        with open(dest, 'wb') as f:
            f.write(compressed.getbuffer())
        mimetype = 'image/jpeg'

    doc = Document(
        chantier_id=id,
        category=category,
        filename=new_filename,
        original_filename=file.filename,
        size_bytes=os.path.getsize(dest),
        mimetype=mimetype,
        uploaded_by_id=current_user.id,
    )
    db.session.add(doc)
    db.session.commit()
    return jsonify(doc.to_dict()), 201

@app.route('/api/documents/<int:doc_id>', methods=['GET', 'DELETE'])
@token_required
def document_detail(current_user, doc_id):
    doc = Document.query.get_or_404(doc_id)

    if request.method == 'DELETE':
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        disk_path = document_disk_path(doc)
        if os.path.isfile(disk_path):
            os.remove(disk_path)
        db.session.delete(doc)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    disk_path = document_disk_path(doc)
    if not os.path.isfile(disk_path):
        return jsonify({'error': 'Fichier introuvable (chantier peut-être archivé)'}), 404
    return send_file(disk_path, as_attachment=True, download_name=doc.original_filename, mimetype=doc.mimetype)

@app.route('/api/documents/<int:doc_id>/thumbnail', methods=['GET'])
@token_required
def document_thumbnail(current_user, doc_id):
    """Small on-the-fly JPEG for photo grids — the DocumentExplorer used to
    load the full compressed photo (up to ~150KB) just to show it in a
    thumbnail-sized cell. Computed per-request rather than stored: cheap
    (resizing an already-small source) and keeps storage at exactly one file
    per photo."""
    doc = Document.query.get_or_404(doc_id)
    if doc.category != 'photo':
        return jsonify({'error': 'Not a photo'}), 400
    disk_path = document_disk_path(doc)
    if not os.path.isfile(disk_path):
        return jsonify({'error': 'Fichier introuvable (chantier peut-être archivé)'}), 404
    try:
        img = Image.open(disk_path)
        img.thumbnail((300, 300), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format='JPEG', quality=60)
        buf.seek(0)
    except Exception as e:
        logger.error(f"Thumbnail generation failed for document {doc_id}: {e}")
        return jsonify({'error': 'Impossible de générer la miniature'}), 500
    return send_file(buf, mimetype='image/jpeg')

@app.route('/api/chantiers/<int:id>/documents/zip', methods=['GET'])
@token_required
def download_documents_zip(current_user, id):
    chantier = Chantier.query.get_or_404(id)
    category = request.args.get('category', 'all')

    if chantier.archived:
        if not chantier.archive_zip_path:
            return jsonify({'error': 'Archive introuvable'}), 404
        path = os.path.join(app.config['ARCHIVE_FOLDER'], chantier.archive_zip_path)
        return send_file(path, as_attachment=True, download_name=f"{chantier.nom}_archive.zip")

    query = Document.query.filter_by(chantier_id=id)
    if category != 'all':
        if category not in DOCUMENT_CATEGORIES:
            return jsonify({'error': 'Invalid category'}), 400
        query = query.filter_by(category=category)
    docs = query.all()
    if not docs:
        return jsonify({'error': 'Aucun document'}), 404

    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.zip')
    os.close(tmp_fd)
    with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for doc in docs:
            disk_path = document_disk_path(doc)
            if os.path.isfile(disk_path):
                zf.write(disk_path, f"{CATEGORY_FOLDERS[doc.category]}/{doc.original_filename}")

    @after_this_request
    def cleanup(response):
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return response

    label = category if category != 'all' else 'complet'
    return send_file(tmp_path, as_attachment=True, download_name=f"{chantier.nom}_{label}.zip")

@app.route('/api/chantiers/<int:chantier_id>/members', methods=['POST', 'DELETE'])
@token_required
def manage_chantier_members(current_user, chantier_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
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
    data = request.json or {}

    # Seul un admin peut créer une entrée pour un autre user
    target_user_id = data.get('user_id', current_user.id)
    if target_user_id != current_user.id and current_user.role != 'admin':
        return jsonify({'error': 'Cannot create entry for another user'}), 403

    chantier_id = data.get('chantier_id')
    date = data.get('date')
    if not chantier_id or not date:
        return jsonify({'error': 'chantier_id and date are required'}), 400
    if not db.session.get(Chantier, chantier_id):
        return jsonify({'error': 'Chantier not found'}), 404

    try:
        heures = float(data.get('heures', 0))
        materiel = float(data.get('materiel', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'heures/materiel must be numbers'}), 400
    if heures < 0 or materiel < 0:
        return jsonify({'error': 'heures/materiel cannot be negative'}), 400

    # Offline-queued submissions (see frontend offlineQueue.ts) carry a
    # client-generated ref — if a retry's earlier attempt actually succeeded
    # but its response got lost (dropped connection), this recognizes it as
    # already-done instead of creating a duplicate entry.
    client_ref = data.get('client_ref')
    if client_ref:
        existing = Entry.query.filter_by(client_ref=client_ref).first()
        if existing:
            return jsonify(existing.to_dict()), 200

    new_entry = Entry(
        user_id=target_user_id,
        chantier_id=chantier_id,
        date=date,
        heures=heures,
        materiel=materiel,
        status='PENDING',
        created_by_id=data.get('created_by_id', current_user.id),
        client_ref=client_ref
    )
    db.session.add(new_entry)
    db.session.commit()
    return jsonify(new_entry.to_dict()), 201

@app.route('/api/entries/pending', methods=['GET'])
@token_required
def get_pending_entries(current_user):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    entries = Entry.query.filter_by(status='PENDING').all()
    return jsonify([e.to_dict() for e in entries])

@app.route('/api/entries/<int:entry_id>/validate', methods=['PUT'])
@token_required
def validate_entry(current_user, entry_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404
    entry.status = 'VALIDATED'
    db.session.commit()
    return jsonify(entry.to_dict())

@app.route('/api/entries/<int:entry_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_entry(current_user, entry_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    entry = Entry.query.get(entry_id)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    if request.method == 'DELETE':
        db.session.delete(entry)
        db.session.commit()
        return jsonify({'message': 'Entry deleted'})

    if request.method == 'PUT':
        data = request.json or {}
        try:
            heures = float(data.get('heures', entry.heures))
            materiel = float(data.get('materiel', entry.materiel))
        except (TypeError, ValueError):
            return jsonify({'error': 'heures/materiel must be numbers'}), 400
        if heures < 0 or materiel < 0:
            return jsonify({'error': 'heures/materiel cannot be negative'}), 400
        entry.heures = heures
        entry.materiel = materiel
        if 'status' in data:
            entry.status = data['status']
        if 'admin_note' in data:
            entry.admin_note = data['admin_note']

        db.session.commit()
        return jsonify(entry.to_dict())

def compute_days_count(date_start, date_end):
    """Calendar-day count, inclusive, computed server-side (never trust client input)."""
    start = datetime.datetime.strptime(date_start, "%Y-%m-%d").date()
    end = datetime.datetime.strptime(date_end, "%Y-%m-%d").date()
    if end < start:
        raise ValueError("date_end is before date_start")
    return float((end - start).days + 1)

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
        data = request.json or {}

        target_user_id = data.get('user_id', current_user.id)
        # Same rule as entries: only admin can file a leave request for someone else.
        if target_user_id != current_user.id and current_user.role != 'admin':
            return jsonify({'error': 'Cannot create a leave request for another user'}), 403
        if not db.session.get(User, target_user_id):
            return jsonify({'error': 'User not found'}), 404

        leave_type = data.get('type')
        if leave_type not in ['VACATION', 'SICKNESS', 'OTHER']:
            return jsonify({'error': 'Invalid type'}), 400

        try:
            days_count = compute_days_count(data['date_start'], data['date_end'])
        except (KeyError, ValueError) as e:
            return jsonify({'error': f'Invalid dates: {e}'}), 400

        new_leave = Leave(
            user_id=target_user_id,
            type=leave_type,
            date_start=data['date_start'],
            date_end=data['date_end'],
            days_count=days_count,
            status='PENDING'
        )
        db.session.add(new_leave)
        db.session.commit()
        return jsonify(new_leave.to_dict()), 201

@app.route('/api/leaves/<int:leave_id>/status', methods=['PUT'])
@token_required
def update_leave_status(current_user, leave_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
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

@app.route('/api/leaves/<int:leave_id>', methods=['PUT', 'DELETE'])
@token_required
def manage_single_leave(current_user, leave_id):
    leave = Leave.query.get(leave_id)
    if not leave:
        return jsonify({'error': 'Leave not found'}), 404

    is_admin = current_user.role == 'admin'
    is_owner = leave.user_id == current_user.id

    # Only admin, or the owner while the request is still PENDING, may touch it.
    # Approving/rejecting stays exclusive to PUT /api/leaves/<id>/status.
    if not is_admin and not (is_owner and leave.status == 'PENDING'):
        return jsonify({'error': 'Admin access required'}), 403

    if request.method == 'DELETE':
        db.session.delete(leave)
        db.session.commit()
        return jsonify({'message': 'Leave deleted'})

    if request.method == 'PUT':
        data = request.json or {}
        if 'type' in data:
            if data['type'] not in ['VACATION', 'SICKNESS', 'OTHER']:
                return jsonify({'error': 'Invalid type'}), 400
            leave.type = data['type']
        if 'date_start' in data:
            leave.date_start = data['date_start']
        if 'date_end' in data:
            leave.date_end = data['date_end']
        # Only admin can attach an admin note or change status from here.
        if is_admin and 'admin_note' in data:
            leave.admin_note = data['admin_note']
        if is_admin and 'status' in data:
            leave.status = data['status']
        # days_count is always recomputed server-side from the (possibly just
        # updated) dates — never trust a client-supplied value here.
        try:
            leave.days_count = compute_days_count(leave.date_start, leave.date_end)
        except ValueError as e:
            return jsonify({'error': f'Invalid dates: {e}'}), 400

        db.session.commit()
        return jsonify(leave.to_dict())

@app.route('/api/chantiers/<int:chantier_id>/alerts', methods=['GET', 'POST'])
@token_required
def manage_alerts(current_user, chantier_id):
    if request.method == 'GET':
        alerts = Alert.query.filter_by(chantier_id=chantier_id).all()
        return jsonify([a.to_dict() for a in alerts])

    if request.method == 'POST':
        if current_user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        if not db.session.get(Chantier, chantier_id):
            return jsonify({'error': 'Chantier not found'}), 404
        data = request.json or {}
        if not (data.get('title') or '').strip():
            return jsonify({'error': 'Title is required'}), 400
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
    if current_user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
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

def csv_safe(value):
    """Neutralize CSV/formula injection: Excel/Sheets execute a cell starting
    with =, +, -, @, tab or CR as a formula when the file is opened. Any of
    those fields here (chantier name, username) is admin/employee-controlled
    input, so prefix with a literal apostrophe to force text interpretation."""
    s = str(value)
    if s and s[0] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + s
    return s

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
            csv_safe(e.chantier.nom if e.chantier else 'Supprimé'),
            csv_safe(e.user.username if e.user else 'Inconnu'),
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

# Error handlers: never leak a raw traceback to the client, always JSON.
from sqlalchemy.exc import IntegrityError

@app.errorhandler(IntegrityError)
def handle_integrity_error(e):
    db.session.rollback()
    logger.warning(f"IntegrityError: {e}")
    return jsonify({'error': 'Invalid or inconsistent data (constraint violation)'}), 400

@app.errorhandler(500)
def handle_internal_error(e):
    db.session.rollback()
    logger.error(f"Unhandled error: {e}")
    return jsonify({'error': 'Internal server error'}), 500

# Security Headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    return response

# Initialize Database (Run migration)
init_db()

if __name__ == '__main__':
    # Fail closed: debug only turns on if FLASK_ENV is explicitly 'development'.
    # Previously this defaulted to debug=True whenever FLASK_ENV was unset/misspelled.
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('FLASK_ENV') == 'development')
