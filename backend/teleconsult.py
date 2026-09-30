"""
teleconsult.py  –  MediGuard AI: Teleconsultation Routes (Zoom-integrated)

Add to app.py:
    from teleconsult import register_teleconsult_routes
    register_teleconsult_routes(app)

Environment variables needed (.env):
    ZOOM_ACCOUNT_ID     = <Your Zoom Server-to-Server OAuth Account ID>
    ZOOM_CLIENT_ID      = <Your Zoom Server-to-Server OAuth Client ID>
    ZOOM_CLIENT_SECRET  = <Your Zoom Server-to-Server OAuth Client Secret>
"""

import os, datetime, requests, base64
from flask import request, jsonify

ZOOM_ACCOUNT_ID    = os.getenv("ZOOM_ACCOUNT_ID", "")
ZOOM_CLIENT_ID     = os.getenv("ZOOM_CLIENT_ID", "")
ZOOM_CLIENT_SECRET = os.getenv("ZOOM_CLIENT_SECRET", "")


# ─── Zoom helpers ────────────────────────────────────────────────────────────

def _get_zoom_token():
    """
    Get a Server-to-Server OAuth access token from Zoom.
    Returns the token string or None on failure.
    """
    if not all([ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET]):
        return None
    creds   = base64.b64encode(f"{ZOOM_CLIENT_ID}:{ZOOM_CLIENT_SECRET}".encode()).decode()
    url     = f"https://zoom.us/oauth/token?grant_type=account_credentials&account_id={ZOOM_ACCOUNT_ID}"
    headers = {"Authorization": f"Basic {creds}", "Content-Type": "application/x-www-form-urlencoded"}
    try:
        r = requests.post(url, headers=headers, timeout=10)
        return r.json().get("access_token")
    except Exception:
        return None


def _create_zoom_meeting(topic: str, scheduled_at: datetime.datetime,
                          duration: int = 30, password: str = "") -> dict:
    """
    Create a Zoom meeting. Returns dict with meeting_id, join_url, start_url, password.
    Falls back to demo values if Zoom is not configured.
    """
    token = _get_zoom_token()
    if not token:
        # Demo / offline mode — generate simulated meeting links
        mid  = f"MG-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}"
        pwd  = password or "mediguard"
        return {
            "meeting_id": mid,
            "join_url":   f"https://zoom.us/j/{mid}?pwd={pwd}",
            "start_url":  f"https://zoom.us/s/{mid}?zak=demo",
            "password":   pwd,
            "topic":      topic,
            "_demo":      True
        }

    headers  = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload  = {
        "topic":      topic,
        "type":       2,          # Scheduled meeting
        "start_time": scheduled_at.strftime("%Y-%m-%dT%H:%M:%S"),
        "duration":   duration,
        "timezone":   "Asia/Kolkata",
        "password":   password or "mediguard",
        "settings":   {
            "host_video":       True,
            "participant_video": True,
            "join_before_host": True,
            "mute_upon_entry":  False,
            "waiting_room":     True,
            "auto_recording":   "none"
        }
    }
    try:
        r    = requests.post("https://api.zoom.us/v2/users/me/meetings",
                             json=payload, headers=headers, timeout=15)
        data = r.json()
        return {
            "meeting_id": str(data.get("id", "")),
            "join_url":   data.get("join_url", ""),
            "start_url":  data.get("start_url", ""),
            "password":   data.get("password", "mediguard"),
            "topic":      topic,
            "_demo":      False
        }
    except Exception as e:
        return {"error": str(e)}


def _delete_zoom_meeting(meeting_id: str):
    token = _get_zoom_token()
    if not token or not meeting_id or meeting_id.startswith("MG-"):
        return
    headers = {"Authorization": f"Bearer {token}"}
    try:
        requests.delete(f"https://api.zoom.us/v2/meetings/{meeting_id}",
                        headers=headers, timeout=10)
    except Exception:
        pass


# ─── Route registration ────────────────────────────────────────────────────

