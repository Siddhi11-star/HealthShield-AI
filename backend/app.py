from auth_utils import get_current_user, get_token_user, require_roles
from flask import Flask, request, jsonify, make_response, send_file
from flask_cors import CORS
from config import get_db
import hashlib, random, string, datetime, json
import csv
from io import StringIO

# Import the external feature modules
from teleconsult_v2 import _create_zoom_meeting, register_teleconsult_routes
from pharmacy_routes import register_pharmacy_routes
from ai_safety_guard import register_ai_safety_guard_routes
from ai_clinical_intelligence import register_ai_clinical_routes
from auth_routes import register_auth_routes
from doctor_portal import register_doctor_portal

app = Flask(__name__)
CORS(app)

# Register the external feature routes (teleconsultation and pharmacy)
register_teleconsult_routes(app)
register_pharmacy_routes(app)
register_ai_safety_guard_routes(app)
register_ai_clinical_routes(app)
register_auth_routes(app)
register_doctor_portal(app)

# ════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════

def hash_password(p):
    return hashlib.sha256(p.encode()).hexdigest()

def get_token_user(req):
    """Extract user_id from Bearer token. Returns None if invalid."""
    token = req.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if token.startswith("mg_token_"):
        try:
            return int(token.replace("mg_token_", ""))
        except Exception as e:
            print(e)
    return None


def parse_appointment_datetime(preferred_date, time_slot):
    if not preferred_date:
        return None

    candidates = []
    if time_slot:
        cleaned = str(time_slot).replace("–", "-").strip()
        first_part = cleaned.split("-")[0].strip()
        candidates.extend([cleaned, first_part])

    for candidate in candidates or ["10:00 AM"]:
        for fmt in ("%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M", "%Y-%m-%d %I:%M"):
            try:
                return datetime.datetime.strptime(f"{preferred_date} {candidate}", fmt)
            except Exception:
                continue

    try:
        return datetime.datetime.fromisoformat(f"{preferred_date}T10:00:00")
    except Exception:
        return None


def serialize_datetime(value):
    return value.isoformat() if value and hasattr(value, "isoformat") else value

def audit(db, user_id, action, entity, entity_id=None, details=""):
    """Write an entry to audit_log. Silently ignores errors."""
    try:
        c = db.cursor()
        c.execute(
            "INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (%s,%s,%s,%s,%s)",
            (user_id, action, entity, entity_id, details)
        )
        db.commit()
    except Exception as e:
        print(e)

