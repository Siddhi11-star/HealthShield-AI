"""
Public emergency quick-access routes.

These endpoints are read-only, do not store personal data, and provide
instant first-aid, hotline, medicine lookup, nearby emergency care,
and lightweight interaction checking.
"""
from __future__ import annotations

import functools
import math
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Blueprint, jsonify, request

from ai_safety_guard import check_drug_interaction, get_ai_suggestions
from config import get_db

emergency_quick_access_bp = Blueprint("emergency_quick_access", __name__)
_EMERGENCY_ROUTES_REGISTERED = False
_RATE_BUCKETS: Dict[str, List[float]] = {}

EMERGENCY_CONTACTS = [
    {
        "name": "Ambulance",
        "phone": "108",
        "priority": 1,
        "description": "Immediate medical transport"
    },
    {
        "name": "Police",
        "phone": "100",
        "priority": 2,
        "description": "Law and rescue support"
    },
    {
        "name": "Fire",
        "phone": "101",
        "priority": 3,
        "description": "Fire and rescue support"
    }
]

FIRST_AID_GUIDES = {
    "burns": {
        "title": "Burns",
        "tips": [
            "Cool the burn under running water for 20 minutes.",
            "Do not apply ice, butter, toothpaste, or oils.",
            "Cover with a clean non-stick dressing.",
            "Seek urgent care for large, deep, or facial burns."
        ]
    },
    "heart attack": {
        "title": "Heart Attack",
        "tips": [
            "Call emergency services immediately.",
            "Keep the person seated and calm.",
            "Give aspirin only if advised and there is no allergy.",
            "Start CPR if the person becomes unresponsive and is not breathing normally."
        ]
    },
    "fainting": {
        "title": "Fainting",
        "tips": [
            "Lay the person flat and raise the legs if safe.",
            "Loosen tight clothing and improve airflow.",
            "Do not give food or drink until fully awake.",
            "Seek help if fainting lasts more than a minute or repeats."
        ]
    },
    "poisoning": {
        "title": "Poisoning",
        "tips": [
            "Call poison control or emergency services immediately.",
            "Do not induce vomiting unless instructed.",
            "Remove the person from the source if it is safe.",
            "Bring the container or label to the hospital."
        ]
    }
}

SYMPTOM_RISK_RULES = [
    ("chest pain", "HIGH", "Chest pain can indicate a heart or lung emergency."),
    ("shortness of breath", "HIGH", "Breathing difficulty needs urgent review."),
    ("fainting", "HIGH", "Fainting with other symptoms can be serious."),
    ("seizure", "HIGH", "Seizures need immediate medical attention."),
    ("poison", "HIGH", "Possible poisoning requires urgent help."),
    ("bleeding", "HIGH", "Uncontrolled bleeding is an emergency."),
    ("stroke", "HIGH", "Sudden weakness or speech trouble may be stroke."),
    ("allergic", "HIGH", "An allergic reaction can escalate quickly."),
    ("rash", "MEDIUM", "New rash may indicate allergy or irritation."),
    ("fever", "MEDIUM", "Fever is usually moderate but watch for escalation."),
    ("nausea", "LOW", "Mild nausea is often lower risk unless severe."),
    ("headache", "LOW", "Headache is usually low risk unless severe or sudden.")
]

FALLBACK_HELP_CENTERS = [
    {
        "name": "City General Hospital",
        "type": "hospital",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "phone": "+91 80 2222 0001"
    },
    {
        "name": "Central Trauma Center",
        "type": "emergency",
        "latitude": 12.9784,
        "longitude": 77.6012,
        "phone": "+91 80 2222 0002"
    },
    {
        "name": "RapidCare Clinic",
        "type": "clinic",
        "latitude": 12.9654,
        "longitude": 77.5855,
        "phone": "+91 80 2222 0003"
    }
]


def _client_key() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.remote_addr or "unknown"
    return f"{ip}:{request.path}"