def register_teleconsult_routes(app):
    from config import get_db

    # ── GET all doctors ──────────────────────────────────────────────────────
    @app.route("/api/doctors", methods=["GET"])
    def get_doctors():
        specialty = request.args.get("specialty", "")
        status    = request.args.get("status", "")
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            sql    = "SELECT * FROM doctors WHERE 1=1"
            params = []
            if specialty:
                sql    += " AND specialty LIKE %s"
                params.append(f"%{specialty}%")
            if status:
                sql    += " AND status = %s"
                params.append(status)
            sql += " ORDER BY status ASC, rating DESC"
            cursor.execute(sql, params)
            doctors = cursor.fetchall()
            return jsonify({"doctors": doctors})
        finally:
            db.close()


    @app.route("/api/doctors/<int:did>", methods=["GET"])
    def get_doctor(did):
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM doctors WHERE id=%s", (did,))
            doc = cursor.fetchone()
            if not doc:
                return jsonify({"error": "Doctor not found"}), 404
            return jsonify({"doctor": doc})
        finally:
            db.close()


    @app.route("/api/doctors/<int:did>/status", methods=["PATCH"])
    def update_doctor_status(did):
        data   = request.json
        status = data.get("status")
        if status not in ("available", "busy", "offline"):
            return jsonify({"error": "Invalid status"}), 400
        try:
            db     = get_db()
            cursor = db.cursor()
            cursor.execute("UPDATE doctors SET status=%s WHERE id=%s", (status, did))
            db.commit()
            return jsonify({"message": "Status updated", "status": status})
        finally:
            db.close()


    # ── Book / Create a consultation (creates Zoom meeting) ─────────────────
    @app.route("/api/consultations", methods=["POST"])
    def create_consultation():
        data = request.json
        patient_name  = data.get("patient_name", "").strip()
        patient_phone = data.get("patient_phone", "").strip()
        doctor_id     = data.get("doctor_id")
        doctor_name   = data.get("doctor_name", "").strip()
        specialty     = data.get("specialty", "General Physician")
        scheduled_str = data.get("scheduled_at")  # "2025-06-15T10:00:00"
        duration      = int(data.get("duration_minutes", 30))
        mode          = data.get("mode", "video")
        notes         = data.get("notes", "")
        appt_id       = data.get("appointment_id")

        if not patient_name or not doctor_name:
            return jsonify({"error": "patient_name and doctor_name required"}), 400

        # Parse scheduled time
        try:
            if scheduled_str:
                scheduled_at = datetime.datetime.fromisoformat(scheduled_str)
            else:
                scheduled_at = datetime.datetime.now() + datetime.timedelta(hours=1)
        except Exception:
            scheduled_at = datetime.datetime.now() + datetime.timedelta(hours=1)

        # Create Zoom meeting
        topic   = f"MediGuard: {patient_name} with {doctor_name} ({specialty})"
        meeting = _create_zoom_meeting(topic, scheduled_at, duration)

        if "error" in meeting:
            return jsonify({"error": f"Zoom error: {meeting['error']}"}), 500

        try:
            db     = get_db()
            cursor = db.cursor()
            cursor.execute("""
                INSERT INTO consultations
                (appointment_id, patient_name, patient_phone, doctor_name, doctor_id,
                 specialty, zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_password,
                 zoom_meeting_topic, status, scheduled_at, mode, notes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                appt_id, patient_name, patient_phone, doctor_name, doctor_id,
                specialty, meeting["meeting_id"], meeting["join_url"],
                meeting["start_url"], meeting["password"],
                topic, "scheduled", scheduled_at, mode, notes
            ))
            db.commit()
            cid = cursor.lastrowid

            # Update doctor status to busy if starting now
            if doctor_id:
                now = datetime.datetime.now()
                if abs((scheduled_at - now).total_seconds()) < 300:
                    cursor.execute("UPDATE doctors SET status='busy' WHERE id=%s", (doctor_id,))
                    db.commit()

            return jsonify({
                "message":    "Consultation created",
                "id":         cid,
                "zoom":       meeting,
                "join_url":   meeting["join_url"],
                "start_url":  meeting["start_url"],
                "password":   meeting["password"],
                "meeting_id": meeting["meeting_id"],
                "demo_mode":  meeting.get("_demo", False)
            }), 201
        finally:
            db.close()


    # ── List consultations ───────────────────────────────────────────────────
    @app.route("/api/consultations", methods=["GET"])
    def list_consultations():
        status  = request.args.get("status", "")
        patient = request.args.get("patient", "")
        limit   = int(request.args.get("limit", 50))
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            sql    = """
                SELECT c.*, d.avatar_initials, d.avatar_color, d.rating as doctor_rating
                FROM consultations c
                LEFT JOIN doctors d ON c.doctor_id = d.id
                WHERE 1=1
            """
            params = []
            if status:
                sql    += " AND c.status = %s"
                params.append(status)
            if patient:
                sql    += " AND c.patient_name LIKE %s"
                params.append(f"%{patient}%")
            sql += " ORDER BY c.scheduled_at DESC LIMIT %s"
            params.append(limit)
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            # Convert datetimes to strings
            for row in rows:
                for k in ("scheduled_at", "started_at", "ended_at", "created_at"):
                    if row.get(k) and hasattr(row[k], "isoformat"):
                        row[k] = row[k].isoformat()
            return jsonify({"consultations": rows})
        finally:
            db.close()


    # ── Get single consultation ──────────────────────────────────────────────
    @app.route("/api/consultations/<int:cid>", methods=["GET"])
    def get_consultation(cid):
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("""
                SELECT c.*, d.avatar_initials, d.avatar_color, d.qualification,
                       d.consult_fee, d.rating as doctor_rating
                FROM consultations c
                LEFT JOIN doctors d ON c.doctor_id = d.id
                WHERE c.id = %s
            """, (cid,))
            row = cursor.fetchone()
            if not row:
                return jsonify({"error": "Consultation not found"}), 404
            for k in ("scheduled_at", "started_at", "ended_at", "created_at"):
                if row.get(k) and hasattr(row[k], "isoformat"):
                    row[k] = row[k].isoformat()
            return jsonify({"consultation": row})
        finally:
            db.close()


    # ── Start consultation ───────────────────────────────────────────────────
    @app.route("/api/consultations/<int:cid>/start", methods=["POST"])
    def start_consultation(cid):
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM consultations WHERE id=%s", (cid,))
            con = cursor.fetchone()
            if not con:
                return jsonify({"error": "Not found"}), 404
            cursor.execute(
                "UPDATE consultations SET status='active', started_at=NOW() WHERE id=%s", (cid,)
            )
            if con.get("doctor_id"):
                cursor.execute("UPDATE doctors SET status='busy' WHERE id=%s", (con["doctor_id"],))
            db.commit()
            return jsonify({
                "message":   "Consultation started",
                "start_url": con.get("zoom_start_url"),
                "join_url":  con.get("zoom_join_url"),
                "password":  con.get("zoom_password")
            })
        finally:
            db.close()


    # ── End consultation + save notes/prescription ────────────────────────────
    @app.route("/api/consultations/<int:cid>/end", methods=["POST"])
    def end_consultation(cid):
        data = request.json or {}
        notes        = data.get("notes", "")
        diagnosis    = data.get("diagnosis", "")
        prescription = data.get("prescription_issued", "")
        follow_up    = data.get("follow_up_date")
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM consultations WHERE id=%s", (cid,))
            con = cursor.fetchone()
            if not con:
                return jsonify({"error": "Not found"}), 404

            # Calculate duration
            started = con.get("started_at")
            dur     = None
            if started:
                dur = int((datetime.datetime.now() - started).total_seconds() / 60)

            cursor.execute("""
                UPDATE consultations
                SET status='completed', ended_at=NOW(),
                    duration_minutes=%s, notes=%s, diagnosis=%s,
                    prescription_issued=%s, follow_up_date=%s
                WHERE id=%s
            """, (dur, notes, diagnosis, prescription, follow_up, cid))

            if con.get("doctor_id"):
                cursor.execute("UPDATE doctors SET status='available' WHERE id=%s",
                               (con["doctor_id"],))
            db.commit()
            return jsonify({"message": "Consultation ended", "duration_minutes": dur})
        finally:
            db.close()


    # ── Cancel consultation ──────────────────────────────────────────────────
    @app.route("/api/consultations/<int:cid>/cancel", methods=["POST"])
    def cancel_consultation(cid):
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM consultations WHERE id=%s", (cid,))
            con = cursor.fetchone()
            if not con:
                return jsonify({"error": "Not found"}), 404
            cursor.execute("UPDATE consultations SET status='cancelled' WHERE id=%s", (cid,))
            if con.get("doctor_id"):
                cursor.execute(
                    "UPDATE doctors SET status='available' WHERE id=%s AND status='busy'",
                    (con["doctor_id"],)
                )
            db.commit()
            _delete_zoom_meeting(con.get("zoom_meeting_id", ""))
            return jsonify({"message": "Consultation cancelled"})
        finally:
            db.close()


    # ── Consultation stats ───────────────────────────────────────────────────
    @app.route("/api/consultations/stats", methods=["GET"])
    def consultation_stats():
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("""
                SELECT
                    COUNT(*) as total,
                    SUM(status='completed')  as completed,
                    SUM(status='scheduled')  as scheduled,
                    SUM(status='active')     as active,
                    SUM(status='cancelled')  as cancelled,
                    ROUND(AVG(CASE WHEN status='completed' THEN duration_minutes END),1) as avg_duration
                FROM consultations
            """)
            stats = cursor.fetchone()

            cursor.execute("""
                SELECT specialty, COUNT(*) as count
                FROM consultations GROUP BY specialty ORDER BY count DESC LIMIT 6
            """)
            by_specialty = cursor.fetchall()

            cursor.execute("""
                SELECT DATE_FORMAT(scheduled_at,'%b %d') as day, COUNT(*) as count
                FROM consultations
                WHERE scheduled_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(scheduled_at) ORDER BY DATE(scheduled_at)
            """)
            daily_trend = cursor.fetchall()

            return jsonify({
                "stats":       stats,
                "by_specialty": by_specialty,
                "daily_trend": daily_trend
            })
        finally:
            db.close()


    # ── Quick join by Zoom meeting ID ────────────────────────────────────────
    @app.route("/api/consultations/join/<meeting_id>", methods=["GET"])
    def join_by_meeting_id(meeting_id):
        try:
            db     = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                "SELECT id, patient_name, doctor_name, zoom_join_url, zoom_password, "
                "status, scheduled_at FROM consultations WHERE zoom_meeting_id=%s",
                (meeting_id,)
            )
            con = cursor.fetchone()
            if not con:
                return jsonify({"error": "Meeting not found"}), 404
            if con.get("scheduled_at") and hasattr(con["scheduled_at"], "isoformat"):
                con["scheduled_at"] = con["scheduled_at"].isoformat()
            return jsonify({"consultation": con})
        finally:
            db.close()