def ensure_tables(db):
    """
    Create all necessary tables if they don't exist.
    Also seeds initial doctors and sample pharmacy data.
    """
    c = db.cursor()

    # --- Existing tables (unchanged) ---
    c.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            `key`      VARCHAR(100) NOT NULL UNIQUE,
            value      VARCHAR(255) NOT NULL DEFAULT '1',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            user_id    INT,
            action     VARCHAR(100) NOT NULL,
            entity     VARCHAR(100),
            entity_id  INT,
            details    TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS safety_alerts_log (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            patient_id      INT,
            prescription_id INT,
            drug_a          VARCHAR(200),
            drug_b          VARCHAR(200),
            effect          TEXT,
            severity        VARCHAR(50) DEFAULT 'moderate',
            resolved        TINYINT(1) DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS contact_messages (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            name       VARCHAR(200),
            email      VARCHAR(200),
            subject    VARCHAR(200),
            message    TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            name       VARCHAR(200) NOT NULL,
            email      VARCHAR(200) NOT NULL UNIQUE,
            password   VARCHAR(255) NOT NULL,
            role       VARCHAR(50) NOT NULL DEFAULT 'patient',
            specialty  VARCHAR(100) DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS appointments (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            patient_user_id  INT DEFAULT NULL,
            doctor_user_id   INT DEFAULT NULL,
            doctor_id        INT DEFAULT NULL,
            patient_name     VARCHAR(200) NOT NULL,
            age              INT DEFAULT NULL,
            gender           VARCHAR(20) DEFAULT 'Male',
            specialty        VARCHAR(100),
            preferred_date   DATE DEFAULT NULL,
            time_slot        VARCHAR(100),
            scheduled_at     DATETIME DEFAULT NULL,
            symptoms         TEXT,
            mode             VARCHAR(20) DEFAULT 'video',
            status           VARCHAR(30) DEFAULT 'pending',
            zoom_meeting_id  VARCHAR(100) DEFAULT NULL,
            zoom_join_url    TEXT,
            zoom_start_url   TEXT,
            zoom_password    VARCHAR(50) DEFAULT NULL,
            link_status      VARCHAR(30) DEFAULT 'not_required',
            zoom_error       TEXT,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_appt_patient_user (patient_user_id),
            INDEX idx_appt_doctor_user  (doctor_user_id),
            INDEX idx_appt_status       (status),
            INDEX idx_appt_scheduled    (scheduled_at)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            user_id    INT NOT NULL,
            type       VARCHAR(50) DEFAULT 'system',
            title      VARCHAR(255) NOT NULL,
            message    TEXT,
            data       JSON DEFAULT NULL,
            is_read    TINYINT(1) DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_notifications_user (user_id),
            INDEX idx_notifications_read (is_read)
        )
    """)

    # --- NEW: Teleconsultation tables ---
    c.execute("""
        CREATE TABLE IF NOT EXISTS consultations (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            appointment_id      INT DEFAULT NULL,
            patient_name        VARCHAR(200),
            patient_phone       VARCHAR(30),
            doctor_name         VARCHAR(200),
            doctor_id           INT DEFAULT NULL,
            specialty           VARCHAR(100),
            zoom_meeting_id     VARCHAR(100),
            zoom_join_url       TEXT,
            zoom_start_url      TEXT,
            zoom_password       VARCHAR(50),
            zoom_meeting_topic  VARCHAR(300),
            status              VARCHAR(30) DEFAULT 'scheduled',
            scheduled_at        DATETIME,
            started_at          DATETIME,
            ended_at            DATETIME,
            duration_minutes    INT DEFAULT NULL,
            notes               TEXT,
            diagnosis           TEXT,
            prescription_issued TEXT,
            follow_up_date      DATE DEFAULT NULL,
            mode                VARCHAR(20) DEFAULT 'video',
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_con_apt    (appointment_id),
            INDEX idx_con_doctor (doctor_id),
            INDEX idx_con_status (status)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS doctors (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            name         VARCHAR(200) NOT NULL,
            specialty    VARCHAR(100),
            qualification VARCHAR(200),
            experience_yrs INT DEFAULT 0,
            phone        VARCHAR(30),
            email        VARCHAR(200),
            avatar_initials VARCHAR(5),
            avatar_color VARCHAR(50) DEFAULT '#3b82f6',
            status       VARCHAR(20) DEFAULT 'available',
            rating       DECIMAL(3,2) DEFAULT 4.50,
            consult_fee  DECIMAL(10,2) DEFAULT 300.00,
            zoom_user_id VARCHAR(200) DEFAULT NULL,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # --- NEW: Pharmacy tables ---
    c.execute("""
        CREATE TABLE IF NOT EXISTS pharmacies (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            owner_id    INT DEFAULT NULL,
            name        VARCHAR(200) NOT NULL,
            address     TEXT,
            area        VARCHAR(100),
            city        VARCHAR(100) DEFAULT 'Pune',
            state       VARCHAR(50)  DEFAULT 'Maharashtra',
            pincode     VARCHAR(10),
            phone       VARCHAR(30),
            latitude    DECIMAL(10,7),
            longitude   DECIMAL(10,7),
            open_hours  VARCHAR(100) DEFAULT '8:00 AM – 10:00 PM',
            is_24hr     TINYINT(1)   DEFAULT 0,
            has_delivery TINYINT(1)  DEFAULT 0,
            rating      DECIMAL(3,2) DEFAULT 4.00,
            license_no  VARCHAR(100),
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pharm_area (area)
        )
    """)
    # Patch: add owner_id if missing from existing pharmacies table
    try:
        c.execute("SHOW COLUMNS FROM pharmacies LIKE 'owner_id'")
        if not c.fetchone():
            c.execute("ALTER TABLE pharmacies ADD COLUMN owner_id INT DEFAULT NULL")
            db.commit()
    except Exception as e:
        print("Migration error (pharmacies.owner_id):", e)

    # --- NEW: Digital Health Records tables ---
    c.execute("""
        CREATE TABLE IF NOT EXISTS patients (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            name                VARCHAR(200) NOT NULL,
            age                 INT NOT NULL,
            gender              VARCHAR(20) DEFAULT 'Male',
            blood_group         VARCHAR(10) DEFAULT 'O+',
            phone               VARCHAR(30),
            village             VARCHAR(100),
            current_medications TEXT,
            known_allergies     TEXT,
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS prescriptions (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            patient_id     INT NOT NULL,
            medicine_name  VARCHAR(200) NOT NULL,
            dosage         VARCHAR(100),
            duration       VARCHAR(100),
            doctor_name    VARCHAR(200),
            notes          TEXT,
            safety_status  VARCHAR(20) DEFAULT 'SAFE',
            safety_message TEXT,
            reminder_time  VARCHAR(50),  -- New: morning/evening or specific time
            created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS medical_reports (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            patient_id  INT NOT NULL,
            file_name   VARCHAR(255) NOT NULL,
            file_path   VARCHAR(500) NOT NULL,
            file_type   VARCHAR(50),  -- pdf, jpg, png, etc.
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
    """)

    for table_name, column_sql in [
        ("users", "ALTER TABLE users ADD COLUMN specialty VARCHAR(100) DEFAULT NULL"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN patient_user_id INT DEFAULT NULL"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN doctor_user_id INT DEFAULT NULL"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN doctor_id INT DEFAULT NULL"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN scheduled_at DATETIME DEFAULT NULL"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN zoom_meeting_id VARCHAR(100) DEFAULT NULL"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN zoom_join_url TEXT"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN zoom_start_url TEXT"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN zoom_password VARCHAR(50) DEFAULT NULL"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN link_status VARCHAR(30) DEFAULT 'not_required'"),
        ("appointments", "ALTER TABLE appointments ADD COLUMN zoom_error TEXT"),
        ("consultations", "ALTER TABLE consultations ADD COLUMN patient_user_id INT DEFAULT NULL"),
        ("consultations", "ALTER TABLE consultations ADD COLUMN doctor_user_id INT DEFAULT NULL"),
        ("consultations", "ALTER TABLE consultations ADD COLUMN link_status VARCHAR(30) DEFAULT 'generated'"),
        ("consultations", "ALTER TABLE consultations ADD COLUMN zoom_error TEXT"),
    ]:
        try:
            col_name = column_sql.split(" ADD COLUMN ", 1)[1].split()[0]
            c.execute(f"SHOW COLUMNS FROM {table_name} LIKE %s", (col_name,))
            if not c.fetchone():
                c.execute(column_sql)
        except Exception as e:
            print(f"Migration error ({table_name}.{col_name}):", e)

    try:
        c.execute("ALTER TABLE appointments MODIFY COLUMN status VARCHAR(30) DEFAULT 'pending'")
    except Exception as e:
        print("Migration error (appointments.status type):", e)

    try:
        c.execute("ALTER TABLE appointments MODIFY COLUMN mode VARCHAR(20) DEFAULT 'video'")
    except Exception as e:
        print("Migration error (appointments.mode type):", e)

    # --- Chat messages table ---
    c.execute("""
        CREATE TABLE IF NOT EXISTS apt_chat_messages (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            appointment_id INT NOT NULL,
            sender_id      INT NOT NULL,
            sender_name    VARCHAR(200) NOT NULL,
            sender_role    VARCHAR(50)  NOT NULL DEFAULT 'patient',
            message        TEXT NOT NULL,
            created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_chat_apt (appointment_id),
            INDEX idx_chat_created (created_at)
        )
    """)

    db.commit()

    # --- Seed default doctors if table is empty ---
    c.execute("SELECT COUNT(*) as cnt FROM doctors")
    if c.fetchone()[0] == 0:
        doctors_data = [
            (1,  'Dr. Rahul Sharma',     'General Physician',  'MBBS, MD',           12, '9876543210', 'rahul@mediguard.in',  'RS', 'linear-gradient(135deg,#3b82f6,#2563eb)', 'available', 4.8, 300),
            (2,  'Dr. Priya Kulkarni',   'Pediatrician',       'MBBS, DCH',           8, '9876543211', 'priya@mediguard.in',  'PK', 'linear-gradient(135deg,#22c55e,#16a34a)', 'available', 4.9, 400),
            (3,  'Dr. Anil Mehta',       'Cardiologist',       'MBBS, MD, DM',       15, '9876543212', 'anil@mediguard.in',   'AM', 'linear-gradient(135deg,#a855f7,#9333ea)', 'busy',      4.7, 600),
            (4,  'Dr. Sneha Joshi',      'Dermatologist',      'MBBS, MD Derma',      7, '9876543213', 'sneha@mediguard.in',  'SJ', 'linear-gradient(135deg,#f97316,#ea580c)', 'available', 4.6, 450),
            (5,  'Dr. Vijay Rao',        'Diabetologist',      'MBBS, MD, FRCP',     10, '9876543214', 'vijay@mediguard.in',  'VR', 'linear-gradient(135deg,#06b6d4,#0891b2)', 'available', 4.9, 500),
            (6,  'Dr. Meera Patil',      'Gynaecologist',      'MBBS, MS OBG',       14, '9876543215', 'meera@mediguard.in',  'MP', 'linear-gradient(135deg,#ec4899,#db2777)', 'available', 4.8, 550),
            (7,  'Dr. Sanjay Deshmukh',  'Orthopaedic',        'MBBS, MS Ortho',     18, '9876543216', 'sanjay@mediguard.in', 'SD', 'linear-gradient(135deg,#84cc16,#65a30d)', 'available', 4.7, 500),
            (8,  'Dr. Kavita Nair',      'Neurologist',        'MBBS, MD, DM Neuro',  9, '9876543217', 'kavita@mediguard.in', 'KN', 'linear-gradient(135deg,#f59e0b,#d97706)', 'offline',   4.5, 700),
        ]
        for d in doctors_data:
            c.execute("""
                INSERT INTO doctors
                (id, name, specialty, qualification, experience_yrs, phone, email,
                 avatar_initials, avatar_color, status, rating, consult_fee)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, d)
        db.commit()

    # --- Seed a few sample pharmacies if the table is empty ---
    c.execute("SELECT COUNT(*) as cnt FROM pharmacies")
    if c.fetchone()[0] == 0:
        sample_pharmacies = [
            ('Apollo Pharmacy – Koregaon Park', 'Lane 5, Koregaon Park, Pune', 'Koregaon Park', '411001', '020-26120001', 18.5362, 73.8939, '8:00 AM – 11:00 PM', 0, 1, 4.7),
            ('MedPlus Pharmacy – North Main Road', 'North Main Road, Koregaon Park, Pune', 'Koregaon Park', '411001', '020-26120002', 18.5370, 73.8950, '8:00 AM – 10:00 PM', 0, 1, 4.5),
            ('24Hr LifeCare Pharmacy – Kalyani Nagar', 'Wanowrie Road, Kalyani Nagar, Pune', 'Kalyani Nagar', '411006', '020-27130002', 18.5450, 73.9032, '24 Hours', 1, 1, 4.6),
            ('Apollo Pharmacy – Shivajinagar', 'FC Road, Shivajinagar, Pune', 'Shivajinagar', '411005', '020-25513001', 18.5308, 73.8474, '8:00 AM – 10:00 PM', 0, 1, 4.8),
            ('Netmeds Pharmacy – Aundh', 'ITI Road, Aundh, Pune', 'Aundh', '411007', '020-25893001', 18.5642, 73.8197, '8:00 AM – 10:00 PM', 0, 1, 4.6),
        ]
        for p in sample_pharmacies:
            c.execute("""
                INSERT INTO pharmacies
                (name, address, area, pincode, phone, latitude, longitude,
                 open_hours, is_24hr, has_delivery, rating)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, p)
        db.commit()

# ════════════════════════════════════════
# AUTH
# ════════════════════════════════════════

@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.json
    name     = data.get("name")
    email    = data.get("email")
    password = hash_password(data.get("password", ""))
    role     = data.get("role", "doctor")
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor()
        cursor.execute(
            "INSERT INTO users (name,email,password,role) VALUES (%s,%s,%s,%s)",
            (name, email, password, role)
        )
        db.commit()
        uid  = cursor.lastrowid
        user = {"id": uid, "name": name, "email": email, "role": role}
        audit(db, uid, "REGISTER", "users", uid, f"New user: {email}")
        if role == 'pharmacist':
            try:
                cursor.execute(
                    "INSERT INTO pharmacies (owner_id, name, address, area, city, state, phone, open_hours, has_delivery, rating) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (uid, f"{name}'s Pharmacy", None, None, 'Pune', 'Maharashtra', '', '8:00 AM – 10:00 PM', 0, 4.0)
                )
                db.commit()
            except Exception as e:
                print(f"Auto-create pharmacy failed for pharmacist {uid}: {e}")
        return jsonify({"message": "Registered successfully",
                        "token": "mg_token_" + str(uid),
                        "user": user}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/auth/login", methods=["POST"])
def login():
    data     = request.json
    email    = data.get("email")
    password = hash_password(data.get("password", ""))
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT * FROM users WHERE email=%s AND password=%s", (email, password)
        )
        user = cursor.fetchone()
        if user:
            user.pop("password")
            audit(db, user["id"], "LOGIN", "users", user["id"], f"Login: {email}")
            return jsonify({"message": "Login successful",
                            "token": "mg_token_" + str(user["id"]),
                            "user": user})
        return jsonify({"error": "Invalid email or password"}), 401
    finally:
        db.close()


@app.route("/api/auth/me", methods=["GET"])
def me():
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if token.startswith("mg_token_"):
        try:
            uid    = int(token.replace("mg_token_", ""))
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT id,name,email,role FROM users WHERE id=%s", (uid,))
            user = cursor.fetchone()
            db.close()
            if user:
                return jsonify({"user": user})
        except Exception as e:
            print(e)
    return jsonify({"error": "Unauthorized"}), 401


@app.route("/api/auth/change-password", methods=["POST"])
def change_password():
    data         = request.json
    email        = data.get("email")
    old_password = data.get("old_password")
    new_password = data.get("new_password")
    if not email or not old_password or not new_password:
        return jsonify({"error": "All fields required"}), 400
    hashed_old = hash_password(old_password)
    hashed_new = hash_password(new_password)
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT * FROM users WHERE email=%s AND password=%s", (email, hashed_old)
        )
        user = cursor.fetchone()
        if not user:
            return jsonify({"error": "Current password is incorrect"}), 401
        cursor2 = db.cursor()
        cursor2.execute(
            "UPDATE users SET password=%s WHERE email=%s", (hashed_new, email)
        )
        db.commit()
        audit(db, user["id"], "CHANGE_PASSWORD", "users", user["id"], email)
        return jsonify({"message": "Password changed successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/auth/update-profile", methods=["POST"])
def update_profile():
    data    = request.json
    user_id = data.get("id")
    name    = data.get("name")
    role    = data.get("role")
    if not user_id or not name:
        return jsonify({"error": "Name and ID required"}), 400
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            "UPDATE users SET name=%s, role=%s WHERE id=%s", (name, role, user_id)
        )
        db.commit()
        audit(db, user_id, "UPDATE_PROFILE", "users", user_id, f"name={name}, role={role}")
        return jsonify({"message": "Profile updated successfully",
                        "user": {"id": user_id, "name": name, "role": role}})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


# ════════════════════════════════════════
# FEATURE 1 — SYSTEM SETTINGS (read + write)
# ════════════════════════════════════════

@app.route("/api/settings", methods=["GET"])
def get_settings():
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT `key`, value FROM system_settings")
        rows = cursor.fetchall()
        settings = {r["key"]: r["value"] for r in rows}
        # Seed defaults if empty
        defaults = {
            "auto_safety_check": "1",
            "block_critical_prescriptions": "0",
            "email_safety_alerts": "1",
            "low_stock_threshold": "10",
        }
        for k, v in defaults.items():
            if k not in settings:
                settings[k] = v
        return jsonify({"settings": settings})
    finally:
        db.close()


@app.route("/api/settings", methods=["POST"])
def save_setting():
    data  = request.json
    key   = data.get("key")
    value = str(data.get("value", "1"))
    if not key:
        return jsonify({"error": "Key required"}), 400
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor()
        cursor.execute(
            "INSERT INTO system_settings (`key`, value) VALUES (%s,%s) "
            "ON DUPLICATE KEY UPDATE value=%s, updated_at=NOW()",
            (key, value, value)
        )
        db.commit()
        return jsonify({"message": "Setting saved", "key": key, "value": value})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/settings/bulk", methods=["POST"])
def save_settings_bulk():
    settings = request.json.get("settings", {})
    if not settings:
        return jsonify({"error": "Settings object required"}), 400
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor()
        for k, v in settings.items():
            cursor.execute(
                "INSERT INTO system_settings (`key`, value) VALUES (%s,%s) "
                "ON DUPLICATE KEY UPDATE value=%s, updated_at=NOW()",
                (k, str(v), str(v))
            )
        db.commit()
        return jsonify({"message": "Settings saved", "count": len(settings)})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


# ════════════════════════════════════════
# FEATURE 2 — AUDIT LOG
# ════════════════════════════════════════

@app.route("/api/admin/audit-log", methods=["GET"])
def get_audit_log():
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT al.*, u.name as user_name
            FROM audit_log al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC LIMIT 100
        """)
        return jsonify({"logs": cursor.fetchall()})
    finally:
        db.close()


# ════════════════════════════════════════
# STATS & ANALYTICS
# ════════════════════════════════════════

@app.route("/api/stats", methods=["GET"])
def stats():
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor()

        cursor.execute("SELECT COUNT(*) FROM patients")
        patients = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM prescriptions")
        prescriptions = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM medicines")
        medicines = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM appointments")
        appointments = cursor.fetchone()[0]

        # FEATURE 3 — alerts = real unresolved drug-interaction safety alerts
        cursor.execute(
            "SELECT COUNT(*) FROM safety_alerts_log WHERE resolved=0"
        )
        alerts = cursor.fetchone()[0]

        # Also count low-stock for separate field
        uid = get_token_user(request)
        if uid:
            cursor.execute(
                "SELECT COUNT(*) FROM medicines WHERE owner_id=%s AND quantity <= min_stock_level",
                (uid,)
            )
        else:
            cursor.execute(
                "SELECT COUNT(*) FROM medicines WHERE quantity <= min_stock_level"
            )
        low_stock = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM drug_interactions")
        interactions = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM users")
        users = cursor.fetchone()[0]

        return jsonify({
            "patients": patients, "prescriptions": prescriptions,
            "medicines": medicines, "appointments": appointments,
            "inventory": medicines, "alerts": alerts,
            "low_stock": low_stock, "interactions": interactions, "users": users
        })
    finally:
        db.close()


@app.route("/api/analytics", methods=["GET"])
def analytics():
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT DATE_FORMAT(created_at,'%b') as month, COUNT(*) as count
            FROM patients WHERE created_at >= DATE_SUB(NOW(),INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(created_at,'%Y-%m'),DATE_FORMAT(created_at,'%b')
            ORDER BY MIN(created_at)
        """)
        patient_trend = cursor.fetchall()

        cursor.execute("""
            SELECT DATE_FORMAT(created_at,'%b') as month, COUNT(*) as count
            FROM prescriptions WHERE created_at >= DATE_SUB(NOW(),INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(created_at,'%Y-%m'),DATE_FORMAT(created_at,'%b')
            ORDER BY MIN(created_at)
        """)
        prescription_trend = cursor.fetchall()

        cursor.execute("""
            SELECT category, COUNT(*) as count FROM medicines
            WHERE category IS NOT NULL AND category!='' AND category!='General'
            GROUP BY category ORDER BY count DESC LIMIT 8
        """)
        categories = cursor.fetchall()

        # FEATURE 4 — severity from interactions table
        cursor.execute(
            "SELECT severity, COUNT(*) as count FROM drug_interactions GROUP BY severity"
        )
        severity_breakdown = cursor.fetchall()

        # FEATURE 5 — prescription safety breakdown (SAFE / WARNING / DANGER)
        cursor.execute("""
            SELECT COALESCE(safety_status,'SAFE') as status, COUNT(*) as count
            FROM prescriptions GROUP BY safety_status
        """)
        prescription_safety = cursor.fetchall()

        # FEATURE 6 — top 5 prescribed medicines
        cursor.execute("""
            SELECT medicine_name as name, COUNT(*) as count
            FROM prescriptions GROUP BY medicine_name ORDER BY count DESC LIMIT 5
        """)
        top_medicines = cursor.fetchall()

        return jsonify({
            "patient_trend":       patient_trend,
            "prescription_trend":  prescription_trend,
            "categories":          categories,
            "severity_breakdown":  severity_breakdown,
            "prescription_safety": prescription_safety,
            "top_medicines":       top_medicines,
        })
    finally:
        db.close()


# ════════════════════════════════════════
# PATIENTS
# ════════════════════════════════════════

@app.route("/api/patients", methods=["GET"])
def get_patients():
    search = request.args.get("search", "")
    filter_recent = request.args.get("recent", "false").lower() == "true"
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)

        query = "SELECT * FROM patients WHERE 1=1"
        params = []

        if search:
            query += " AND (name LIKE %s OR phone LIKE %s OR village LIKE %s)"
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])

        if filter_recent:
            query += " AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"

        query += " ORDER BY created_at DESC LIMIT 100"

        cursor.execute(query, params)
        return jsonify({"patients": cursor.fetchall()})
    finally:
        db.close()