def emergency_rate_limit(limit: int = 12, window_seconds: int = 60):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            key = _client_key() + ":" + func.__name__
            now = time.monotonic()
            bucket = [stamp for stamp in _RATE_BUCKETS.get(key, []) if now - stamp < window_seconds]
            if len(bucket) >= limit:
                retry_after = max(1, int(window_seconds - (now - bucket[0])))
                return jsonify({"error": "Rate limit exceeded", "retry_after_seconds": retry_after}), 429
            bucket.append(now)
            _RATE_BUCKETS[key] = bucket
            return func(*args, **kwargs)
        return wrapper
    return decorator


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _split_terms(query: str) -> List[str]:
    parts = re.split(r"[,+/;]|\band\b", query or "", flags=re.IGNORECASE)
    return [part.strip() for part in parts if part and part.strip()]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(dlambda / 2) ** 2))
    return radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _safe_phone(value: Any) -> str:
    phone = re.sub(r"[^0-9+]", "", _normalize_text(value))
    return phone[:20] if phone else "N/A"


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _geocode_location(query: str) -> Optional[Tuple[float, float, str]]:
    query = _normalize_text(query)
    if not query:
        return None
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1},
            headers={"User-Agent": "mediguard-emergency-panel/1.0"},
            timeout=5
        )
        response.raise_for_status()
        rows = response.json() or []
        if not rows:
            return None
        row = rows[0]
        return float(row["lat"]), float(row["lon"]), row.get("display_name", query)
    except Exception:
        return None


