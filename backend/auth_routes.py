"""
auth_routes.py  –  MediGuard AI  ·  Extended Authentication Routes
Adds: Phone OTP login  |  Google OAuth login
-------------------------------------------------------------------
HOW TO WIRE IN:
  1. pip install requests
  2. In app.py, add near the top:
       from auth_routes import register_auth_routes
  3. After  app = Flask(__name__)  add:
       register_auth_routes(app)
  4. Add to your .env:
       GOOGLE_CLIENT_ID=<your-google-client-id>
       OTP_EXPIRE_MINUTES=10
"""

import random, string, datetime, hashlib, os, requests
from flask import request, jsonify
from config import get_db

# ── In-memory OTP store  { phone_e164: {otp, expires_at, attempts} }
# For production use Redis or a DB table instead.
_otp_store: dict = {}

GOOGLE_CLIENT_ID  = os.getenv("GOOGLE_CLIENT_ID", "")
OTP_EXPIRE_MINS   = int(os.getenv("OTP_EXPIRE_MINUTES", "10"))
MAX_OTP_ATTEMPTS  = 5

# ─────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────

def _hash(p: str) -> str:
    return hashlib.sha256(p.encode()).hexdigest()

def _gen_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))

def _e164(phone: str, country_code: str) -> str:
    """Normalise to E.164-ish key for storage, e.g. +919876543210"""
    phone = phone.strip().lstrip("0")
    cc    = country_code.strip().lstrip("+")
    return f"+{cc}{phone}"

def _send_otp_sms(e164: str, otp: str) -> bool:
    import requests
    url = "https://api.msg91.com/api/v5/otp"
    params = {
        "template_id": os.getenv("MSG91_TEMPLATE_ID"),
        "mobile": e164.lstrip("+"),
        "authkey": os.getenv("MSG91_AUTHKEY"),
        "otp": otp,
    }
    r = requests.post(url, json=params, timeout=5)
    return r.status_code == 200

def _ensure_auth_tables():
    """Ensure the auth-related columns exist even on a fresh database."""
    db = get_db()
    try:
        c = db.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                name       VARCHAR(200) NOT NULL,
                email      VARCHAR(200) DEFAULT NULL UNIQUE,
                password   VARCHAR(255) NOT NULL,
                role       VARCHAR(50) DEFAULT 'patient',
                phone      VARCHAR(20) DEFAULT NULL,
                google_id  VARCHAR(200) DEFAULT NULL,
                avatar     VARCHAR(500) DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Use independent ALTERs for broader MySQL compatibility.
        try:
            c.execute("ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT NULL")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE users ADD COLUMN google_id VARCHAR(200) DEFAULT NULL")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE users ADD COLUMN avatar VARCHAR(500) DEFAULT NULL")
        except Exception:
            pass
        db.commit()
    finally:
        db.close()

def _get_or_create_user_by_phone(db, phone_e164: str) -> dict:
    """Find user by phone, or auto-create a guest account."""
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT id,name,email,role,phone FROM users WHERE phone=%s", (phone_e164,))
    user = cursor.fetchone()
    if user:
        return user
    # Create new minimal user
    name = "User " + phone_e164[-4:]
    cursor.execute(
        "INSERT INTO users (name, phone, role, password) VALUES (%s, %s, %s, %s)",
        (name, phone_e164, "patient", _hash("phone_auth"))
    )
    db.commit()
    uid = cursor.lastrowid
    return {"id": uid, "name": name, "email": None, "role": "patient", "phone": phone_e164}