@app.route("/api/patients/export", methods=["GET"])
def export_patients():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT id,name,age,gender,blood_group,phone,village,
                   current_medications,known_allergies,created_at
            FROM patients ORDER BY id
        """)
        patients = cursor.fetchall()
        lines = ["ID,Name,Age,Gender,Blood Group,Phone,Village,"
                 "Current Medications,Known Allergies,Registered"]
        for p in patients:
            lines.append(
                f"{p['id']},\"{p['name']}\",{p['age'] or ''},"
                f"\"{p['gender'] or ''}\",\"{p['blood_group'] or ''}\","
                f"\"{p['phone'] or ''}\",\"{p['village'] or ''}\","
                f"\"{(p['current_medications'] or '').replace(chr(34), chr(39))}\","
                f"\"{(p['known_allergies'] or '').replace(chr(34), chr(39))}\","
                f"\"{str(p['created_at'])[:10]}\""
            )
        response = make_response("\n".join(lines))
        response.headers["Content-Disposition"] = "attachment; filename=patients_export.csv"
        response.headers["Content-Type"] = "text/csv"
        return response
    finally:
        db.close()


# FEATURE 7 — Patient stats (gender / blood / age breakdown)
@app.route("/api/patients/stats", methods=["GET"])
def patient_stats():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT gender, COUNT(*) as count FROM patients "
            "WHERE gender IS NOT NULL GROUP BY gender"
        )
        by_gender = cursor.fetchall()

        cursor.execute(
            "SELECT blood_group, COUNT(*) as count FROM patients "
            "WHERE blood_group IS NOT NULL GROUP BY blood_group ORDER BY count DESC"
        )
        by_blood = cursor.fetchall()

        cursor.execute("""
            SELECT
                CASE WHEN age<18 THEN 'Child (0-17)'
                     WHEN age<40 THEN 'Adult (18-39)'
                     WHEN age<60 THEN 'Middle Age (40-59)'
                     ELSE 'Senior (60+)' END as group_name,
                COUNT(*) as count
            FROM patients WHERE age IS NOT NULL GROUP BY group_name
        """)
        by_age = cursor.fetchall()

        cursor.execute("""
            SELECT DATE_FORMAT(created_at,'%b %Y') as month, COUNT(*) as count
            FROM patients WHERE created_at >= DATE_SUB(NOW(),INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(created_at,'%Y-%m'), DATE_FORMAT(created_at,'%b %Y')
            ORDER BY MIN(created_at)
        """)
        monthly = cursor.fetchall()

        return jsonify({
            "by_gender": by_gender, "by_blood": by_blood,
            "by_age": by_age, "monthly": monthly
        })
    finally:
        db.close()


@app.route("/api/patients/<int:pid>", methods=["GET"])
def get_patient(pid):
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT * FROM patients WHERE id=%s", (pid,))
        p = cursor.fetchone()
        if not p:
            return jsonify({"error": "Patient not found"}), 404
        # FEATURE 8 — return real safety_status from DB column
        cursor.execute(
            "SELECT pr.* FROM prescriptions pr "
            "WHERE pr.patient_id=%s ORDER BY pr.created_at DESC",
            (pid,)
        )
        prescriptions = cursor.fetchall()
        # Ensure safety_status has a value
        for rx in prescriptions:
            if not rx.get("safety_status"):
                rx["safety_status"] = "SAFE"

        cursor.execute(
            "SELECT * FROM appointments WHERE patient_name=%s "
            "ORDER BY created_at DESC LIMIT 10",
            (p["name"],)
        )
        appointments = cursor.fetchall()
        return jsonify({
            "patient": p, "prescriptions": prescriptions,
            "appointments": appointments
        })
    finally:
        db.close()


@app.route("/api/patients", methods=["POST"])
def add_patient():
    data = request.json
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO patients
            (name,age,gender,blood_group,phone,village,current_medications,known_allergies)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            data.get("name"), data.get("age"), data.get("gender"),
            data.get("blood_group"), data.get("phone"), data.get("village"),
            data.get("current_medications", ""), data.get("known_allergies", "")
        ))
        db.commit()
        uid = get_token_user(request)
        audit(db, uid, "ADD_PATIENT", "patients", cursor.lastrowid,
              f"Patient: {data.get('name')}")
        return jsonify({"message": "Patient added", "id": cursor.lastrowid}), 201
    finally:
        db.close()


@app.route("/api/patients/<int:pid>", methods=["PUT"])
def update_patient(pid):
    data = request.json
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("""
            UPDATE patients SET
                name=%s, age=%s, gender=%s, blood_group=%s,
                phone=%s, village=%s, current_medications=%s, known_allergies=%s
            WHERE id=%s
        """, (
            data.get("name"), data.get("age"), data.get("gender"),
            data.get("blood_group"), data.get("phone"), data.get("village"),
            data.get("current_medications", ""), data.get("known_allergies", ""), pid
        ))
        db.commit()
        uid = get_token_user(request)
        audit(db, uid, "UPDATE_PATIENT", "patients", pid, data.get("name"))
        return jsonify({"message": "Patient updated successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/patients/<int:pid>", methods=["DELETE"])
def delete_patient(pid):
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("DELETE FROM patients WHERE id=%s", (pid,))
        db.commit()
        uid = get_token_user(request)
        audit(db, uid, "DELETE_PATIENT", "patients", pid)
        return jsonify({"message": "Patient deleted"})
    finally:
        db.close()


# FEATURE 9 — Patient full medical report HTML
@app.route("/api/patients/<int:pid>/report", methods=["GET"])
def patient_report(pid):
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT * FROM patients WHERE id=%s", (pid,))
        p = cursor.fetchone()
        if not p:
            return jsonify({"error": "Patient not found"}), 404

        cursor.execute(
            "SELECT pr.* FROM prescriptions pr "
            "WHERE pr.patient_id=%s ORDER BY pr.created_at DESC", (pid,)
        )
        prescriptions = cursor.fetchall()

        cursor.execute(
            "SELECT * FROM appointments WHERE patient_name=%s "
            "ORDER BY created_at DESC", (p["name"],)
        )
        appointments = cursor.fetchall()

        # Build interaction warnings
        warnings = []
        drugs = [rx["medicine_name"] for rx in prescriptions]
        for i in range(len(drugs)):
            for j in range(i + 1, len(drugs)):
                cursor.execute(
                    "SELECT * FROM drug_interactions WHERE "
                    "(LOWER(drug_a)=%s AND LOWER(drug_b)=%s) OR "
                    "(LOWER(drug_a)=%s AND LOWER(drug_b)=%s)",
                    (drugs[i].lower(), drugs[j].lower(),
                     drugs[j].lower(), drugs[i].lower())
                )
                res = cursor.fetchone()
                if res:
                    warnings.append({
                        "drug_a": drugs[i], "drug_b": drugs[j],
                        "effect": res["effect"], "severity": res["severity"]
                    })

        rx_rows = "".join([
            f"<tr>"
            f"<td>#{rx['id']}</td>"
            f"<td><strong>{rx['medicine_name']}</strong></td>"
            f"<td>{rx.get('dosage') or '—'}</td>"
            f"<td>{rx.get('duration') or '—'}</td>"
            f"<td>{rx.get('doctor_name') or '—'}</td>"
            f"<td style='color:{'#16a34a' if (rx.get('safety_status') or 'SAFE')=='SAFE' else '#dc2626'}'>"
            f"{rx.get('safety_status') or 'SAFE'}</td>"
            f"<td>{str(rx['created_at'])[:10]}</td>"
            f"</tr>"
            for rx in prescriptions
        ]) if prescriptions else "<tr><td colspan='7' style='color:#999;text-align:center;'>No prescriptions on record</td></tr>"

        apt_rows = "".join([
            f"<tr><td>{a['specialty']}</td><td>{a['preferred_date']}</td>"
            f"<td>{a['time_slot'] or '—'}</td><td>{a['mode']}</td>"
            f"<td style='color:{'#16a34a' if a['status']=='confirmed' else '#d97706'}'>"
            f"{a['status']}</td></tr>"
            for a in appointments
        ]) if appointments else "<tr><td colspan='5' style='color:#999;text-align:center;'>No appointments</td></tr>"

        warn_rows = "".join([
            f"<tr style='background:#fef2f2'><td><strong>{w['drug_a']}</strong></td>"
            f"<td><strong>{w['drug_b']}</strong></td><td>{w['effect']}</td>"
            f"<td style='color:#dc2626;font-weight:bold;'>{(w['severity'] or '').upper()}</td></tr>"
            for w in warnings
        ]) if warnings else "<tr><td colspan='4' style='color:#16a34a;text-align:center;font-weight:bold;'>✓ No dangerous interactions detected</td></tr>"

        now = str(datetime.datetime.now())[:19]
        html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{{font-family:Arial,sans-serif;padding:30px;color:#222;max-width:900px;margin:0 auto;font-size:13px;}}
h1{{color:#1d4ed8;font-size:22px;margin:0;}}h2{{color:#1e40af;font-size:15px;border-bottom:1px solid #bfdbfe;padding-bottom:6px;margin:20px 0 10px;}}
.header{{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1d4ed8;padding-bottom:15px;margin-bottom:20px;}}
.logo{{font-size:28px;color:#1d4ed8;}}.meta{{font-size:11px;color:#666;text-align:right;}}
.info-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;}}
.info-box{{background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px;}}
.info-label{{font-size:10px;color:#0369a1;font-weight:bold;text-transform:uppercase;}}.info-val{{font-size:14px;font-weight:bold;color:#1e3a5f;margin-top:3px;}}
.med-box{{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:10px;margin-bottom:20px;}}
.allergy-box{{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px;margin-bottom:20px;}}
table{{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;}}
th{{background:#1d4ed8;color:white;padding:8px;text-align:left;font-size:11px;}}td{{padding:7px 8px;border-bottom:1px solid #e5e7eb;}}
.warn-section{{background:#fff7f7;border:1px solid #fca5a5;border-radius:6px;padding:12px;margin-bottom:20px;}}
.footer{{margin-top:30px;border-top:1px solid #e5e7eb;padding-top:12px;text-align:center;color:#999;font-size:11px;}}
@media print{{body{{padding:20px;}}button{{display:none;}}}}
</style></head><body>
<div class="header">
  <div><div class="logo">℞</div><h1>MediGuard AI — Patient Medical Report</h1><p style="color:#555;margin:4px 0 0;">Comprehensive Health Record</p></div>
  <div class="meta">Report ID: RPT-{pid}-{str(p['created_at'])[:10].replace('-','')}<br>Generated: {now}<br>Patient ID: #{p['id']}</div>
</div>
<div class="info-grid">
  <div class="info-box"><div class="info-label">Full Name</div><div class="info-val">{p['name']}</div></div>
  <div class="info-box"><div class="info-label">Age / Gender</div><div class="info-val">{p['age']} yrs / {p['gender'] or '—'}</div></div>
  <div class="info-box"><div class="info-label">Blood Group</div><div class="info-val">{p['blood_group'] or '—'}</div></div>
  <div class="info-box"><div class="info-label">Phone</div><div class="info-val">{p['phone'] or '—'}</div></div>
  <div class="info-box"><div class="info-label">Village / City</div><div class="info-val">{p['village'] or '—'}</div></div>
  <div class="info-box"><div class="info-label">Registered On</div><div class="info-val">{str(p['created_at'])[:10]}</div></div>
</div>
<div class="med-box"><div class="info-label" style="color:#92400e;">Current Medications</div><div style="margin-top:5px;">{p['current_medications'] or 'None recorded'}</div></div>
<div class="allergy-box"><div class="info-label" style="color:#991b1b;">Known Allergies</div><div style="margin-top:5px;">{p['known_allergies'] or 'None recorded'}</div></div>
<h2>Prescription History ({len(prescriptions)} records)</h2>
<table><thead><tr><th>#ID</th><th>Medicine</th><th>Dosage</th><th>Duration</th><th>Doctor</th><th>Safety</th><th>Date</th></tr></thead><tbody>{rx_rows}</tbody></table>
<h2>Drug Interaction Safety Analysis</h2>
<div class="warn-section"><table><thead><tr><th>Drug A</th><th>Drug B</th><th>Effect</th><th>Severity</th></tr></thead><tbody>{warn_rows}</tbody></table></div>
<h2>Appointment History ({len(appointments)} records)</h2>
<table><thead><tr><th>Specialty</th><th>Date</th><th>Time Slot</th><th>Mode</th><th>Status</th></tr></thead><tbody>{apt_rows}</tbody></table>
<div style="text-align:center;margin:20px 0;">
  <button onclick="window.print()" style="background:#2563eb;color:white;border:none;padding:10px 30px;border-radius:6px;cursor:pointer;font-size:14px;">🖨 Print / Save as PDF</button>
</div>
<div class="footer"><p>Generated by MediGuard AI — Confidential Medical Record | For authorized medical personnel only</p></div>
</body></html>"""
        response = make_response(html)
        response.headers["Content-Type"] = "text/html"
        response.headers["Content-Disposition"] = f"inline; filename=patient_{pid}_report.html"
        return response
    finally:
        db.close()


# FEATURE 10 — Portal patient lookup (rich: prescriptions + appointments + alerts)
@app.route("/api/portal/patient/<query>", methods=["GET"])
def portal_patient(query):
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        if query.isdigit():
            cursor.execute("SELECT * FROM patients WHERE id=%s", (query,))
        else:
            cursor.execute(
                "SELECT * FROM patients WHERE name LIKE %s "
                "ORDER BY created_at DESC LIMIT 1",
                (f"%{query}%",)
            )
        patient = cursor.fetchone()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404

        cursor.execute(
            "SELECT * FROM prescriptions WHERE patient_id=%s ORDER BY created_at DESC",
            (patient["id"],)
        )
        prescriptions = cursor.fetchall()
        for rx in prescriptions:
            if not rx.get("safety_status"):
                rx["safety_status"] = "SAFE"

        cursor.execute(
            "SELECT * FROM appointments WHERE patient_name=%s "
            "ORDER BY created_at DESC LIMIT 5",
            (patient["name"],)
        )
        appointments = cursor.fetchall()

        cursor.execute(
            "SELECT * FROM safety_alerts_log WHERE patient_id=%s "
            "ORDER BY created_at DESC LIMIT 5",
            (patient["id"],)
        )
        safety_alerts = cursor.fetchall()

        return jsonify({
            "patient": patient,
            "prescriptions": prescriptions,
            "appointments": appointments,
            "safety_alerts": safety_alerts,
        })
    finally:
        db.close()


# ════════════════════════════════════════
# PRESCRIPTIONS
# ════════════════════════════════════════

@app.route("/api/prescriptions", methods=["GET"])
def get_prescriptions():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT pr.*, p.name as patient_name FROM prescriptions pr
            LEFT JOIN patients p ON pr.patient_id=p.id
            ORDER BY pr.created_at DESC LIMIT 200
        """)
        rxs = cursor.fetchall()
        # FEATURE 8 — real safety_status from DB, not hardcoded "SAFE"
        for rx in rxs:
            if not rx.get("safety_status"):
                rx["safety_status"] = "SAFE"
        return jsonify({"prescriptions": rxs})
    finally:
        db.close()


@app.route("/api/prescriptions/search", methods=["GET"])
def search_prescriptions():
    q = request.args.get("q", "").strip()
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        if q:
            cursor.execute("""
                SELECT pr.*, p.name as patient_name
                FROM prescriptions pr LEFT JOIN patients p ON pr.patient_id=p.id
                WHERE pr.medicine_name LIKE %s OR p.name LIKE %s OR pr.doctor_name LIKE %s
                ORDER BY pr.created_at DESC LIMIT 100
            """, (f"%{q}%", f"%{q}%", f"%{q}%"))
        else:
            cursor.execute("""
                SELECT pr.*, p.name as patient_name
                FROM prescriptions pr LEFT JOIN patients p ON pr.patient_id=p.id
                ORDER BY pr.created_at DESC LIMIT 100
            """)
        rxs = cursor.fetchall()
        for rx in rxs:
            if not rx.get("safety_status"):
                rx["safety_status"] = "SAFE"
        return jsonify({"prescriptions": rxs})
    finally:
        db.close()


@app.route("/api/prescriptions/export", methods=["GET"])
def export_prescriptions_csv():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT pr.id, p.name as patient_name, pr.medicine_name, pr.dosage,
                   pr.duration, pr.doctor_name, pr.notes,
                   COALESCE(pr.safety_status,'SAFE') as safety_status, pr.created_at
            FROM prescriptions pr
            LEFT JOIN patients p ON pr.patient_id = p.id
            ORDER BY pr.created_at DESC
        """)
        rows = cursor.fetchall()
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID","Patient Name","Medicine","Dosage","Duration",
                         "Doctor","Notes","Safety Status","Date"])
        for row in rows:
            writer.writerow([
                row["id"], row["patient_name"] or "", row["medicine_name"],
                row["dosage"] or "", row["duration"] or "", row["doctor_name"] or "",
                row["notes"] or "", row["safety_status"],
                str(row["created_at"])[:10] if row["created_at"] else ""
            ])
        response = make_response(output.getvalue())
        response.headers["Content-Disposition"] = "attachment; filename=prescriptions_export.csv"
        response.headers["Content-Type"] = "text/csv"
        return response
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# FEATURE 11 — Prescription PDF with safety_status & safety_message shown
@app.route("/api/prescriptions/<int:pid>/pdf", methods=["GET"])
def prescription_pdf(pid):
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib import colors
        from io import BytesIO

        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT pr.*, p.name as patient_name, p.age, p.gender, p.blood_group, p.phone
            FROM prescriptions pr
            LEFT JOIN patients p ON pr.patient_id = p.id
            WHERE pr.id=%s
        """, (pid,))
        rx = cursor.fetchone()
        if not rx:
            return jsonify({"error": "Prescription not found"}), 404

        # Create PDF buffer
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter)
        styles = getSampleStyleSheet()
        story = []

        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            spaceAfter=30,
            alignment=1  # Center
        )
        story.append(Paragraph("MediGuard AI — Digital Prescription", title_style))
        story.append(Spacer(1, 12))

        # Prescription ID and Date
        info_style = styles['Normal']
        story.append(Paragraph(f"<b>Prescription ID:</b> #{rx['id']} | <b>Date:</b> {str(rx['created_at'])[:10] if rx['created_at'] else 'N/A'}", info_style))
        story.append(Spacer(1, 20))

        # Patient Information
        story.append(Paragraph("<b>Patient Information:</b>", styles['Heading2']))
        patient_data = [
            ["Name", rx['patient_name'] or '—'],
            ["Age / Gender", f"{rx['age'] or '—'} / {rx['gender'] or '—'}"],
            ["Blood Group", rx['blood_group'] or '—'],
            ["Phone", rx['phone'] or '—']
        ]
        patient_table = Table(patient_data, colWidths=[150, 300])
        patient_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.lightgrey),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('BACKGROUND', (1, 0), (1, -1), colors.white),
        ]))
        story.append(patient_table)
        story.append(Spacer(1, 20))

        # Medicine Information
        story.append(Paragraph("<b>Prescribed Medicine:</b>", styles['Heading2']))
        story.append(Paragraph(f"<font size=18><b>{rx['medicine_name']}</b></font>", styles['Normal']))
        story.append(Spacer(1, 12))

        medicine_data = [
            ["Dosage", rx.get('dosage') or '—'],
            ["Duration", rx.get('duration') or '—'],
            ["Prescribed By", rx.get('doctor_name') or '—'],
            ["Safety Status", rx.get('safety_status') or 'SAFE'],
            ["Reminder Time", rx.get('reminder_time') or 'Not set']
        ]
        medicine_table = Table(medicine_data, colWidths=[150, 300])
        medicine_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.lightblue),
            ('TEXTCOLOR', (0, 0), (0, -1), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('BACKGROUND', (1, 0), (1, -1), colors.white),
        ]))
        story.append(medicine_table)
        story.append(Spacer(1, 20))

        # Notes
        if rx.get('notes'):
            story.append(Paragraph("<b>Notes:</b>", styles['Heading3']))
            story.append(Paragraph(rx['notes'], styles['Normal']))
            story.append(Spacer(1, 12))

        # Safety Message
        safety_message = rx.get('safety_message')
        if safety_message:
            story.append(Paragraph("<b>Safety Alert:</b>", styles['Heading3']))
            story.append(Paragraph(f"<font color=red>{safety_message}</font>", styles['Normal']))
            story.append(Spacer(1, 12))

        # Footer
        story.append(Spacer(1, 30))
        footer_style = ParagraphStyle(
            'Footer',
            parent=styles['Normal'],
            fontSize=10,
            alignment=1
        )
        story.append(Paragraph("Generated by MediGuard AI | Digitally Verified Prescription", footer_style))
        story.append(Paragraph("Always consult your doctor before making any changes to your medication", footer_style))

        # Build PDF
        doc.build(story)
        buffer.seek(0)

        response = make_response(buffer.getvalue())
        response.headers["Content-Type"] = "application/pdf"
        response.headers["Content-Disposition"] = f"attachment; filename=prescription_{pid}.pdf"
        return response

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# FEATURE 12 — Add prescription with force_save + real safety_status column stored
@app.route("/api/prescriptions", methods=["POST"])
def add_prescription():
    data       = request.json
    drug       = data.get("medicine_name", "").lower().strip()
    patient_id = data.get("patient_id")
    force_save = data.get("force_save", False)

    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)

        # 1. Check setting — block critical if admin enabled
        cursor.execute(
            "SELECT value FROM system_settings WHERE `key`='block_critical_prescriptions'"
        )
        row = cursor.fetchone()
        block_critical = row["value"] == "1" if row else False

        # 2. Interaction check against existing prescriptions
        cursor.execute(
            "SELECT medicine_name FROM prescriptions WHERE patient_id=%s",
            (patient_id,)
        )
        existing   = [r["medicine_name"].lower() for r in cursor.fetchall()]
        warnings   = []
        safety_status = "SAFE"
        safety_msg    = "No interactions detected."
        found_interaction = None

        for ed in existing:
            cursor.execute("""
                SELECT * FROM drug_interactions
                WHERE (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
                   OR (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
            """, (drug, ed, ed, drug))
            interaction = cursor.fetchone()
            if interaction:
                warnings.append(interaction)
                severity_map = {"critical":"DANGER","high":"WARNING","moderate":"WARNING"}
                sev = (interaction["severity"] or "moderate").lower()
                if sev == "critical":
                    safety_status = "DANGER"
                elif safety_status != "DANGER":
                    safety_status = "WARNING"
                safety_msg = f"Interaction with {ed}: {interaction['effect']}"
                if found_interaction is None:
                    found_interaction = interaction

        # Block CRITICAL if setting enabled and not force_save
        if block_critical and safety_status == "DANGER" and not force_save:
            return jsonify({
                "error": "CRITICAL interaction blocked by admin settings.",
                "safety_status": safety_status,
                "safety_message": safety_msg,
                "warnings": warnings,
                "blocked": True,
                "saved": False,
            }), 400

        # For WARNING: if not force_save, return warning without saving
        if safety_status == "WARNING" and not force_save:
            return jsonify({
                "saved": False,
                "safety_status": safety_status,
                "safety_message": safety_msg,
                "warnings": warnings,
                "message": "Interaction warning — confirm with force_save=true to proceed"
            }), 200

        # 3. Save prescription with real safety_status in DB
        cursor2 = db.cursor()
        cursor2.execute("""
            INSERT INTO prescriptions
            (patient_id, medicine_name, dosage, duration, doctor_name, notes,
             safety_status, safety_message, reminder_time)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            patient_id, data.get("medicine_name"), data.get("dosage"),
            data.get("duration"), data.get("doctor_name"), data.get("notes"),
            safety_status, safety_msg, data.get("reminder_time")
        ))
        db.commit()
        new_id = cursor2.lastrowid

        # 4. Log safety alert if interaction found
        if found_interaction:
            cursor2.execute("""
                INSERT INTO safety_alerts_log
                (patient_id, prescription_id, drug_a, drug_b, effect, severity)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (
                patient_id, new_id,
                found_interaction["drug_a"], found_interaction["drug_b"],
                found_interaction["effect"], found_interaction["severity"]
            ))
            db.commit()

        # 5. Audit
        uid = get_token_user(request)
        audit(db, uid, "ADD_PRESCRIPTION", "prescriptions", new_id,
              f"{data.get('medicine_name')} for patient #{patient_id}")

        # 6. Auto-deduct from inventory
        deducted    = False
        stock_warning = None
        cursor3 = db.cursor(dictionary=True)
        cursor3.execute(
            "SELECT * FROM medicines WHERE LOWER(name) LIKE %s LIMIT 1",
            (f"%{drug}%",)
        )
        med = cursor3.fetchone()
        if med:
            cursor3.execute(
                "UPDATE medicines SET quantity=GREATEST(0, quantity-1) WHERE id=%s",
                (med["id"],)
            )
            db.commit()
            deducted = True
            new_qty  = med["quantity"] - 1
            if new_qty <= med["min_stock_level"]:
                stock_warning = (
                    f"⚠️ Low stock alert: {med['name']} "
                    f"has only {max(0,new_qty)} units left."
                )

        return jsonify({
            "saved": True,
            "message": "Prescription saved",
            "id": new_id,
            "safety_status": safety_status,
            "safety_message": safety_msg,
            "warnings": warnings,
            "inventory_deducted": deducted,
            "stock_warning": stock_warning,
        }), 201

    finally:
        db.close()


@app.route("/api/prescriptions/<int:rid>", methods=["DELETE"])
def delete_prescription(rid):
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("DELETE FROM prescriptions WHERE id=%s", (rid,))
        db.commit()
        uid = get_token_user(request)
        audit(db, uid, "DELETE_PRESCRIPTION", "prescriptions", rid)
        return jsonify({"message": "Prescription deleted successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


# FEATURE 13 — Prescription stats with safety_summary
@app.route("/api/prescriptions/stats", methods=["GET"])
def prescription_stats():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT medicine_name, COUNT(*) as count FROM prescriptions "
            "GROUP BY medicine_name ORDER BY count DESC LIMIT 10"
        )
        top_medicines = cursor.fetchall()

        cursor.execute(
            "SELECT doctor_name, COUNT(*) as count FROM prescriptions "
            "WHERE doctor_name IS NOT NULL AND doctor_name!='' "
            "GROUP BY doctor_name ORDER BY count DESC LIMIT 5"
        )
        top_doctors = cursor.fetchall()

        cursor.execute("""
            SELECT DATE_FORMAT(created_at,'%Y-%m-%d') as date, COUNT(*) as count
            FROM prescriptions
            WHERE created_at >= DATE_SUB(NOW(),INTERVAL 30 DAY)
            GROUP BY DATE(created_at) ORDER BY date
        """)
        daily_trend = cursor.fetchall()

        cursor.execute(
            "SELECT COALESCE(safety_status,'SAFE') as status, COUNT(*) as count "
            "FROM prescriptions GROUP BY safety_status"
        )
        safety_summary = cursor.fetchall()

        return jsonify({
            "top_medicines": top_medicines,
            "top_doctors":   top_doctors,
            "daily_trend":   daily_trend,
            "safety_summary": safety_summary,
        })
    finally:
        db.close()


# ════════════════════════════════════════
# MEDICAL REPORTS
# ════════════════════════════════════════

@app.route("/api/medical-reports", methods=["POST"])
def upload_medical_report():
    """Upload a medical report file for a patient."""
    import os
    from werkzeug.utils import secure_filename

    patient_id = request.form.get("patient_id")
    if not patient_id:
        return jsonify({"error": "Patient ID required"}), 400

    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # Validate file type
    allowed_extensions = {'pdf', 'jpg', 'jpeg', 'png'}
    if '.' not in file.filename or file.filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
        return jsonify({"error": "Invalid file type. Only PDF, JPG, PNG allowed"}), 400

    # Create uploads directory if it doesn't exist
    upload_dir = os.path.join(os.path.dirname(__file__), 'uploads', 'medical_reports')
    os.makedirs(upload_dir, exist_ok=True)

    # Secure filename and save
    filename = secure_filename(file.filename)
    file_path = os.path.join(upload_dir, f"{patient_id}_{int(datetime.datetime.now().timestamp())}_{filename}")
    file.save(file_path)

    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO medical_reports (patient_id, file_name, file_path, file_type)
            VALUES (%s, %s, %s, %s)
        """, (patient_id, filename, file_path, file.filename.rsplit('.', 1)[1].lower()))
        db.commit()
        report_id = cursor.lastrowid

        uid = get_token_user(request)
        audit(db, uid, "UPLOAD_MEDICAL_REPORT", "medical_reports", report_id,
              f"File: {filename} for patient #{patient_id}")

        return jsonify({
            "message": "Medical report uploaded successfully",
            "id": report_id,
            "file_name": filename
        }), 201

    except Exception as e:
        # Clean up file if DB insert fails
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/medical-reports", methods=["GET"])
def get_all_medical_reports():
    """Get all medical reports."""
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT mr.*, p.name as patient_name
            FROM medical_reports mr
            LEFT JOIN patients p ON mr.patient_id = p.id
            ORDER BY mr.uploaded_at DESC
        """)
        reports = cursor.fetchall()
        return jsonify({"reports": reports})
    finally:
        db.close()


@app.route("/api/medical-reports/<int:patient_id>", methods=["GET"])
def get_medical_reports(patient_id):
    """Get all medical reports for a patient."""
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT id, file_name, file_type, uploaded_at
            FROM medical_reports
            WHERE patient_id = %s
            ORDER BY uploaded_at DESC
        """, (patient_id,))
        reports = cursor.fetchall()
        return jsonify({"reports": reports})
    finally:
        db.close()