def _search_medicines_in_db(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        term = f"%{query}%"
        cursor.execute("""
            SELECT id, medicine_name, generic_name, manufacturer, price
            FROM medicines
            WHERE medicine_name LIKE %s OR generic_name LIKE %s
            LIMIT %s
            """, (term, term, limit))
        rows = cursor.fetchall() or []
    except Exception:
        rows = []
    finally:
        cursor.close()
        db.close()

    items = []
    for row in rows:
        items.append({
            "id": row.get("id"),
            "name": row.get("medicine_name") or "Unknown",
            "generic_name": row.get("generic_name") or "",
            "manufacturer": row.get("manufacturer") or "",
            "price": row.get("price")
        })
    return items


def _search_nearby_from_db(lat: float, lon: float, radius_km: float, limit: int = 6) -> List[Dict[str, Any]]:
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute("""
            SELECT name, category, latitude, longitude, phone
            FROM pharmacy_locations
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            LIMIT 200
            """)
        rows = cursor.fetchall() or []
    except Exception:
        rows = []
    finally:
        cursor.close()
        db.close()

    results = []
    for row in rows:
        r_lat = _to_float(row.get("latitude"))
        r_lon = _to_float(row.get("longitude"))
        if r_lat is None or r_lon is None:
            continue
        dist = _haversine_km(lat, lon, r_lat, r_lon)
        if dist <= radius_km:
            results.append({
                "name": row.get("name") or "Help Center",
                "type": row.get("category") or "medical",
                "latitude": r_lat,
                "longitude": r_lon,
                "phone": _safe_phone(row.get("phone")),
                "distance_km": round(dist, 2)
            })

    results.sort(key=lambda x: x["distance_km"])
    return results[:limit]


def _fallback_nearby(lat: float, lon: float, radius_km: float) -> List[Dict[str, Any]]:
    data = []
    for row in FALLBACK_HELP_CENTERS:
        dist = _haversine_km(lat, lon, row["latitude"], row["longitude"])
        if dist <= radius_km:
            data.append({
                "name": row["name"],
                "type": row["type"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "phone": _safe_phone(row.get("phone")),
                "distance_km": round(dist, 2)
            })
    data.sort(key=lambda x: x["distance_km"])
    return data


def _risk_from_symptoms(symptoms: str) -> Tuple[str, List[str]]:
    text = _normalize_text(symptoms).lower()
    if not text:
        return "LOW", ["No symptom details provided."]

    highest = "LOW"
    reasons = []
    rank = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}

    for phrase, risk, reason in SYMPTOM_RISK_RULES:
        if phrase in text:
            reasons.append(reason)
            if rank[risk] > rank[highest]:
                highest = risk

    if not reasons:
        reasons.append("No severe emergency keywords detected.")
    return highest, reasons


def _interaction_summary(medicines: List[str]) -> Dict[str, Any]:
    meds = [m.strip() for m in medicines if m and m.strip()]
    if len(meds) < 2:
        return {"checked": False, "warnings": []}

    warnings = []
    for i in range(len(meds)):
        for j in range(i + 1, len(meds)):
            result = check_drug_interaction(meds[i], meds[j])
            if result and result.get("interaction"):
                warnings.append({
                    "drug_a": meds[i],
                    "drug_b": meds[j],
                    "severity": result.get("severity", "unknown"),
                    "message": result.get("message") or "Potential interaction detected."
                })
    return {"checked": True, "warnings": warnings}


def _extract_medicines(payload: Dict[str, Any]) -> List[str]:
    medicines = payload.get("medicines")
    if isinstance(medicines, list):
        return [str(x) for x in medicines]
    if isinstance(medicines, str):
        return _split_terms(medicines)
    return []


def register_emergency_quick_access_routes(app):
    global _EMERGENCY_ROUTES_REGISTERED
    if _EMERGENCY_ROUTES_REGISTERED:
        return
    _EMERGENCY_ROUTES_REGISTERED = True

    @emergency_quick_access_bp.route("/api/emergency/medicine-search", methods=["GET"])
    @emergency_rate_limit(limit=20, window_seconds=60)
    def emergency_medicine_search():
        q = _normalize_text(request.args.get("q"))
        if not q:
            return jsonify({
                "query": "",
                "items": [],
                "interaction_check": {"checked": False, "warnings": []}
            })
        terms = _split_terms(q)
        items = _search_medicines_in_db(q)
        interactions = _interaction_summary(terms)
        return jsonify({
            "query": q,
            "items": items,
            "interaction_check": interactions
        })

    @emergency_quick_access_bp.route("/api/emergency/nearby-help", methods=["GET"])
    @emergency_rate_limit(limit=15, window_seconds=60)
    def emergency_nearby_help():
        radius_km = _to_float(request.args.get("radius_km")) or 10.0
        lat = _to_float(request.args.get("lat"))
        lon = _to_float(request.args.get("lon"))
        location_label = ""
        location_q = _normalize_text(request.args.get("q"))

        if (lat is None or lon is not None) and location_q:
            geocoded = _geocode_location(location_q)
            if geocoded:
                lat, lon, location_label = geocoded

        if lat is None or lon is None:
            lat, lon = 12.9716, 77.5946
            if not location_label:
                location_label = "Bengaluru (default)"

        results = _search_nearby_from_db(lat, lon, radius_km)
        if not results:
            results = _fallback_nearby(lat, lon, radius_km)

        return jsonify({
            "origin": {
                "latitude": lat,
                "longitude": lon,
                "label": location_label
            },
            "radius_km": radius_km,
            "results": results
        })

    @emergency_quick_access_bp.route("/api/emergency/ai-check", methods=["POST"])
    def emergency_ai_check():
        payload = request.get_json(silent=True) or {}
        symptoms = _normalize_text(payload.get("symptoms"))
        medicines = _extract_medicines(payload)

        risk_level, risk_reasons = _risk_from_symptoms(symptoms)
        interaction = _interaction_summary(medicines)

        ai_hint = ""
        try:
            ai_hint = _normalize_text(get_ai_suggestions(symptoms, medicines))
        except Exception:
            ai_hint = ""

        return jsonify({
            "risk_level": risk_level,
            "reasons": risk_reasons,
            "interaction": interaction,
            "ai_hint": ai_hint,
            "disclaimer": "Emergency quick check is informational only. Call local emergency services for urgent symptoms."
        })

    @emergency_quick_access_bp.route("/api/emergency/contacts", methods=["GET"])
    def emergency_contacts():
        return jsonify({
            "contacts": sorted(EMERGENCY_CONTACTS, key=lambda c: c["priority"])
        })

    @emergency_quick_access_bp.route("/api/emergency/first-aid", methods=["GET"])
    def emergency_first_aid():
        topic = _normalize_text(request.args.get("topic")).lower()
        if topic:
            guide = FIRST_AID_GUIDES.get(topic)
            if not guide:
                return jsonify({"topic": topic, "guide": None, "error": "Guide not found"}), 404
            return jsonify({"topic": topic, "guide": guide})
        return jsonify({"guides": FIRST_AID_GUIDES})

    app.register_blueprint(emergency_quick_access_bp)
