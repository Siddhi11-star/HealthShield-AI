"""
teleconsult_v2.py - Teleconsultation routes with RBAC and Zoom meeting support.
"""

import base64
import datetime
import os

import requests
from flask import jsonify, request

from auth_utils import require_roles

ZOOM_ACCOUNT_ID = os.getenv("ZOOM_ACCOUNT_ID", "")
ZOOM_CLIENT_ID = os.getenv("ZOOM_CLIENT_ID", "")
ZOOM_CLIENT_SECRET = os.getenv("ZOOM_CLIENT_SECRET", "")
ZOOM_TIMEZONE = os.getenv("ZOOM_TIMEZONE", "Asia/Kolkata")

_ZOOM_TOKEN_CACHE = {"access_token": None, "expires_at": None}


def _zoom_configured():
    return all([ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET])


def _get_zoom_token(force_refresh=False):
    if not _zoom_configured():
        return {"error": "Zoom server credentials are not configured"}

    now = datetime.datetime.utcnow()
    expires_at = _ZOOM_TOKEN_CACHE.get("expires_at")
    if (
        not force_refresh
        and _ZOOM_TOKEN_CACHE.get("access_token")
        and expires_at
        and expires_at > now + datetime.timedelta(seconds=60)
    ):
        return {"access_token": _ZOOM_TOKEN_CACHE["access_token"]}

    creds = base64.b64encode(f"{ZOOM_CLIENT_ID}:{ZOOM_CLIENT_SECRET}".encode()).decode()
    url = (
        "https://zoom.us/oauth/token"
        f"?grant_type=account_credentials&account_id={ZOOM_ACCOUNT_ID}"
    )
    headers = {
        "Authorization": f"Basic {creds}",
        "Content-Type": "application/x-www-form-urlencoded",
    }

    try:
        response = requests.post(url, headers=headers, timeout=15)
        data = response.json()
    except Exception as exc:
        return {"error": f"Unable to reach Zoom OAuth: {exc}"}

    if not response.ok or not data.get("access_token"):
        return {
            "error": data.get("reason") or data.get("message") or "Zoom OAuth failed",
            "status_code": response.status_code,
        }

    expires_in = int(data.get("expires_in", 3600))
    _ZOOM_TOKEN_CACHE["access_token"] = data["access_token"]
    _ZOOM_TOKEN_CACHE["expires_at"] = now + datetime.timedelta(seconds=expires_in)
    return {"access_token": data["access_token"]}


def _normalize_zoom_meeting(data):
    return {
        "meeting_id": str(data.get("id", "")),
        "join_url": data.get("join_url", ""),
        "start_url": data.get("start_url", ""),
        "password": data.get("password", ""),
        "topic": data.get("topic", ""),
    }


def _create_zoom_meeting(topic, scheduled_at, duration=30, password=""):
    token_result = _get_zoom_token()
    if token_result.get("error"):
        return token_result

    payload = {
        "topic": topic,
        "type": 2,
        "start_time": scheduled_at.strftime("%Y-%m-%dT%H:%M:%S"),
        "duration": duration,
        "timezone": ZOOM_TIMEZONE,
        "password": password or "mediguard",
        "settings": {
            "host_video": True,
            "participant_video": True,
            "join_before_host": False,
            "mute_upon_entry": False,
            "waiting_room": True,
            "auto_recording": "none",
        },
    }

    def create_once(access_token):
        return requests.post(
            "https://api.zoom.us/v2/users/me/meetings",
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            timeout=20,
        )

    try:
        response = create_once(token_result["access_token"])
        if response.status_code == 401:
            refreshed = _get_zoom_token(force_refresh=True)
            if refreshed.get("error"):
                return refreshed
            response = create_once(refreshed["access_token"])
        data = response.json()
    except Exception as exc:
        return {"error": f"Unable to create Zoom meeting: {exc}"}

    if not response.ok:
        return {
            "error": data.get("message") or data.get("reason") or "Zoom meeting creation failed",
            "status_code": response.status_code,
        }

    meeting = _normalize_zoom_meeting(data)
    if not meeting["meeting_id"] or not meeting["join_url"] or not meeting["start_url"]:
        return {"error": "Zoom meeting was created with incomplete meeting links"}
    return meeting


def _delete_zoom_meeting(meeting_id):
    if not meeting_id:
        return

    token_result = _get_zoom_token()
    if token_result.get("error"):
        return

    try:
        requests.delete(
            f"https://api.zoom.us/v2/meetings/{meeting_id}",
            headers={"Authorization": f"Bearer {token_result['access_token']}"},
            timeout=10,
        )
    except Exception:
        pass


def _serialize_rows(rows):
    for row in rows:
        for key in ("scheduled_at", "started_at", "ended_at", "created_at"):
            if row.get(key) and hasattr(row[key], "isoformat"):
                row[key] = row[key].isoformat()
        row["join_enabled"] = False
        if row.get("scheduled_at"):
            row["join_enabled"] = bool(
                row.get("zoom_join_url")
                and datetime.datetime.fromisoformat(row["scheduled_at"]) <= datetime.datetime.now()
            )
    return rows