@app.route("/api/medical-reports/download/<int:report_id>", methods=["GET"])
def download_medical_report(report_id):
    """Download a medical report file."""
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT * FROM medical_reports WHERE id = %s", (report_id,))
        report = cursor.fetchone()
        if not report:
            return jsonify({"error": "Report not found"}), 404

        if not os.path.exists(report['file_path']):
            return jsonify({"error": "File not found on server"}), 404

        return send_file(report['file_path'], as_attachment=True, download_name=report['file_name'])

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ════════════════════════════════════════
# INVENTORY
# ════════════════════════════════════════

def ensure_owner_id_column(db):
    """
    Adds owner_id column to medicines if it doesn't exist yet.
    Safe to call on every startup — uses IF NOT EXISTS pattern.
    """
    try:
        c = db.cursor()
        c.execute("SHOW COLUMNS FROM medicines LIKE 'owner_id'")
        if not c.fetchone():
            c.execute(
                "ALTER TABLE medicines ADD COLUMN owner_id INT DEFAULT NULL, "
                "ADD INDEX idx_med_owner (owner_id)"
            )
            db.commit()
    except Exception:
        pass


@app.route("/api/inventory", methods=["GET"])
def get_inventory():
    """Return only the medicines belonging to the logged-in pharmacist/user."""
    uid = get_token_user(request)
    try:
        db = get_db()
        ensure_owner_id_column(db)
        cursor = db.cursor(dictionary=True)
        if uid:
            cursor.execute(
                "SELECT * FROM medicines WHERE owner_id=%s ORDER BY name LIMIT 500",
                (uid,)
            )
        else:
            # Unauthenticated: return nothing (inventory is private)
            return jsonify({"inventory": []})
        return jsonify({"inventory": cursor.fetchall()})
    finally:
        db.close()