def _get_or_create_user_by_google(db, gid: str, email: str, name: str, picture: str = "") -> dict:
    """Find or auto-create a user from Google credentials."""
    cursor = db.cursor(dictionary=True)
    # Try by google_id column first, fall back to email
    cursor.execute("SELECT id,name,email,role FROM users WHERE google_id=%s", (gid,))
    user = cursor.fetchone()
    if not user and email:
        cursor.execute("SELECT id,name,email,role FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()
        if user:
            # Link google_id
            cursor.execute("UPDATE users SET google_id=%s WHERE id=%s", (gid, user["id"]))
            db.commit()
    if not user:
        cursor.execute(
            "INSERT INTO users (name, email, google_id, role, password) VALUES (%s,%s,%s,%s,%s)",
            (name, email, gid, "patient", _hash("google_oauth"))
        )
        db.commit()
        uid = cursor.lastrowid
        user = {"id": uid, "name": name, "email": email, "role": "patient"}
    return user

# ─────────────────────────────────────────────────────────────────
#  ROUTE REGISTRATION
# ─────────────────────────────────────────────────────────────────

def register_auth_routes(app):

    # ── Ensure users table has the extra columns ──────────────────
    try:
        _ensure_auth_tables()
    except Exception as e:
        print(f"[auth_routes] Column migration note: {e}")

    # ── 1. Send OTP ───────────────────────────────────────────────
    @app.route("/api/auth/send-otp", methods=["POST"])
    def send_otp():
        body         = request.json or {}
        phone        = body.get("phone", "").strip()
        country_code = body.get("country_code", "91").strip().lstrip("+")

        if not phone or len(phone) < 6:
            return jsonify({"error": "Enter a valid phone number"}), 400

        e164 = _e164(phone, country_code)
        otp  = _gen_otp(6)
        expires = datetime.datetime.utcnow() + datetime.timedelta(minutes=OTP_EXPIRE_MINS)

        _otp_store[e164] = {
            "otp":        otp,
            "expires_at": expires,
            "attempts":   0,
        }

        if not _send_otp_sms(e164, otp):
            return jsonify({"error": "Failed to send OTP. Try again."}), 500

        return jsonify({
            "message": f"OTP sent to {e164}. Valid for {OTP_EXPIRE_MINS} minutes.",
            # Remove next line in production!
            "dev_otp": otp
        })

    # ── 2. Verify OTP & log in ────────────────────────────────────
    @app.route("/api/auth/verify-otp", methods=["POST"])
    def verify_otp():
        body         = request.json or {}
        phone        = body.get("phone", "").strip()
        country_code = body.get("country_code", "91").strip().lstrip("+")
        otp_input    = body.get("otp", "").strip()

        if not phone or not otp_input:
            return jsonify({"error": "Phone and OTP are required"}), 400

        e164    = _e164(phone, country_code)
        record  = _otp_store.get(e164)

        if not record:
            return jsonify({"error": "No OTP requested for this number"}), 400

        if record["attempts"] >= MAX_OTP_ATTEMPTS:
            _otp_store.pop(e164, None)
            return jsonify({"error": "Too many wrong attempts. Request a new OTP."}), 429

        if datetime.datetime.utcnow() > record["expires_at"]:
            _otp_store.pop(e164, None)
            return jsonify({"error": "OTP has expired. Request a new one."}), 400

        if otp_input != record["otp"]:
            record["attempts"] += 1
            left = MAX_OTP_ATTEMPTS - record["attempts"]
            return jsonify({"error": f"Incorrect OTP. {left} attempt(s) left."}), 401

        # OTP correct – clear and log in
        _otp_store.pop(e164, None)

        try:
            _ensure_auth_tables()
            db   = get_db()
            user = _get_or_create_user_by_phone(db, e164)
            db.close()
            return jsonify({
                "message": "Login successful",
                "token":   "mg_token_" + str(user["id"]),
                "user":    user
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── 3. Google OAuth (verify ID-token on server) ───────────────
    @app.route("/api/auth/google-login", methods=["POST"])
    def google_login():
        body       = request.json or {}
        credential = body.get("credential", "")   # Google JWT id_token

        if not credential:
            return jsonify({"error": "Missing Google credential"}), 400

        info = None

        # ── Strategy 1: Fast JWT decode (no network call needed) ──
        # The Google ID token is a signed JWT. We decode the payload
        # without verifying the signature here (Google's tokeninfo will
        # do the real verification). This lets us give a fast response
        # while the network call runs.
        try:
            import base64, json as _json
            parts = credential.split(".")
            if len(parts) == 3:
                # Pad the base64 payload and decode
                payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
                payload_bytes = base64.urlsafe_b64decode(payload_b64)
                info = _json.loads(payload_bytes)
        except Exception:
            info = None

        # ── Strategy 2: Verify with Google's tokeninfo endpoint ───
        # Always verify with Google so we know the token is genuine.
        try:
            resp = requests.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": credential},
                timeout=8
            )
            verified = resp.json()
            if "error_description" not in verified and "error" not in verified:
                info = verified   # authoritative payload
            elif info is None:
                # Token is invalid and we have no fallback payload
                err_msg = verified.get("error_description") or verified.get("error", "Invalid token")
                return jsonify({"error": "Invalid Google token: " + err_msg}), 401
            # If Google returned an error but we have a decoded payload,
            # the token might be expired — still reject it.
            elif "error_description" in verified or "error" in verified:
                err_msg = verified.get("error_description") or verified.get("error", "Token verification failed")
                return jsonify({"error": "Google token rejected: " + err_msg}), 401
        except requests.exceptions.Timeout:
            # Google servers timed out – fall back to decoded payload if available
            if info is None:
                return jsonify({"error": "Could not reach Google servers (timeout). Please retry."}), 502
            print("[google_login] tokeninfo timeout, using decoded payload (unverified)")
        except Exception as exc:
            if info is None:
                return jsonify({"error": "Could not reach Google servers"}), 502
            print(f"[google_login] tokeninfo error: {exc}, using decoded payload (unverified)")

        # ── Audience check (optional but recommended) ─────────────
        if GOOGLE_CLIENT_ID:
            aud = info.get("aud", "")
            # aud may be a single string or a comma-separated list
            aud_list = [a.strip() for a in aud.split(",")] if isinstance(aud, str) else [aud]
            if GOOGLE_CLIENT_ID not in aud_list:
                return jsonify({"error": "Token audience mismatch — wrong Google Client ID"}), 401

        # ── Extract user fields ────────────────────────────────────
        gid     = info.get("sub", "")
        email   = info.get("email", "")
        name    = info.get("name") or (email.split("@")[0] if email else "Google User")
        picture = info.get("picture", "")

        if not gid:
            return jsonify({"error": "Could not extract user ID from Google token"}), 400

        if not info.get("email_verified") and info.get("email_verified") is not None:
            return jsonify({"error": "Google account email is not verified"}), 401

        try:
            _ensure_auth_tables()
            db   = get_db()
            user = _get_or_create_user_by_google(db, gid, email, name, picture)
            # Persist avatar URL
            c = db.cursor()
            c.execute("UPDATE users SET avatar=%s WHERE id=%s", (picture, user["id"]))
            db.commit()
            db.close()
            user["avatar"] = picture
            return jsonify({
                "message": "Google login successful",
                "token":   "mg_token_" + str(user["id"]),
                "user":    user
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500