def register_teleconsult_routes(app):
    from config import get_db

    @app.route("/api/doctors", methods=["GET"])
    @require_roles("admin", "doctor", "patient")
    def get_doctors():
        specialty = request.args.get("specialty", "")
        status = request.args.get("status", "")
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            sql = "SELECT * FROM doctors WHERE 1=1"
            params = []
            if specialty:
                sql += " AND specialty LIKE %s"
                params.append(f"%{specialty}%")
            if status:
                sql += " AND status = %s"
                params.append(status)
            sql += " ORDER BY status ASC, rating DESC"
            cursor.execute(sql, params)
            return jsonify({"doctors": cursor.fetchall()})
        finally:
            if db:
                db.close()

    @app.route("/api/doctors/<int:did>", methods=["GET"])
    @require_roles("admin", "doctor", "patient")
    def get_doctor(did):
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM doctors WHERE id=%s", (did,))
            doctor = cursor.fetchone()
            if not doctor:
                return jsonify({"error": "Doctor not found"}), 404
            return jsonify({"doctor": doctor})
        finally:
            if db:
                db.close()

    @app.route("/api/doctors/<int:did>/status", methods=["PATCH"])
    @require_roles("admin", "doctor")
    def update_doctor_status(did):
        data = request.json or {}
        status = data.get("status")
        if status not in ("available", "busy", "offline"):
            return jsonify({"error": "Invalid status"}), 400

        db = None
        try:
            db = get_db()
            cursor = db.cursor()
            cursor.execute("UPDATE doctors SET status=%s WHERE id=%s", (status, did))
            db.commit()
            return jsonify({"message": "Status updated", "status": status})
        finally:
            if db:
                db.close()

    @app.route("/api/consultations", methods=["GET"])
    @require_roles("admin", "doctor", "patient")
    def list_consultations():
        status = request.args.get("status", "")
        limit = int(request.args.get("limit", 50))
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            sql = """
                SELECT c.*, d.avatar_initials, d.avatar_color, d.rating as doctor_rating
                FROM consultations c
                LEFT JOIN doctors d ON c.doctor_id = d.id
                WHERE 1=1
            """
            params = []
            if status:
                sql += " AND c.status = %s"
                params.append(status)
            if request.current_user.get("role") == "patient":
                sql += " AND (c.patient_user_id = %s OR c.patient_name = %s)"
                params.extend([request.current_user["id"], request.current_user["name"]])
            sql += " ORDER BY c.scheduled_at DESC LIMIT %s"
            params.append(limit)
            cursor.execute(sql, params)
            return jsonify({"consultations": _serialize_rows(cursor.fetchall())})
        finally:
            if db:
                db.close()

    @app.route("/api/consultations/<int:cid>", methods=["GET"])
    @require_roles("admin", "doctor", "patient")
    def get_consultation(cid):
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT c.*, d.avatar_initials, d.avatar_color, d.qualification,
                       d.consult_fee, d.rating as doctor_rating
                FROM consultations c
                LEFT JOIN doctors d ON c.doctor_id = d.id
                WHERE c.id = %s
                """,
                (cid,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({"error": "Consultation not found"}), 404
            if (
                request.current_user.get("role") == "patient"
                and row.get("patient_user_id") not in (None, request.current_user["id"])
                and row.get("patient_name") != request.current_user["name"]
            ):
                return jsonify({"error": "Unauthorized"}), 403
            return jsonify({"consultation": _serialize_rows([row])[0]})
        finally:
            if db:
                db.close()

    @app.route("/api/consultations/<int:cid>/start", methods=["POST"])
    @require_roles("admin", "doctor")
    def start_consultation(cid):
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM consultations WHERE id=%s", (cid,))
            consultation = cursor.fetchone()
            if not consultation:
                return jsonify({"error": "Not found"}), 404

            cursor = db.cursor()
            cursor.execute(
                "UPDATE consultations SET status='active', doctor_user_id=%s, started_at=NOW() WHERE id=%s",
                (request.current_user["id"], cid),
            )
            if consultation.get("appointment_id"):
                cursor.execute("UPDATE appointments SET status='active' WHERE id=%s", (consultation["appointment_id"],))
            if consultation.get("doctor_id"):
                cursor.execute("UPDATE doctors SET status='busy' WHERE id=%s", (consultation["doctor_id"],))
            db.commit()
            return jsonify(
                {
                    "message": "Consultation started",
                    "start_url": consultation.get("zoom_start_url"),
                    "join_url": consultation.get("zoom_join_url"),
                    "password": consultation.get("zoom_password"),
                }
            )
        finally:
            if db:
                db.close()

    @app.route("/api/consultations/<int:cid>/end", methods=["POST"])
    @require_roles("admin", "doctor")
    def end_consultation(cid):
        data = request.json or {}
        notes = data.get("notes", "")
        diagnosis = data.get("diagnosis", "")
        prescription = data.get("prescription_issued", "")
        follow_up = data.get("follow_up_date")

        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM consultations WHERE id=%s", (cid,))
            consultation = cursor.fetchone()
            if not consultation:
                return jsonify({"error": "Not found"}), 404

            duration = None
            if consultation.get("started_at"):
                duration = int((datetime.datetime.now() - consultation["started_at"]).total_seconds() / 60)

            cursor = db.cursor()
            cursor.execute(
                """
                UPDATE consultations
                SET status='completed', ended_at=NOW(),
                    duration_minutes=%s, notes=%s, diagnosis=%s,
                    prescription_issued=%s, follow_up_date=%s
                WHERE id=%s
                """,
                (duration, notes, diagnosis, prescription, follow_up, cid),
            )
            if consultation.get("appointment_id"):
                cursor.execute("UPDATE appointments SET status='completed' WHERE id=%s", (consultation["appointment_id"],))
            if consultation.get("doctor_id"):
                cursor.execute("UPDATE doctors SET status='available' WHERE id=%s", (consultation["doctor_id"],))
            db.commit()
            return jsonify({"message": "Consultation ended", "duration_minutes": duration})
        finally:
            if db:
                db.close()

    @app.route("/api/consultations/<int:cid>/cancel", methods=["POST"])
    @require_roles("admin", "doctor", "patient")
    def cancel_consultation(cid):
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM consultations WHERE id=%s", (cid,))
            consultation = cursor.fetchone()
            if not consultation:
                return jsonify({"error": "Not found"}), 404
            if (
                request.current_user.get("role") == "patient"
                and consultation.get("patient_user_id") not in (None, request.current_user["id"])
                and consultation.get("patient_name") != request.current_user["name"]
            ):
                return jsonify({"error": "Unauthorized"}), 403

            cursor = db.cursor()
            cursor.execute("UPDATE consultations SET status='cancelled' WHERE id=%s", (cid,))
            if consultation.get("appointment_id"):
                cursor.execute("UPDATE appointments SET status='cancelled' WHERE id=%s", (consultation["appointment_id"],))
            if consultation.get("doctor_id"):
                cursor.execute(
                    "UPDATE doctors SET status='available' WHERE id=%s AND status='busy'",
                    (consultation["doctor_id"],),
                )
            db.commit()
            _delete_zoom_meeting(consultation.get("zoom_meeting_id", ""))
            return jsonify({"message": "Consultation cancelled"})
        finally:
            if db:
                db.close()

    @app.route("/api/consultations/stats", methods=["GET"])
    @require_roles("admin", "doctor", "patient")
    def consultation_stats():
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT
                    COUNT(*) as total,
                    SUM(status='completed') as completed,
                    SUM(status='scheduled') as scheduled,
                    SUM(status='active') as active,
                    SUM(status='cancelled') as cancelled,
                    SUM(link_status='pending') as pending_links,
                    ROUND(AVG(CASE WHEN status='completed' THEN duration_minutes END),1) as avg_duration
                FROM consultations
                """
            )
            stats = cursor.fetchone()

            cursor.execute(
                """
                SELECT specialty, COUNT(*) as count
                FROM consultations GROUP BY specialty ORDER BY count DESC LIMIT 6
                """
            )
            by_specialty = cursor.fetchall()

            cursor.execute(
                """
                SELECT DATE_FORMAT(scheduled_at,'%b %d') as day, COUNT(*) as count
                FROM consultations
                WHERE scheduled_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(scheduled_at) ORDER BY DATE(scheduled_at)
                """
            )
            daily_trend = cursor.fetchall()
            return jsonify({"stats": stats, "by_specialty": by_specialty, "daily_trend": daily_trend})
        finally:
            if db:
                db.close()

    @app.route("/api/consultations/join/<meeting_id>", methods=["GET"])
    @require_roles("admin", "doctor", "patient")
    def join_by_meeting_id(meeting_id):
        db = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT id, patient_user_id, patient_name, doctor_name, zoom_join_url,
                       zoom_password, link_status, status, scheduled_at
                FROM consultations
                WHERE zoom_meeting_id=%s
                """,
                (meeting_id,),
            )
            consultation = cursor.fetchone()
            if not consultation:
                return jsonify({"error": "Meeting not found"}), 404
            if (
                request.current_user.get("role") == "patient"
                and consultation.get("patient_user_id") not in (None, request.current_user["id"])
                and consultation.get("patient_name") != request.current_user["name"]
            ):
                return jsonify({"error": "Unauthorized"}), 403
            return jsonify({"consultation": _serialize_rows([consultation])[0]})
        finally:
            if db:
                db.close()