@app.route("/api/inventory/alerts", methods=["GET"])
def get_inventory_alerts():
    """
    Returns stock alert summary for the logged-in pharmacist:
    out-of-stock and low-stock items from their own medicine list.
    """
    uid = get_token_user(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        db = get_db()
        ensure_owner_id_column(db)
        cursor = db.cursor(dictionary=True)

        # Out of stock
        cursor.execute(
            "SELECT id, name, quantity, min_stock_level, category, dosage_form "
            "FROM medicines WHERE owner_id=%s AND quantity=0 ORDER BY name",
            (uid,)
        )
        out_of_stock = cursor.fetchall()

        # Low stock (> 0 but <= threshold)
        cursor.execute(
            "SELECT id, name, quantity, min_stock_level, category, dosage_form "
            "FROM medicines WHERE owner_id=%s AND quantity > 0 "
            "AND quantity <= min_stock_level ORDER BY quantity ASC",
            (uid,)
        )
        low_stock = cursor.fetchall()

        # Total medicines and in-stock count
        cursor.execute(
            "SELECT COUNT(*) as total FROM medicines WHERE owner_id=%s", (uid,)
        )
        total = cursor.fetchone()["total"]

        cursor.execute(
            "SELECT COUNT(*) as cnt FROM medicines "
            "WHERE owner_id=%s AND quantity > min_stock_level",
            (uid,)
        )
        in_stock = cursor.fetchone()["cnt"]

        return jsonify({
            "out_of_stock":     out_of_stock,
            "low_stock":        low_stock,
            "total":            total,
            "in_stock":         in_stock,
            "out_of_stock_count": len(out_of_stock),
            "low_stock_count":    len(low_stock),
        })
    finally:
        db.close()


@app.route("/api/inventory", methods=["POST"])
def add_inventory():
    data = request.json
    uid  = get_token_user(request)
    try:
        db = get_db()
        ensure_owner_id_column(db)
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO medicines
            (name,category,dosage_form,strength,side_effects,description,
             manufacturer,quantity,min_stock_level,owner_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            data.get("name") or data.get("medicine_name"),
            data.get("category"),
            data.get("dosage_form", "Tablet"),
            data.get("strength", ""),
            data.get("side_effects", ""),
            data.get("description", ""),
            data.get("manufacturer", ""),
            data.get("quantity", 0),
            data.get("min_stock_level", 10),
            uid
        ))
        db.commit()
        audit(db, uid, "ADD_INVENTORY", "medicines", cursor.lastrowid,
              data.get("name") or data.get("medicine_name"))
        return jsonify({"message": "Medicine added", "id": cursor.lastrowid}), 201
    finally:
        db.close()


