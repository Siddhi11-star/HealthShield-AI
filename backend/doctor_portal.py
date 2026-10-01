"""
doctor_portal.py  –  MediGuard AI
Doctor self-registration, appointment management, fee charging, and notifications.
Register with:  from doctor_portal import register_doctor_portal; register_doctor_portal(app)
"""
import json
import datetime
from flask import request, jsonify
from config import get_db
from auth_utils import require_roles


def _serialize(val):
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.isoformat()
    return val


def _row(row):
    return {k: _serialize(v) for k, v in row.items()} if row else None


def _send_notification(user_id, type_, title, message, data=None):
    """Insert a single notification for a specific user."""
    db = None
    try:
        db = get_db()
        c = db.cursor()
        c.execute(
            "INSERT INTO notifications (user_id, type, title, message, data) VALUES (%s,%s,%s,%s,%s)",
            (user_id, type_, title, message, json.dumps(data) if data else None),
        )
        db.commit()
    except Exception as e:
        print(f"[notify] error: {e}")
    finally:
        if db:
            db.close()


def register_doctor_portal(app):

    # ── Ensure doctors.user_id column exists ─────────────────────
    try:
        db = get_db()
        c = db.cursor()
        c.execute("SHOW COLUMNS FROM doctors LIKE 'user_id'")
        if not c.fetchone():
            c.execute("ALTER TABLE doctors ADD COLUMN user_id INT DEFAULT NULL UNIQUE")
            db.commit()
        c.execute("SHOW COLUMNS FROM doctors LIKE 'bio'")
        if not c.fetchone():
            c.execute("ALTER TABLE doctors ADD COLUMN bio TEXT DEFAULT NULL")
            db.commit()
        c.execute("SHOW COLUMNS FROM appointments LIKE 'fee_charged'")
        if not c.fetchone():
            c.execute("ALTER TABLE appointments ADD COLUMN fee_charged DECIMAL(10,2) DEFAULT NULL")
            db.commit()
        c.execute("SHOW COLUMNS FROM appointments LIKE 'fee_status'")
        if not c.fetchone():
            c.execute("ALTER TABLE appointments ADD COLUMN fee_status VARCHAR(30) DEFAULT 'pending'")
            db.commit()
        c.execute("""
            CREATE TABLE IF NOT EXISTS doctor_agenda (
                id INT AUTO_INCREMENT PRIMARY KEY,
                doctor_user_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                note TEXT,
                scheduled_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS doctor_tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                doctor_user_id INT NOT NULL,
                text VARCHAR(255) NOT NULL,
                assignee VARCHAR(100),
                done TINYINT(1) DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.commit()
        db.close()
    except Exception as e:
        print(f"[doctor_portal] migration: {e}")

    # ─────────────────────────────────────────────────────────────
    # DOCTOR PROFILE
    # ─────────────────────────────────────────────────────────────

    @app.route("/api/doctors/me", methods=["GET"])
    @require_roles("doctor")
    def get_my_doctor_profile():
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT * FROM doctors WHERE user_id=%s", (request.current_user["id"],))
            doc = c.fetchone()
            if not doc:
                return jsonify({"registered": False, "profile": None})
            return jsonify({"registered": True, "profile": _row(doc)})
        finally:
            db.close()

    @app.route("/api/doctors/register", methods=["POST"])
    @require_roles("doctor")
    def register_as_doctor():
        """Doctor self-registration — links their user account to a doctors row."""
        body = request.json or {}
        user = request.current_user
        db = get_db()
        try:
            c = db.cursor(dictionary=True)

            # Check if already registered
            c.execute("SELECT id FROM doctors WHERE user_id=%s", (user["id"],))
            existing = c.fetchone()
            if existing:
                return jsonify({"error": "Already registered as a doctor"}), 409

            # Also check by email in case they were pre-seeded
            c.execute("SELECT id FROM doctors WHERE email=%s", (user.get("email", ""),))
            pre_seeded = c.fetchone()

            name          = body.get("name", "").strip() or user.get("name", "")
            specialty     = body.get("specialty", "General Physician").strip()
            qualification = body.get("qualification", "").strip()
            experience    = int(body.get("experience_yrs", 0))
            phone         = body.get("phone", "").strip()
            email         = user.get("email", "") or body.get("email", "")
            fee           = float(body.get("consult_fee", 300.0))
            bio           = body.get("bio", "").strip()
            zoom_user_id  = body.get("zoom_user_id", "").strip()
            initials      = "".join(w[0].upper() for w in name.split()[:2]) or "DR"
            colors        = [
                "linear-gradient(135deg,#3b82f6,#2563eb)",
                "linear-gradient(135deg,#22c55e,#16a34a)",
                "linear-gradient(135deg,#a855f7,#9333ea)",
                "linear-gradient(135deg,#f97316,#ea580c)",
                "linear-gradient(135deg,#06b6d4,#0891b2)",
                "linear-gradient(135deg,#ec4899,#db2777)",
            ]
            color = colors[user["id"] % len(colors)]

            wc = db.cursor()
            if pre_seeded:
                # Update the pre-seeded row
                wc.execute(
                    """UPDATE doctors SET user_id=%s, name=%s, specialty=%s, qualification=%s,
                       experience_yrs=%s, phone=%s, email=%s, avatar_initials=%s,
                       avatar_color=%s, consult_fee=%s, bio=%s, zoom_user_id=%s
                       WHERE id=%s""",
                    (user["id"], name, specialty, qualification, experience, phone, email,
                     initials, color, fee, bio, zoom_user_id, pre_seeded["id"]),
                )
                doctor_id = pre_seeded["id"]
            else:
                wc.execute(
                    """INSERT INTO doctors
                       (user_id, name, specialty, qualification, experience_yrs, phone,
                        email, avatar_initials, avatar_color, status, rating, consult_fee, bio, zoom_user_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'available',4.50,%s,%s,%s)""",
                    (user["id"], name, specialty, qualification, experience, phone,
                     email, initials, color, fee, bio, zoom_user_id),
                )
                doctor_id = wc.lastrowid
            db.commit()

            # Fetch fresh profile
            c.execute("SELECT * FROM doctors WHERE id=%s", (doctor_id,))
            return jsonify({"registered": True, "profile": _row(c.fetchone())}), 201
        finally:
            db.close()

    @app.route("/api/doctors/<int:did>/profile", methods=["PATCH"])
    @require_roles("doctor")
    def update_doctor_profile(did):
        """Doctor updates their own profile."""
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT id FROM doctors WHERE id=%s AND user_id=%s", (did, request.current_user["id"]))
            if not c.fetchone():
                return jsonify({"error": "Not found or unauthorized"}), 403
            body = request.json or {}
            allowed = ["specialty", "qualification", "experience_yrs", "phone",
                       "consult_fee", "bio", "zoom_user_id", "status"]
            sets = ", ".join(f"{k}=%s" for k in allowed if k in body)
            vals = [body[k] for k in allowed if k in body] + [did]
            if sets:
                db.cursor().execute(f"UPDATE doctors SET {sets} WHERE id=%s", vals)
                db.commit()
            c.execute("SELECT * FROM doctors WHERE id=%s", (did,))
            return jsonify({"profile": _row(c.fetchone())})
        finally:
            db.close()

    # ─────────────────────────────────────────────────────────────
    # APPOINTMENT MANAGEMENT (DOCTOR)
    # ─────────────────────────────────────────────────────────────

    @app.route("/api/appointments/my", methods=["GET"])
    @require_roles("doctor")
    def get_my_doctor_appointments():
        """Get all appointments assigned to the logged-in doctor."""
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            # Find doctor record for this user
            c.execute("SELECT id FROM doctors WHERE user_id=%s", (request.current_user["id"],))
            doc = c.fetchone()
            if not doc:
                return jsonify({"appointments": []})

            c.execute(
                """SELECT a.*, d.name as doctor_display_name
                   FROM appointments a
                   LEFT JOIN doctors d ON d.id = a.doctor_id
                   WHERE a.doctor_user_id=%s OR a.doctor_id=%s
                   ORDER BY COALESCE(a.scheduled_at, a.created_at) DESC LIMIT 100""",
                (request.current_user["id"], doc["id"]),
            )
            rows = c.fetchall()
            for r in rows:
                for k in ["created_at", "scheduled_at", "preferred_date"]:
                    r[k] = _serialize(r.get(k))
            return jsonify({"appointments": rows})
        finally:
            db.close()

    @app.route("/api/appointments/<int:aid>/confirm", methods=["PATCH"])
    @require_roles("doctor", "admin")
    def doctor_confirm_appointment(aid):
        """Doctor confirms or rejects an appointment."""
        body   = request.json or {}
        action = body.get("action", "confirm")   # "confirm" | "reject"
        notes  = body.get("notes", "")
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT * FROM appointments WHERE id=%s", (aid,))
            apt = c.fetchone()
            if not apt:
                return jsonify({"error": "Appointment not found"}), 404

            # Auth check: only the assigned doctor (or admin) can confirm
            if request.current_user["role"] == "doctor":
                c.execute("SELECT id FROM doctors WHERE user_id=%s", (request.current_user["id"],))
                doc = c.fetchone()
                if not doc or (apt.get("doctor_id") and apt["doctor_id"] != doc["id"]):
                    return jsonify({"error": "Unauthorized"}), 403

            new_status = "confirmed" if action == "confirm" else "cancelled"
            wc = db.cursor()
            wc.execute("UPDATE appointments SET status=%s WHERE id=%s", (new_status, aid))
            db.commit()

            # Notify the patient
            if apt.get("patient_user_id"):
                if action == "confirm":
                    meeting_info = ""
                    if apt.get("zoom_join_url"):
                        meeting_info = f" Your Zoom link is ready."
                    _send_notification(
                        apt["patient_user_id"],
                        "appointment",
                        "✅ Appointment Confirmed!",
                        f"Your appointment for {apt.get('specialty','Consultation')} on "
                        f"{str(apt.get('preferred_date',''))[:10]} has been confirmed.{meeting_info}",
                        {"appointment_id": aid, "zoom_join_url": apt.get("zoom_join_url")},
                    )
                else:
                    _send_notification(
                        apt["patient_user_id"],
                        "appointment",
                        "❌ Appointment Cancelled",
                        f"Your appointment for {apt.get('specialty','Consultation')} on "
                        f"{str(apt.get('preferred_date',''))[:10]} was cancelled. Please rebook.",
                        {"appointment_id": aid},
                    )

            return jsonify({"message": f"Appointment {new_status}", "status": new_status})
        finally:
            db.close()

    @app.route("/api/appointments/<int:aid>/charge", methods=["POST"])
    @require_roles("doctor")
    def doctor_charge_fee(aid):
        """Doctor marks consultation fee as charged."""
        body = request.json or {}
        fee  = float(body.get("fee", 0))
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT * FROM appointments WHERE id=%s", (aid,))
            apt = c.fetchone()
            if not apt:
                return jsonify({"error": "Appointment not found"}), 404

            wc = db.cursor()
            wc.execute(
                "UPDATE appointments SET fee_charged=%s, fee_status='charged' WHERE id=%s",
                (fee, aid),
            )
            db.commit()

            # Notify patient of fee
            if apt.get("patient_user_id"):
                _send_notification(
                    apt["patient_user_id"],
                    "billing",
                    "💳 Consultation Fee",
                    f"A fee of ₹{fee:.0f} has been charged for your {apt.get('specialty','Consultation')} consultation.",
                    {"appointment_id": aid, "fee": fee},
                )

            return jsonify({"message": "Fee charged", "fee": fee})
        finally:
            db.close()

    # ─────────────────────────────────────────────────────────────
    # PATIENT: BOOK WITH SPECIFIC DOCTOR
    # ─────────────────────────────────────────────────────────────

    @app.route("/api/appointments/book-with-doctor", methods=["POST"])
    @require_roles("patient")
    def book_with_doctor():
        """Patient books a consultation with a specific doctor."""
        import datetime as dt
        body       = request.json or {}
        doctor_id  = body.get("doctor_id")
        if not doctor_id:
            return jsonify({"error": "doctor_id is required"}), 400

        db = get_db()
        try:
            c = db.cursor(dictionary=True)

            # Fetch doctor info
            c.execute("SELECT * FROM doctors WHERE id=%s AND status != 'offline'", (doctor_id,))
            doc = c.fetchone()
            if not doc:
                return jsonify({"error": "Doctor not found or not available"}), 404

            patient_name = body.get("patient_name") or request.current_user.get("name", "Patient")
            mode         = body.get("mode", "video")
            preferred_date = body.get("preferred_date")
            time_slot      = body.get("time_slot", "10:00 AM – 11:00 AM")
            symptoms       = body.get("symptoms", "")
            age            = body.get("age")
            gender         = body.get("gender", "")

            # Parse scheduled datetime
            scheduled_time = None
            if preferred_date:
                try:
                    slot_hour = int(time_slot.split(":")[0]) if time_slot else 10
                    scheduled_time = dt.datetime.strptime(preferred_date, "%Y-%m-%d").replace(hour=slot_hour)
                except Exception:
                    pass
            if not scheduled_time:
                scheduled_time = dt.datetime.now() + dt.timedelta(hours=1)

            wc = db.cursor()
            wc.execute(
                """INSERT INTO appointments
                   (patient_user_id, doctor_id, doctor_user_id, doctor_name, patient_name,
                    age, gender, specialty, preferred_date, time_slot, scheduled_at,
                    symptoms, mode, status, link_status)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    request.current_user["id"],
                    doc["id"],
                    doc.get("user_id"),
                    doc["name"],
                    patient_name,
                    age,
                    gender,
                    doc["specialty"],
                    preferred_date,
                    time_slot,
                    scheduled_time,
                    symptoms,
                    mode,
                    "pending",
                    "pending" if mode == "video" else "not_required",
                ),
            )
            appointment_id = wc.lastrowid
            db.commit()

            zoom_data = None
            # Create Zoom meeting for video mode
            if mode == "video":
                try:
                    from teleconsult_v2 import _create_zoom_meeting
                    topic   = f"MediGuard: {patient_name} with {doc['name']}"
                    meeting = _create_zoom_meeting(topic, scheduled_time, duration=30)
                    if not meeting.get("error"):
                        wc.execute(
                            """UPDATE appointments SET status='pending', zoom_meeting_id=%s,
                               zoom_join_url=%s, zoom_start_url=%s, zoom_password=%s, link_status='generated'
                               WHERE id=%s""",
                            (meeting["meeting_id"], meeting["join_url"],
                             meeting["start_url"], meeting["password"], appointment_id),
                        )
                        db.commit()
                        zoom_data = {
                            "meeting_id":  meeting["meeting_id"],
                            "join_url":    meeting["join_url"],
                            "start_url":   meeting["start_url"],
                            "password":    meeting["password"],
                        }
                except Exception as e:
                    print(f"[zoom] {e}")

            # Notify the specific doctor
            if doc.get("user_id"):
                mode_label = {"video": "📹 Video Call", "audio": "📞 Audio Call", "chat": "💬 Chat"}.get(mode, mode)
                _send_notification(
                    doc["user_id"],
                    "appointment",
                    f"📅 New Appointment from {patient_name}",
                    f"{patient_name} has booked a {mode_label} appointment with you "
                    f"on {str(preferred_date)[:10]} ({time_slot}). Specialty: {doc['specialty']}.",
                    {
                        "appointment_id": appointment_id,
                        "patient_name":   patient_name,
                        "specialty":      doc["specialty"],
                        "mode":           mode,
                        "scheduled_time": scheduled_time.isoformat(),
                        "start_url":      zoom_data.get("start_url") if zoom_data else None,
                    },
                )

            return jsonify({
                "message":      "Appointment booked",
                "id":           appointment_id,
                "status":       "pending",
                "doctor_name":  doc["name"],
                "scheduled_at": scheduled_time.isoformat(),
                "zoom":         zoom_data,
            }), 201
        finally:
            db.close()

    # ─────────────────────────────────────────────────────────────
    # NOTIFICATIONS: unread count (for bell badge)
    # ─────────────────────────────────────────────────────────────

    @app.route("/api/notifications/unread-count", methods=["GET"])
    @require_roles("admin", "doctor", "patient")
    def get_unread_count():
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute(
                "SELECT COUNT(*) as cnt FROM notifications WHERE user_id=%s AND is_read=0",
                (request.current_user["id"],),
            )
            row = c.fetchone()
            return jsonify({"unread": row["cnt"] if row else 0})
        finally:
            db.close()

    @app.route("/api/notifications/mark-all-read", methods=["PATCH"])
    @require_roles("admin", "doctor", "patient")
    def mark_all_notifications_read():
        db = get_db()
        try:
            c = db.cursor()
            c.execute(
                "UPDATE notifications SET is_read=1 WHERE user_id=%s",
                (request.current_user["id"],),
            )
            db.commit()
            return jsonify({"message": "All notifications marked as read"})
        finally:
            db.close()

    # ─────────────────────────────────────────────────────────────
    # DOCTOR AGENDA, TASKS, PATIENTS & TIMELINE
    # ─────────────────────────────────────────────────────────────

    @app.route("/api/doctors/agenda/today", methods=["GET"])
    @require_roles("doctor")
    def doctor_today_agenda():
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("""
                SELECT * FROM doctor_agenda 
                WHERE doctor_user_id=%s AND (scheduled_at IS NULL OR DATE(scheduled_at)=CURDATE())
                ORDER BY scheduled_at ASC
            """, (request.current_user["id"],))
            items = c.fetchall() or []
            return jsonify({"agenda": items})
        finally:
            db.close()

    @app.route("/api/doctors/agenda", methods=["GET", "POST"])
    @require_roles("doctor")
    def doctor_agenda():
        if request.method == "GET":
            db = get_db()
            try:
                c = db.cursor(dictionary=True)
                c.execute("SELECT * FROM doctor_agenda WHERE doctor_user_id=%s ORDER BY scheduled_at ASC", (request.current_user["id"],))
                items = c.fetchall() or []
                return jsonify({"agenda": items})
            finally:
                db.close()
        else:
            body = request.json or {}
            title = body.get("title")
            note = body.get("note")
            scheduled = body.get("scheduled_at")
            if not title:
                return jsonify({"error": "title required"}), 400
            db = get_db()
            try:
                c = db.cursor()
                c.execute(
                    "INSERT INTO doctor_agenda (doctor_user_id, title, note, scheduled_at) VALUES (%s,%s,%s,%s)",
                    (request.current_user["id"], title, note, scheduled)
                )
                db.commit()
                aid = c.lastrowid
                return jsonify({"id": aid, "title": title, "note": note, "scheduled_at": scheduled}), 201
            finally:
                db.close()

    @app.route("/api/doctors/agenda/<int:aid>", methods=["DELETE"])
    @require_roles("doctor")
    def doctor_delete_agenda(aid):
        db = get_db()
        try:
            c = db.cursor()
            c.execute("DELETE FROM doctor_agenda WHERE id=%s AND doctor_user_id=%s", (aid, request.current_user["id"]))
            db.commit()
            return jsonify({"deleted": True})
        finally:
            db.close()

    @app.route("/api/doctors/urgent-alerts", methods=["GET"])
    @require_roles("doctor")
    def doctor_urgent_alerts():
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            query = """
                SELECT hm.*
                FROM health_metrics hm
                JOIN (
                    SELECT patient_user_id, MAX(recorded_at) as latest_at
                    FROM health_metrics
                    GROUP BY patient_user_id
                ) latest ON latest.patient_user_id = hm.patient_user_id AND latest.latest_at = hm.recorded_at
                WHERE (hm.bp_systolic > 140 OR hm.bp_diastolic > 90 OR hm.heart_rate > 120 OR hm.spo2 < 90)
                ORDER BY hm.recorded_at DESC
                LIMIT 100
            """
            c.execute(query)
            alerts = c.fetchall() or []
            return jsonify({"alerts": alerts})
        finally:
            db.close()

    @app.route("/api/patients/me/metrics/latest", methods=["GET"])
    @require_roles("doctor", "patient")
    def patient_latest_metrics():
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT * FROM health_metrics WHERE patient_user_id=%s ORDER BY recorded_at DESC LIMIT 1", (request.current_user["id"],))
            row = c.fetchone()
            return jsonify({"latest": row})
        finally:
            db.close()

    @app.route("/api/doctors/patients", methods=["GET", "POST"])
    @require_roles("doctor")
    def doctor_patients():
        if request.method == "GET":
            db = get_db()
            try:
                c = db.cursor(dictionary=True)
                c.execute("SELECT id,name,age,gender,phone,known_allergies,current_medications,created_at FROM patients ORDER BY created_at DESC LIMIT 500")
                rows = c.fetchall() or []
                return jsonify({"patients": rows})
            finally:
                db.close()
        else:
            body = request.json or {}
            name = (body.get("name") or "").strip()
            age = body.get("age")
            gender = body.get("gender") or "Male"
            phone = body.get("phone") or ""
            meds = body.get("current_medications") or ""
            allergies = body.get("known_allergies") or ""
            if not name:
                return jsonify({"error": "name required"}), 400
            db = get_db()
            try:
                c = db.cursor()
                c.execute(
                    "INSERT INTO patients (name,age,gender,phone,current_medications,known_allergies) VALUES (%s,%s,%s,%s,%s,%s)",
                    (name, age, gender, phone, meds, allergies)
                )
                db.commit()
                pid = c.lastrowid
                return jsonify({"id": pid, "name": name}), 201
            finally:
                db.close()

    @app.route("/api/doctors/patients/<int:pid>", methods=["DELETE"])
    @require_roles("doctor")
    def doctor_delete_patient(pid):
        db = get_db()
        try:
            c = db.cursor()
            c.execute("DELETE FROM patients WHERE id=%s", (pid,))
            db.commit()
            return jsonify({"deleted": True})
        finally:
            db.close()

    @app.route("/api/doctors/tasks", methods=["GET", "POST"])
    @require_roles("doctor")
    def doctor_tasks():
        if request.method == "GET":
            db = get_db()
            try:
                c = db.cursor(dictionary=True)
                c.execute("SELECT * FROM doctor_tasks WHERE doctor_user_id=%s ORDER BY created_at DESC", (request.current_user["id"],))
                rows = c.fetchall() or []
                return jsonify({"tasks": rows})
            finally:
                db.close()
        else:
            body = request.json or {}
            text = (body.get("text") or "").strip()
            assignee = (body.get("assignee") or "").strip()
            if not text:
                return jsonify({"error": "text required"}), 400
            db = get_db()
            try:
                c = db.cursor()
                c.execute(
                    "INSERT INTO doctor_tasks (doctor_user_id,text,assignee,done) VALUES (%s,%s,%s,0)",
                    (request.current_user["id"], text, assignee)
                )
                db.commit()
                return jsonify({"id": c.lastrowid, "text": text, "assignee": assignee}), 201
            finally:
                db.close()

    @app.route("/api/doctors/tasks/<int:tid>", methods=["PUT", "DELETE"])
    @require_roles("doctor")
    def doctor_task_detail(tid):
        if request.method == "DELETE":
            db = get_db()
            try:
                c = db.cursor()
                c.execute("DELETE FROM doctor_tasks WHERE id=%s", (tid,))
                db.commit()
                return jsonify({"deleted": True})
            finally:
                db.close()
        else:
            body = request.json or {}
            assignee = body.get("assignee")
            done = body.get("done")
            sets, vals = [], []
            if assignee is not None:
                sets.append("assignee=%s")
                vals.append(assignee)
            if done is not None:
                sets.append("done=%s")
                vals.append(1 if done else 0)
            if not sets:
                return jsonify({"error": "no fields"}), 400
            vals.append(tid)
            db = get_db()
            try:
                c = db.cursor()
                c.execute(f"UPDATE doctor_tasks SET {','.join(sets)} WHERE id=%s", tuple(vals))
                db.commit()
                return jsonify({"updated": True})
            finally:
                db.close()

    @app.route("/api/notifications", methods=["GET"])
    def list_notifications():
        uid = request.args.get("user_id")
        if not uid:
            try:
                uid = request.current_user["id"]
            except Exception:
                return jsonify({"notifications": []})
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            c.execute("SELECT * FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 200", (uid,))
            rows = c.fetchall() or []
            return jsonify({"notifications": rows})
        finally:
            db.close()

    @app.route("/api/notifications/<int:nid>/read", methods=["POST", "PATCH"])
    def mark_notification_read_doctor(nid):
        db = get_db()
        try:
            c = db.cursor()
            c.execute("UPDATE notifications SET is_read=1 WHERE id=%s", (nid,))
            db.commit()
            return jsonify({"marked": True})
        finally:
            db.close()

    @app.route("/api/patients/me/timeline", methods=["GET"])
    def patient_care_timeline():
        db = get_db()
        try:
            c = db.cursor(dictionary=True)
            uid = request.current_user["id"]
            c.execute("SELECT id, file_name, file_type, uploaded_at as ts, 'report' as type FROM medical_reports WHERE patient_id=%s", (uid,))
            reports = c.fetchall() or []
            c.execute("SELECT id, medicine_name, created_at as ts, 'prescription' as type FROM prescriptions WHERE patient_id=%s", (uid,))
            prescriptions = c.fetchall() or []
            timeline = (reports or []) + (prescriptions or [])
            for item in timeline:
                item["ts"] = _serialize(item.get("ts"))
            timeline.sort(key=lambda x: x.get("ts") or "")
            return jsonify({"timeline": timeline})
        finally:
            db.close()

