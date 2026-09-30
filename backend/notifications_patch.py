"""
notifications_patch.py  –  MediGuard AI
Drop-in replacement for the get_notifications() route in app.py

HOW TO USE:
  Replace the entire @app.route("/api/notifications") function in app.py
  with the function below.  Everything else in app.py stays the same.
"""


def get_notifications_v2(get_db, get_token_user, request, jsonify, ensure_tables):
    """
    Full role-aware notification engine.

    Role       | Notifications received
    -----------|----------------------------------------------
    doctor     | Upcoming appointments + new booking alerts + AI safety alerts
    patient    | Their appointment status updates + safety alerts for their Rx
    pharmacist | Low-stock & out-of-stock alerts from pharmacy_inventory + medicines
    admin      | Everything above (summary view)
    (guest)    | Generic low-stock from medicines table only
    """
    try:
        db = get_db()
        ensure_tables(db)
        cursor = db.cursor(dictionary=True)
        notifications = []
        user_id = get_token_user(request)
        current_user = None

        if user_id:
            cursor.execute("SELECT id, name, role FROM users WHERE id=%s", (user_id,))
            current_user = cursor.fetchone()

        role = (current_user or {}).get("role", "")

        # ── PHARMACIST ─────────────────────────────────────────
        if role == "pharmacist":
            # 1. Out-of-stock from live pharmacy_inventory
            try:
                cursor.execute("""
                    SELECT pi.id, pi.medicine_name, pi.quantity, ph.name AS pharmacy_name
                    FROM pharmacy_inventory pi
                    JOIN pharmacies ph ON pi.pharmacy_id = ph.id
                    WHERE pi.quantity = 0
                    ORDER BY pi.last_updated DESC
                    LIMIT 8
                """)
                for item in cursor.fetchall():
                    notifications.append({
                        "id":      f"oos_inv_{item['id']}",
                        "type":    "stock_alert",
                        "level":   "critical",
                        "title":   "⚠️ Out of Stock",
                        "message": f"{item['medicine_name']} is completely out of stock at {item['pharmacy_name']}.",
                        "icon":    "package-x",
                        "action":  "manage_inventory",
                    })
            except Exception:
                pass

            # 2. Low-stock from live pharmacy_inventory
            try:
                cursor.execute("""
                    SELECT pi.id, pi.medicine_name, pi.quantity, ph.name AS pharmacy_name
                    FROM pharmacy_inventory pi
                    JOIN pharmacies ph ON pi.pharmacy_id = ph.id
                    WHERE pi.quantity > 0 AND pi.quantity <= 20
                    ORDER BY pi.quantity ASC
                    LIMIT 10
                """)
                for item in cursor.fetchall():
                    notifications.append({
                        "id":      f"low_inv_{item['id']}",
                        "type":    "low_stock",
                        "level":   "warning",
                        "title":   "📦 Low Stock Alert",
                        "message": f"{item['medicine_name']} — only {item['quantity']} units left at {item['pharmacy_name']}.",
                        "icon":    "package",
                        "action":  "restock",
                    })
            except Exception:
                pass

            # 3. Low-stock from main medicines table
            try:
                cursor.execute("""
                    SELECT id, name, quantity, min_stock_level
                    FROM medicines
                    WHERE quantity <= min_stock_level AND quantity > 0
                    ORDER BY quantity ASC LIMIT 5
                """)
                for m in cursor.fetchall():
                    notifications.append({
                        "id":      f"low_med_{m['id']}",
                        "type":    "low_stock",
                        "level":   "warning",
                        "title":   "📦 Central Stock Low",
                        "message": f"{m['name']} has {m['quantity']} units left (minimum: {m['min_stock_level']}).",
                        "icon":    "package",
                    })
            except Exception:
                pass

        # ── DOCTOR ─────────────────────────────────────────────
        if role == "doctor":
            # 1. Pending appointments needing attention
            try:
                cursor.execute("""
                    SELECT id, patient_name, specialty, preferred_date, time_slot, status
                    FROM appointments
                    WHERE status = 'pending' AND preferred_date >= CURDATE()
                    ORDER BY preferred_date ASC, time_slot ASC
                    LIMIT 5
                """)
                for appt in cursor.fetchall():
                    notifications.append({
                        "id":      f"doc_pending_{appt['id']}",
                        "type":    "appointment_pending",
                        "level":   "warning",
                        "title":   "🗓 New Appointment Request",
                        "message": f"{appt['patient_name']} requested {appt['specialty']} on {appt['preferred_date']} at {appt['time_slot']}. Action needed.",
                        "icon":    "calendar-clock",
                    })
            except Exception:
                pass

            # 2. Upcoming confirmed appointments today
            try:
                cursor.execute("""
                    SELECT id, patient_name, specialty, preferred_date, time_slot
                    FROM appointments
                    WHERE preferred_date = CURDATE() AND status IN ('confirmed','scheduled')
                    ORDER BY time_slot ASC LIMIT 6
                """)
                for appt in cursor.fetchall():
                    notifications.append({
                        "id":      f"doc_today_{appt['id']}",
                        "type":    "appointment_today",
                        "level":   "info",
                        "title":   "📅 Today's Consultation",
                        "message": f"{appt['patient_name']} — {appt['specialty']} at {appt['time_slot']}.",
                        "icon":    "calendar-check",
                    })
            except Exception:
                pass

            # 3. Unresolved drug-interaction safety alerts
            try:
                cursor.execute("""
                    SELECT sal.*, p.name AS patient_name
                    FROM safety_alerts_log sal
                    LEFT JOIN patients p ON sal.patient_id = p.id
                    WHERE sal.resolved = 0
                    ORDER BY sal.created_at DESC LIMIT 5
                """)
                for a in cursor.fetchall():
                    sev = (a.get("severity") or "moderate").lower()
                    notifications.append({
                        "id":      f"safety_{a['id']}",
                        "type":    "interaction_risk",
                        "level":   "critical" if sev == "critical" else "warning",
                        "title":   f"🛡 AI Safety Alert – {sev.title()} Risk",
                        "message": f"{a['drug_a']} + {a['drug_b']} interaction detected"
                                   + (f" for {a['patient_name']}." if a.get("patient_name") else "."),
                        "icon":    "shield-alert",
                    })
            except Exception:
                pass

        # ── PATIENT ────────────────────────────────────────────
        if role == "patient" and current_user:
            # 1. Their appointment status updates
            try:
                cursor.execute("""
                    SELECT id, specialty, preferred_date, time_slot, status, created_at
                    FROM appointments
                    WHERE patient_name = %s
                    ORDER BY created_at DESC LIMIT 8
                """, (current_user["name"],))
                for appt in cursor.fetchall():
                    icon_map  = {"confirmed": "calendar-check", "pending": "clock", "cancelled": "x-circle", "completed": "check-circle"}
                    level_map = {"confirmed": "success",        "pending": "info",  "cancelled": "warning",  "completed": "info"}
                    s = appt["status"] or "pending"
                    notifications.append({
                        "id":      f"pat_appt_{appt['id']}",
                        "type":    "appointment_update",
                        "level":   level_map.get(s, "info"),
                        "title":   f"Appointment {s.title()}",
                        "message": f"Your {appt['specialty']} appointment on {appt['preferred_date']} at {appt['time_slot']} is {s}.",
                        "icon":    icon_map.get(s, "calendar"),
                    })
            except Exception:
                pass

            # 2. Safety alerts relevant to the patient's prescriptions
            try:
                cursor.execute("""
                    SELECT p.id AS patient_id FROM patients WHERE name = %s LIMIT 1
                """, (current_user["name"],))
                pat = cursor.fetchone()
                if pat:
                    cursor.execute("""
                        SELECT sal.drug_a, sal.drug_b, sal.effect, sal.severity
                        FROM safety_alerts_log sal
                        WHERE sal.patient_id = %s AND sal.resolved = 0
                        ORDER BY sal.created_at DESC LIMIT 4
                    """, (pat["patient_id"],))
                    for a in cursor.fetchall():
                        notifications.append({
                            "id":      f"pat_risk_{pat['patient_id']}",
                            "type":    "interaction_risk",
                            "level":   "critical",
                            "title":   "⚠️ Medication Safety Alert",
                            "message": f"Risk detected: {a['drug_a']} + {a['drug_b']}. Please consult your doctor.",
                            "icon":    "shield-alert",
                        })
            except Exception:
                pass

        # ── ADMIN ──────────────────────────────────────────────
        if role == "admin":
            # All pending appointments
            try:
                cursor.execute("""
                    SELECT COUNT(*) AS cnt FROM appointments WHERE status='pending'
                """)
                row = cursor.fetchone()
                if row and row["cnt"] > 0:
                    notifications.append({
                        "id":      "admin_pending_apts",
                        "type":    "admin_alert",
                        "level":   "warning",
                        "title":   "📋 Pending Appointments",
                        "message": f"{row['cnt']} appointment(s) are waiting for confirmation.",
                        "icon":    "calendar-clock",
                    })
            except Exception:
                pass

            # Out of stock in main medicines table
            try:
                cursor.execute("""
                    SELECT id, name, quantity FROM medicines
                    WHERE quantity = 0 ORDER BY name ASC LIMIT 8
                """)
                for m in cursor.fetchall():
                    notifications.append({
                        "id":      f"admin_oos_{m['id']}",
                        "type":    "stock_alert",
                        "level":   "critical",
                        "title":   "⚠️ Out of Stock",
                        "message": f"{m['name']} is completely out of stock.",
                        "icon":    "package-x",
                    })
            except Exception:
                pass

            # Unresolved safety alerts
            try:
                cursor.execute("""
                    SELECT COUNT(*) AS cnt FROM safety_alerts_log WHERE resolved=0
                """)
                row = cursor.fetchone()
                if row and row["cnt"] > 0:
                    notifications.append({
                        "id":      "admin_safety_alerts",
                        "type":    "interaction_risk",
                        "level":   "warning",
                        "title":   "🛡 Unresolved Safety Alerts",
                        "message": f"{row['cnt']} drug interaction alert(s) need review.",
                        "icon":    "shield-alert",
                    })
            except Exception:
                pass

        # ── GUEST / FALLBACK ───────────────────────────────────
        if not role or role not in ("doctor", "patient", "pharmacist", "admin"):
            try:
                cursor.execute("""
                    SELECT id, name, quantity, min_stock_level FROM medicines
                    WHERE quantity <= min_stock_level ORDER BY quantity ASC LIMIT 8
                """)
                for m in cursor.fetchall():
                    level = "critical" if m["quantity"] == 0 else "warning"
                    notifications.append({
                        "id":      f"stock_{m['id']}",
                        "type":    "low_stock",
                        "level":   level,
                        "title":   "Out of Stock" if level == "critical" else "Low Stock",
                        "message": f"{m['name']} — {m['quantity']} units remaining.",
                        "icon":    "package",
                    })
            except Exception:
                pass

        notifications = notifications[:15]
        return jsonify({
            "notifications": notifications,
            "count": len(notifications),
            "role": role or "guest",
        })
    finally:
        db.close()