@app.route("/api/inventory/<int:mid>", methods=["PUT"])
def update_inventory(mid):
    data = request.json
    uid  = get_token_user(request)
    try:
        db = get_db()
        cursor = db.cursor()
        # Only update if the medicine belongs to the requesting user
        cursor.execute("""
            UPDATE medicines SET
                name=%s, category=%s, dosage_form=%s,
                manufacturer=%s, quantity=%s, min_stock_level=%s
            WHERE id=%s AND (owner_id=%s OR owner_id IS NULL)
        """, (
            data.get("name"), data.get("category"),
            data.get("dosage_form", "Tablet"),
            data.get("manufacturer", ""),
            data.get("quantity", 0),
            data.get("min_stock_level", 10), mid, uid
        ))
        db.commit()
        audit(db, uid, "UPDATE_INVENTORY", "medicines", mid, data.get("name"))
        return jsonify({"message": "Medicine updated successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/inventory/<int:mid>", methods=["DELETE"])
def delete_inventory_item(mid):
    uid = get_token_user(request)
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            "DELETE FROM medicines WHERE id=%s AND (owner_id=%s OR owner_id IS NULL)",
            (mid, uid)
        )
        db.commit()
        audit(db, uid, "DELETE_INVENTORY", "medicines", mid)
        return jsonify({"message": "Medicine deleted successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/inventory/<int:mid>/restock", methods=["PATCH"])
def restock(mid):
    qty = request.json.get("add_quantity", 0)
    uid = get_token_user(request)
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            "UPDATE medicines SET quantity=quantity+%s "
            "WHERE id=%s AND (owner_id=%s OR owner_id IS NULL)",
            (qty, mid, uid)
        )
        db.commit()
        audit(db, uid, "RESTOCK", "medicines", mid, f"+{qty} units")
        return jsonify({"message": "Restocked"})
    finally:
        db.close()


@app.route("/api/inventory/<int:mid>/adjust", methods=["PATCH"])
def adjust_stock(mid):
    """Adjust quantity by a delta (positive or negative). Will not go below 0."""
    delta = request.json.get("delta", 0)
    uid   = get_token_user(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        # Fetch current quantity first
        cursor.execute(
            "SELECT quantity FROM medicines WHERE id=%s AND (owner_id=%s OR owner_id IS NULL)",
            (mid, uid)
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Medicine not found"}), 404
        new_qty = max(0, int(row["quantity"]) + int(delta))
        cursor.execute(
            "UPDATE medicines SET quantity=%s WHERE id=%s AND (owner_id=%s OR owner_id IS NULL)",
            (new_qty, mid, uid)
        )
        db.commit()
        audit(db, uid, "ADJUST_STOCK", "medicines", mid, f"delta={delta}, new_qty={new_qty}")
        return jsonify({"message": "Stock adjusted", "new_quantity": new_qty})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/inventory/seed-defaults", methods=["POST"])
def seed_default_stock():
    """
    Adds all medicines from the global medicine database to the pharmacist's
    inventory at 20 units each, but only for medicines not already present.
    """
    uid = get_token_user(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401
    try:
        db = get_db()
        ensure_owner_id_column(db)
        cursor = db.cursor(dictionary=True)

        # Get all medicines in the database (global pool)
        cursor.execute("SELECT * FROM medicines WHERE owner_id IS NULL OR owner_id = 0 ORDER BY name LIMIT 1000")
        all_medicines = cursor.fetchall()

        # If no "global" medicines found, try all medicines (fallback)
        if not all_medicines:
            cursor.execute("SELECT DISTINCT name, category, dosage_form, strength, manufacturer FROM medicines ORDER BY name LIMIT 500")
            all_medicines = cursor.fetchall()

        # Get medicines already owned by this pharmacist
        cursor.execute("SELECT name FROM medicines WHERE owner_id=%s", (uid,))
        owned_names = {row["name"].lower() for row in cursor.fetchall()}

        added = 0
        for med in all_medicines:
            med_name = (med.get("name") or "").strip()
            if not med_name or med_name.lower() in owned_names:
                continue
            cursor.execute("""
                INSERT INTO medicines
                    (name, category, dosage_form, strength, side_effects,
                     description, manufacturer, quantity, min_stock_level, owner_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                med_name,
                med.get("category", "Other"),
                med.get("dosage_form", "Tablet"),
                med.get("strength", ""),
                med.get("side_effects", ""),
                med.get("description", ""),
                med.get("manufacturer", ""),
                20,   # default 20 units
                10,   # default min stock level
                uid
            ))
            owned_names.add(med_name.lower())
            added += 1

        db.commit()
        audit(db, uid, "SEED_DEFAULTS", "medicines", None, f"{added} medicines seeded at 20 units")
        return jsonify({"message": f"{added} medicines added at 20 units each.", "added": added})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/medicines/search", methods=["GET"])
def search_medicines():
    q        = request.args.get("q", "").strip()
    category = request.args.get("category", "")
    page     = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 24))
    offset   = (page - 1) * per_page
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        where_clauses, params = [], []
        if q:
            where_clauses.append("(name LIKE %s OR description LIKE %s OR manufacturer LIKE %s)")
            params += [f"%{q}%", f"%{q}%", f"%{q}%"]
        if category:
            where_clauses.append("category=%s")
            params.append(category)
        where = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        cursor.execute(f"SELECT COUNT(*) as total FROM medicines {where}", params)
        total = cursor.fetchone()["total"]
        cursor.execute(
            f"SELECT * FROM medicines {where} ORDER BY name LIMIT %s OFFSET %s",
            params + [per_page, offset]
        )
        medicines = cursor.fetchall()
        return jsonify({
            "medicines": medicines, "total": total, "page": page,
            "per_page": per_page, "pages": (total + per_page - 1) // per_page
        })
    finally:
        db.close()


@app.route("/api/medicines/autocomplete", methods=["GET"])
def medicine_autocomplete():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify({"suggestions": []})
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT id,name,category,dosage_form,strength,manufacturer "
            "FROM medicines WHERE name LIKE %s ORDER BY name LIMIT 10",
            (f"{q}%",)
        )
        results = cursor.fetchall()
        if not results:
            cursor.execute(
                "SELECT id,name,category,dosage_form,strength,manufacturer "
                "FROM medicines WHERE name LIKE %s ORDER BY name LIMIT 10",
                (f"%{q}%",)
            )
            results = cursor.fetchall()
        return jsonify({"suggestions": results})
    finally:
        db.close()


@app.route("/api/medicines/categories", methods=["GET"])
def medicine_categories():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT category, COUNT(*) as count FROM medicines
            WHERE category IS NOT NULL AND category!='' AND category!='General'
            GROUP BY category ORDER BY count DESC LIMIT 30
        """)
        return jsonify({"categories": cursor.fetchall()})
    finally:
        db.close()


@app.route("/api/medicines/<int:mid>", methods=["GET"])
def get_medicine(mid):
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT * FROM medicines WHERE id=%s", (mid,))
        medicine = cursor.fetchone()
        if not medicine:
            return jsonify({"error": "Medicine not found"}), 404
        cursor.execute(
            "SELECT * FROM drug_interactions "
            "WHERE LOWER(drug_a) LIKE %s OR LOWER(drug_b) LIKE %s LIMIT 10",
            (f"%{medicine['name'].lower()[:20]}%",
             f"%{medicine['name'].lower()[:20]}%")
        )
        interactions = cursor.fetchall()
        return jsonify({"medicine": medicine, "interactions": interactions})
    finally:
        db.close()


# ════════════════════════════════════════
# DRUG INTERACTIONS
# ════════════════════════════════════════

@app.route("/api/drug-interactions", methods=["GET"])
def get_interactions():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT * FROM drug_interactions ORDER BY severity DESC LIMIT 200"
        )
        return jsonify({"interactions": cursor.fetchall()})
    finally:
        db.close()


@app.route("/api/drug-interactions", methods=["POST"])
def add_interaction():
    data = request.json
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            "INSERT INTO drug_interactions (drug_a,drug_b,effect,severity) "
            "VALUES (%s,%s,%s,%s)",
            (data.get("drug_a"), data.get("drug_b"),
             data.get("effect"), data.get("severity", "moderate"))
        )
        db.commit()
        uid = get_token_user(request)
        audit(db, uid, "ADD_INTERACTION", "drug_interactions", cursor.lastrowid,
              f"{data.get('drug_a')} + {data.get('drug_b')}")
        return jsonify({"message": "Interaction added", "id": cursor.lastrowid}), 201
    finally:
        db.close()


# FEATURE 14 — DELETE drug interaction
@app.route("/api/drug-interactions/<int:did>", methods=["DELETE"])
def delete_interaction(did):
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("DELETE FROM drug_interactions WHERE id=%s", (did,))
        db.commit()
        uid = get_token_user(request)
        audit(db, uid, "DELETE_INTERACTION", "drug_interactions", did)
        return jsonify({"message": "Interaction deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/drug-interactions/check", methods=["POST"])
def check_interaction():
    data = request.json
    dra  = data.get("drug_a", "").lower()
    drb  = data.get("drug_b", "").lower()
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT * FROM drug_interactions
            WHERE (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
               OR (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
        """, (dra, drb, drb, dra))
        result = cursor.fetchone()
        if result:
            return jsonify({
                "interaction_found": True, "effect": result["effect"],
                "severity": result["severity"], "details": result
            })
        return jsonify({"interaction_found": False, "message": "No known interaction found"})
    finally:
        db.close()


@app.route("/api/drug-interactions/bulk-check/<int:patient_id>", methods=["GET"])
def bulk_check(patient_id):
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT medicine_name FROM prescriptions WHERE patient_id=%s",
            (patient_id,)
        )
        drugs    = [row["medicine_name"] for row in cursor.fetchall()]
        warnings = []
        for i in range(len(drugs)):
            for j in range(i + 1, len(drugs)):
                a, b = drugs[i].lower(), drugs[j].lower()
                cursor.execute("""
                    SELECT * FROM drug_interactions
                    WHERE (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
                       OR (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
                """, (a, b, b, a))
                result = cursor.fetchone()
                if result:
                    warnings.append({
                        "drug_a": drugs[i], "drug_b": drugs[j],
                        "effect": result["effect"], "severity": result["severity"]
                    })
        return jsonify({
            "patient_id": patient_id, "drugs_checked": drugs,
            "warnings": warnings, "safe": len(warnings) == 0
        })
    finally:
        db.close()


@app.route("/api/drug-interactions/bulk-check-names", methods=["POST"])
def bulk_check_names():
    data  = request.json
    drugs = data.get("drugs", [])
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        warnings = []
        for i in range(len(drugs)):
            for j in range(i + 1, len(drugs)):
                a, b = drugs[i].lower(), drugs[j].lower()
                cursor.execute("""
                    SELECT * FROM drug_interactions
                    WHERE (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
                       OR (LOWER(drug_a)=%s AND LOWER(drug_b)=%s)
                """, (a, b, b, a))
                result = cursor.fetchone()
                if result:
                    warnings.append({
                        "drug_a": drugs[i], "drug_b": drugs[j],
                        "effect": result["effect"], "severity": result["severity"]
                    })
        return jsonify({
            "drugs_checked": drugs, "warnings": warnings,
            "safe": len(warnings) == 0,
            "total_pairs": len(drugs) * (len(drugs) - 1) // 2
        })
    finally:
        db.close()


# ════════════════════════════════════════
# ALERTS & NOTIFICATIONS
# ════════════════════════════════════════

@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    """
    Returns REAL drug-interaction safety alerts from safety_alerts_log,
    plus low-stock items as a secondary list.
    """
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT sal.*, p.name as patient_name
            FROM safety_alerts_log sal
            LEFT JOIN patients p ON sal.patient_id = p.id
            ORDER BY sal.created_at DESC LIMIT 100
        """)
        drug_alerts = cursor.fetchall()

        cursor.execute(
            "SELECT * FROM medicines WHERE quantity <= min_stock_level "
            "ORDER BY quantity ASC LIMIT 50"
        )
        low = cursor.fetchall()
        low_stock_alerts = [
            {"type": "low_stock",
             "message": f"{m['name']} low stock ({m['quantity']} left)",
             "medicine": m}
            for m in low
        ]

        return jsonify({
            "alerts": drug_alerts,
            "low_stock": low_stock_alerts,
            "total": len(drug_alerts)
        })
    finally:
        db.close()


# FEATURE 15 — Resolve a safety alert
@app.route("/api/alerts/<int:aid>/resolve", methods=["PATCH"])
def resolve_alert(aid):
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor()
        cursor.execute(
            "UPDATE safety_alerts_log SET resolved=1 WHERE id=%s", (aid,)
        )
        db.commit()
        return jsonify({"message": "Alert resolved"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@app.route("/api/system-notifications", methods=["GET"])
def get_system_notifications():
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        notifications = []

        # Low stock
        cursor.execute(
            "SELECT * FROM medicines WHERE quantity <= min_stock_level "
            "ORDER BY quantity ASC LIMIT 20"
        )
        for m in cursor.fetchall():
            level = "critical" if m["quantity"] == 0 else "warning"
            notifications.append({
                "id": f"stock_{m['id']}", "type": "low_stock", "level": level,
                "title": "Out of Stock" if level == "critical" else "Low Stock",
                "message": f"{m['name']} — {m['quantity']} units remaining",
                "icon": "package"
            })

        # Unresolved drug-interaction alerts
        cursor.execute("""
            SELECT sal.*, p.name as patient_name
            FROM safety_alerts_log sal
            LEFT JOIN patients p ON sal.patient_id = p.id
            WHERE sal.resolved = 0
            ORDER BY sal.created_at DESC LIMIT 10
        """)
        for a in cursor.fetchall():
            notifications.append({
                "id": f"alert_{a['id']}", "type": "interaction_risk",
                "level": "critical" if (a["severity"] or "").lower() == "critical" else "warning",
                "title": f"Drug Interaction ({(a['severity'] or '').upper()})",
                "message": (
                    f"{a['drug_a']} + {a['drug_b']}: {a['effect']} "
                    f"— {a['patient_name'] or 'Unknown patient'}"
                ),
                "icon": "shield-alert"
            })

        return jsonify({"notifications": notifications, "count": len(notifications)})
    finally:
        db.close()


# ════════════════════════════════════════
# SAFETY ALERTS LOG
# ════════════════════════════════════════

@app.route("/api/safety-alerts", methods=["GET"])
def safety_alerts():
    """
    Returns the safety_alerts_log table directly — fast, accurate,
    replaces the old slow O(n²) per-request scan.
    """
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        cursor.execute("""
            SELECT sal.id, sal.drug_a, sal.drug_b, sal.effect, sal.severity,
                   sal.resolved, sal.created_at, sal.patient_id,
                   p.name as patient_name
            FROM safety_alerts_log sal
            LEFT JOIN patients p ON sal.patient_id = p.id
            ORDER BY sal.created_at DESC LIMIT 100
        """)
        alerts = cursor.fetchall()
        return jsonify({"alerts": alerts, "total": len(alerts)})
    finally:
        db.close()


# ════════════════════════════════════════
# APPOINTMENTS
# ════════════════════════════════════════

@app.route("/api/appointments", methods=["GET"])
@require_roles("admin", "doctor", "patient")
def get_appointments():
    db = None
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        sql = """
            SELECT
                a.*,
                c.id AS consultation_id,
                c.doctor_name AS consultation_doctor_name,
                c.link_status AS consultation_link_status,
                c.zoom_error AS consultation_zoom_error
            FROM appointments a
            LEFT JOIN consultations c ON c.appointment_id = a.id
            WHERE 1=1
        """
        params = []
        if request.current_user.get("role") == "patient":
            sql += " AND (a.patient_user_id = %s OR a.patient_name = %s)"
            params.extend([request.current_user["id"], request.current_user["name"]])
        sql += " ORDER BY COALESCE(a.scheduled_at, a.created_at) DESC LIMIT 100"
        cursor.execute(sql, params)
        appointments = cursor.fetchall()
        now = datetime.datetime.now()
        for row in appointments:
            row["created_at"] = serialize_datetime(row.get("created_at"))
            row["scheduled_at"] = serialize_datetime(row.get("scheduled_at"))
            row["preferred_date"] = serialize_datetime(row.get("preferred_date"))
            row["doctor_name"] = row.get("consultation_doctor_name") or row.get("doctor_name")
            row["link_status"] = row.get("consultation_link_status") or row.get("link_status") or "not_required"
            row["zoom_error"] = row.get("consultation_zoom_error") or row.get("zoom_error")
            scheduled_at = row.get("scheduled_at")
            if isinstance(scheduled_at, str):
                try:
                    scheduled_at = datetime.datetime.fromisoformat(scheduled_at)
                except Exception:
                    scheduled_at = None
            row["join_enabled"] = bool(
                row.get("zoom_join_url")
                and scheduled_at
                and scheduled_at <= now
                and row.get("status") not in ("cancelled", "pending_link")
            )
            row["can_launch"] = bool(row.get("zoom_start_url"))
        return jsonify({"appointments": appointments})
    finally:
        if db:
            db.close()


@app.route("/api/appointments", methods=["POST"])
@require_roles("patient")
def book_appointment():
    data = request.json or {}
    patient_name = data.get("patient_name") or data.get("name")
    mode = data.get("mode", "video")
    preferred_date = data.get("preferred_date")
    time_slot = data.get("time_slot") or data.get("slot")
    scheduled_time = parse_appointment_datetime(preferred_date, time_slot) or (
        datetime.datetime.now() + datetime.timedelta(hours=1)
    )
    db = None
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor()
        cursor.execute(
            """
            INSERT INTO appointments
            (patient_user_id, patient_name, age, gender, specialty, preferred_date, time_slot,
             scheduled_at, symptoms, mode, status, link_status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                request.current_user["id"],
                patient_name,
                data.get("age"),
                data.get("gender"),
                data.get("specialty"),
                preferred_date,
                time_slot,
                scheduled_time,
                data.get("symptoms"),
                mode,
                "pending" if mode == "video" else "confirmed",
                "pending" if mode == "video" else "not_required",
            ),
        )
        appointment_id = cursor.lastrowid
        db.commit()

        zoom_data = None
        final_status = "confirmed" if mode != "video" else "pending_link"
        if mode == "video":
            topic = f"MediGuard: {patient_name} - {data.get('specialty', 'Consultation')}"
            meeting = _create_zoom_meeting(topic, scheduled_time, duration=30)
            if meeting.get("error"):
                cursor.execute(
                    """
                    UPDATE appointments
                    SET status=%s, link_status=%s, zoom_error=%s
                    WHERE id=%s
                    """,
                    ("pending_link", "pending", meeting["error"], appointment_id),
                )
                db.commit()
                notify_admins_about_zoom_error(appointment_id, patient_name, meeting["error"])
            else:
                cursor.execute(
                    """
                    UPDATE appointments
                    SET status=%s, zoom_meeting_id=%s, zoom_join_url=%s, zoom_start_url=%s,
                        zoom_password=%s, link_status=%s, zoom_error=NULL
                    WHERE id=%s
                    """,
                    (
                        "confirmed",
                        meeting["meeting_id"],
                        meeting["join_url"],
                        meeting["start_url"],
                        meeting["password"],
                        "generated",
                        appointment_id,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO consultations
                    (appointment_id, patient_user_id, patient_name, doctor_name, specialty,
                     zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_password,
                     zoom_meeting_topic, link_status, status, scheduled_at, mode)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        appointment_id,
                        request.current_user["id"],
                        patient_name,
                        "Auto-assigned Doctor",
                        data.get("specialty"),
                        meeting["meeting_id"],
                        meeting["join_url"],
                        meeting["start_url"],
                        meeting["password"],
                        topic,
                        "generated",
                        "scheduled",
                        scheduled_time,
                        "video",
                    ),
                )
                consultation_id = cursor.lastrowid
                db.commit()
                zoom_data = {
                    "meeting_id": meeting["meeting_id"],
                    "join_url": meeting["join_url"],
                    "start_url": meeting["start_url"],
                    "password": meeting["password"],
                    "consultation_id": consultation_id,
                    "link_status": "generated",
                }
                final_status = "confirmed"
                send_notification_to_doctors(
                    f"New Video Consultation: {patient_name}",
                    f"Patient {patient_name} booked a video consultation for {data.get('specialty')}.",
                    {
                        "appointment_id": appointment_id,
                        "consultation_id": consultation_id,
                        "patient_name": patient_name,
                        "specialty": data.get("specialty"),
                        "meeting_id": meeting["meeting_id"],
                        "scheduled_time": scheduled_time.isoformat(),
                        "start_url": meeting["start_url"],
                    },
                )

        return jsonify({
            "message": "Appointment booked",
            "id": appointment_id,
            "status": final_status,
            "scheduled_at": scheduled_time.isoformat(),
            "zoom": zoom_data
        }), 201
    finally:
        if db:
            db.close()


@app.route("/api/appointments/<int:aid>", methods=["PATCH"])
@require_roles("admin", "doctor", "patient")
def update_appointment_status(aid):
    data = request.json or {}
    status = data.get("status", "confirmed")
    db = None
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT * FROM appointments WHERE id=%s", (aid,))
        appointment = cursor.fetchone()
        if not appointment:
            return jsonify({"error": "Appointment not found"}), 404
        if (
            request.current_user.get("role") == "patient"
            and appointment.get("patient_user_id") not in (None, request.current_user["id"])
        ):
            return jsonify({"error": "Unauthorized"}), 403
        write_cursor = db.cursor()
        write_cursor.execute("UPDATE appointments SET status=%s WHERE id=%s", (status, aid))
        db.commit()
        return jsonify({"message": "Appointment status updated", "status": status})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if db:
            db.close()


@app.route("/api/appointments/<int:aid>", methods=["DELETE"])
@require_roles("admin", "doctor", "patient")
def delete_appointment(aid):
    db = None
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT * FROM appointments WHERE id=%s", (aid,))
        appointment = cursor.fetchone()
        if not appointment:
            return jsonify({"error": "Appointment not found"}), 404
        if (
            request.current_user.get("role") == "patient"
            and appointment.get("patient_user_id") not in (None, request.current_user["id"])
        ):
            return jsonify({"error": "Unauthorized"}), 403
        write_cursor = db.cursor()
        write_cursor.execute("UPDATE appointments SET status='cancelled' WHERE id=%s", (aid,))
        write_cursor.execute("UPDATE consultations SET status='cancelled' WHERE appointment_id=%s", (aid,))
        db.commit()
        return jsonify({"message": "Appointment cancelled successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    finally:
        if db:
            db.close()


# ════════════════════════════════════════
# CHAT MESSAGES (for chat-mode appointments)
# ════════════════════════════════════════

@app.route("/api/appointments/<int:aid>/chat", methods=["GET"])
@require_roles("admin", "doctor", "patient")
def get_chat_messages(aid):
    db = None
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        # Verify appointment exists and user has access
        cursor.execute("SELECT * FROM appointments WHERE id=%s", (aid,))
        apt = cursor.fetchone()
        if not apt:
            return jsonify({"error": "Appointment not found"}), 404
        uid = request.current_user["id"]
        role = request.current_user.get("role")
        if role == "patient" and apt.get("patient_user_id") not in (None, uid):
            return jsonify({"error": "Unauthorized"}), 403
        since = request.args.get("since", "")
        if since:
            cursor.execute(
                "SELECT * FROM apt_chat_messages WHERE appointment_id=%s AND created_at > %s ORDER BY created_at ASC",
                (aid, since)
            )
        else:
            cursor.execute(
                "SELECT * FROM apt_chat_messages WHERE appointment_id=%s ORDER BY created_at ASC LIMIT 200",
                (aid,)
            )
        msgs = cursor.fetchall()
        for m in msgs:
            if hasattr(m.get("created_at"), "isoformat"):
                m["created_at"] = m["created_at"].isoformat()
        return jsonify({"messages": msgs})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if db:
            db.close()


@app.route("/api/appointments/<int:aid>/chat", methods=["POST"])
@require_roles("admin", "doctor", "patient")
def post_chat_message(aid):
    db = None
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        cursor.execute("SELECT * FROM appointments WHERE id=%s", (aid,))
        apt = cursor.fetchone()
        if not apt:
            return jsonify({"error": "Appointment not found"}), 404
        uid = request.current_user["id"]
        role = request.current_user.get("role")
        if role == "patient" and apt.get("patient_user_id") not in (None, uid):
            return jsonify({"error": "Unauthorized"}), 403
        body = request.json or {}
        message = (body.get("message") or "").strip()
        if not message:
            return jsonify({"error": "Message cannot be empty"}), 400
        sender_name = request.current_user.get("name") or role or "User"
        wc = db.cursor()
        wc.execute(
            "INSERT INTO apt_chat_messages (appointment_id, sender_id, sender_name, sender_role, message) VALUES (%s,%s,%s,%s,%s)",
            (aid, uid, sender_name, role, message)
        )
        db.commit()
        return jsonify({"message": "sent", "id": wc.lastrowid}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if db:
            db.close()


# ════════════════════════════════════════
# NOTIFICATIONS (for doctors and admins)
# ════════════════════════════════════════

@app.route("/api/notifications", methods=["GET"])
@require_roles("admin", "doctor", "patient")
def get_notifications_for_user():
    """Get notifications for current user."""
    limit = int(request.args.get("limit", 50))
    db = None
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT * FROM notifications
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (request.current_user["id"], limit),
        )
        notifications = cursor.fetchall()
        for row in notifications:
            row["created_at"] = serialize_datetime(row.get("created_at"))
            if isinstance(row.get("data"), str):
                try:
                    row["data"] = json.loads(row["data"])
                except Exception:
                    pass
        return jsonify({"notifications": notifications})
    finally:
        if db:
            db.close()


@app.route("/api/notifications/<int:nid>/read", methods=["PATCH"])
@require_roles("admin", "doctor", "patient")
def mark_notification_read(nid):
    db = None
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            """
            UPDATE notifications SET is_read = 1
            WHERE id = %s AND user_id = %s
            """,
            (nid, request.current_user["id"]),
        )
        db.commit()
        return jsonify({"message": "Notification marked as read"})
    finally:
        if db:
            db.close()


def send_notifications_to_roles(roles, title, message, data=None, type_="appointment"):
    db = None
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        placeholders = ",".join(["%s"] * len(roles))
        cursor.execute(
            f"SELECT id FROM users WHERE role IN ({placeholders})",
            tuple(roles),
        )
        recipients = cursor.fetchall()
        write_cursor = db.cursor()
        for user in recipients:
            write_cursor.execute(
                """
                INSERT INTO notifications (user_id, type, title, message, data)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (user["id"], type_, title, message, json.dumps(data) if data else None),
            )
        db.commit()
    except Exception as e:
        print(f"Error sending notifications: {e}")
    finally:
        if db:
            db.close()


def send_notification_to_doctors(title, message, data=None, specialty=None):
    send_notifications_to_roles(["doctor"], title, message, data, type_="appointment")


def notify_admins_about_zoom_error(appointment_id, patient_name, error_message):
    send_notifications_to_roles(
        ["admin"],
        "Zoom link generation failed",
        f"Appointment #{appointment_id} for {patient_name} could not generate a Zoom link.",
        {
            "appointment_id": appointment_id,
            "patient_name": patient_name,
            "error": error_message,
            "status": "pending_link",
        },
        type_="zoom_error",
    )


# ════════════════════════════════════════
# CONTACT  (FEATURE: saves to DB)
# ════════════════════════════════════════

@app.route("/api/contact", methods=["POST"])
def contact():
    data = request.json
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor()
        cursor.execute(
            "INSERT INTO contact_messages (name,email,subject,message) "
            "VALUES (%s,%s,%s,%s)",
            (data.get("name"), data.get("email"),
             data.get("subject"), data.get("message"))
        )
        db.commit()
    except Exception as e:
            print(e)
    return jsonify({"message": "Message received. Thank you!"})


# ════════════════════════════════════════
# ADMIN
# ════════════════════════════════════════

@app.route("/api/admin/users", methods=["GET"])
def get_users():
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            "SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC"
        )
        return jsonify({"users": cursor.fetchall()})
    finally:
        db.close()


@app.route("/api/admin/users/<int:uid>", methods=["DELETE"])
def delete_user(uid):
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("DELETE FROM users WHERE id=%s", (uid,))
        db.commit()
        req_uid = get_token_user(request)
        audit(db, req_uid, "DELETE_USER", "users", uid)
        return jsonify({"message": "User deleted"})
    finally:
        db.close()


@app.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)

        cursor.execute("SELECT role, COUNT(*) as count FROM users GROUP BY role")
        users_by_role = cursor.fetchall()

        cursor.execute(
            "SELECT COUNT(*) as count FROM users WHERE DATE(created_at)=CURDATE()"
        )
        new_users_today = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM medicines WHERE quantity=0"
        )
        out_of_stock = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM medicines "
            "WHERE quantity > 0 AND quantity <= min_stock_level"
        )
        low_stock = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM appointments WHERE status='pending'"
        )
        pending_apts = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM safety_alerts_log WHERE resolved=0"
        )
        unresolved_alerts = cursor.fetchone()["count"]

        return jsonify({
            "users_by_role":     users_by_role,
            "new_users_today":   new_users_today,
            "out_of_stock":      out_of_stock,
            "low_stock":         low_stock,
            "pending_appointments": pending_apts,
            "unresolved_alerts": unresolved_alerts,
        })
    finally:
        db.close()


# ════════════════════════════════════════
# DASHBOARD SUMMARY
# ════════════════════════════════════════

@app.route("/api/dashboard/summary", methods=["GET"])
def dashboard_summary():
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)

        cursor.execute(
            "SELECT id,name,age,blood_group,created_at FROM patients "
            "ORDER BY created_at DESC LIMIT 5"
        )
        recent_patients = cursor.fetchall()

        cursor.execute("""
            SELECT pr.id, pr.medicine_name, pr.doctor_name, pr.created_at,
                   COALESCE(pr.safety_status,'SAFE') as safety_status,
                   p.name as patient_name
            FROM prescriptions pr LEFT JOIN patients p ON pr.patient_id=p.id
            ORDER BY pr.created_at DESC LIMIT 5
        """)
        recent_prescriptions = cursor.fetchall()

        cursor.execute(
            "SELECT id,patient_name,specialty,preferred_date,status "
            "FROM appointments ORDER BY created_at DESC LIMIT 5"
        )
        recent_appointments = cursor.fetchall()

        cursor.execute(
            "SELECT id,name,quantity,min_stock_level,category FROM medicines "
            "WHERE quantity <= min_stock_level ORDER BY quantity ASC LIMIT 5"
        )
        low_stock = cursor.fetchall()

        # Recent unresolved drug-interaction alerts
        cursor.execute("""
            SELECT sal.*, p.name as patient_name
            FROM safety_alerts_log sal
            LEFT JOIN patients p ON sal.patient_id = p.id
            WHERE sal.resolved = 0
            ORDER BY sal.created_at DESC LIMIT 5
        """)
        recent_alerts = cursor.fetchall()

        cursor.execute(
            "SELECT COUNT(*) as count FROM patients WHERE DATE(created_at)=CURDATE()"
        )
        today_patients = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM prescriptions WHERE DATE(created_at)=CURDATE()"
        )
        today_prescriptions = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) as count FROM appointments WHERE preferred_date=CURDATE()"
        )
        today_appointments = cursor.fetchone()["count"]

        return jsonify({
            "recent_patients":      recent_patients,
            "recent_prescriptions": recent_prescriptions,
            "recent_appointments":  recent_appointments,
            "low_stock":            low_stock,
            "recent_alerts":        recent_alerts,
            "today": {
                "patients":      today_patients,
                "prescriptions": today_prescriptions,
                "appointments":  today_appointments
            }
        })
    finally:
        db.close()


# ════════════════════════════════════════
# STATIC ENDPOINTS
# ════════════════════════════════════════

@app.route("/api/health-tips", methods=["GET"])
def health_tips():
    tips = [
        {"id":1,"title":"Stay Hydrated","tip":"Drink at least 8 glasses of water daily. Proper hydration supports kidney function, digestion, and overall health.","category":"Lifestyle","icon":"droplets"},
        {"id":2,"title":"Daily Exercise","tip":"Walk for at least 30 minutes daily. Regular exercise reduces risk of diabetes, heart disease, and depression by up to 50%.","category":"Fitness","icon":"activity"},
        {"id":3,"title":"Balanced Diet","tip":"Eat 5 servings of fruits and vegetables daily. A colorful plate means a healthy mix of vitamins and antioxidants.","category":"Nutrition","icon":"apple"},
        {"id":4,"title":"Quality Sleep","tip":"Adults need 7-9 hours of sleep. Poor sleep increases risk of obesity, diabetes, and cardiovascular disease.","category":"Lifestyle","icon":"moon"},
        {"id":5,"title":"Medication Safety","tip":"Never skip prescribed doses. Never share medications. Always complete the full course of antibiotics.","category":"Medical","icon":"pill"},
        {"id":6,"title":"Regular Checkups","tip":"Visit your doctor at least once a year even when healthy. Early detection saves lives — especially for diabetes and cancer.","category":"Medical","icon":"stethoscope"},
        {"id":7,"title":"Manage Stress","tip":"Chronic stress raises cortisol which damages the heart and immune system. Practice 10 minutes of breathing exercises daily.","category":"Mental Health","icon":"heart"},
        {"id":8,"title":"Limit Salt","tip":"Keep salt intake under 5g per day. High sodium is the leading cause of hypertension affecting 1.3 billion people globally.","category":"Nutrition","icon":"shield"},
        {"id":9,"title":"Quit Smoking","tip":"Quitting smoking cuts your heart disease risk by 50% within 1 year and lung cancer risk halves within 10 years.","category":"Lifestyle","icon":"wind"},
        {"id":10,"title":"Hand Hygiene","tip":"Wash hands for 20 seconds before meals and after using the bathroom. This single habit prevents 80% of infectious diseases.","category":"Hygiene","icon":"hand"},
    ]
    return jsonify({"tips": tips})


@app.route("/api/health", methods=["GET"])
def health_check():
    db_status = "error"
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT 1")
        db_status = "connected"
        db.close()
    except Exception as e:
            print(e)
    return jsonify({
        "status":   "ok",
        "version":  "3.0.0",
        "database": db_status,
        "features": [
            "patient_management", "prescriptions", "drug_interactions",
            "medicine_search", "safety_alerts_log", "appointments",
            "analytics", "pdf_reports", "csv_export", "notifications",
            "system_settings", "audit_log", "contact_messages",
            "force_save_rx", "delete_interactions", "portal_lookup"
        ]
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)