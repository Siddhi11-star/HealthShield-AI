import datetime
import base64
import hashlib
import json
import os
import re
from io import BytesIO

import requests
from flask import jsonify, request, send_file

from auth_utils import require_roles
from services.ai_service import analyze_diagnostics, generate_wellness_plan, get_health_recommendation

DISCLAIMER = (
    "AI-generated insight for clinical decision support only. "
    "Not a final diagnosis. Final validation required by a licensed medical professional."
)

LLM_API_KEY = os.getenv("CLINICAL_AI_API_KEY", os.getenv("OPENAI_API_KEY", "")).strip()
LLM_MODEL = os.getenv("CLINICAL_AI_MODEL", "gpt-4.1-mini").strip()
LLM_BASE_URL = os.getenv("CLINICAL_AI_BASE_URL", "https://api.openai.com/v1/chat/completions").strip()
LLM_ALLOW_FALLBACK = os.getenv("CLINICAL_AI_ALLOW_FALLBACK", "1").strip().lower() not in ("0", "false", "no")
WELLNESS_ENCRYPTION_SECRET = os.getenv("WELLNESS_ENCRYPTION_SECRET", "mediguard-wellness-default-secret").strip()


def _get_fernet():
    return hashlib.sha256(WELLNESS_ENCRYPTION_SECRET.encode("utf-8")).digest()


def _xor_stream(data_bytes):
    key = _get_fernet()
    output = bytearray()
    counter = 0
    while len(output) < len(data_bytes):
        block = hashlib.sha256(key + counter.to_bytes(4, "big")).digest()
        for b in block:
            if len(output) >= len(data_bytes):
                break
            output.append(b)
        counter += 1
    return bytes(a ^ b for a, b in zip(data_bytes, output))


def _encrypt_value(value):
    text = _clean_text(value)
    if not text:
        return ""
    return base64.urlsafe_b64encode(_xor_stream(text.encode("utf-8"))).decode("utf-8")


def _decrypt_value(value):
    text = _clean_text(value)
    if not text:
        return ""
    try:
        decoded = base64.urlsafe_b64decode(text.encode("utf-8"))
        return _xor_stream(decoded).decode("utf-8")
    except Exception:
        return ""


def ensure_ai_tables(db):
    cursor = db.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS clinical_insights (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            patient_label    VARCHAR(120) DEFAULT 'Anonymous case',
            insight_type     VARCHAR(80) DEFAULT 'Diagnostic Analysis',
            priority         VARCHAR(20) DEFAULT 'medium',
            recommendation   TEXT,
            top_condition    VARCHAR(200),
            payload_json     JSON,
            created_by_user  INT DEFAULT NULL,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_clinical_created_at (created_at)
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS wellness_profiles (
            id                INT AUTO_INCREMENT PRIMARY KEY,
            patient_id        INT NOT NULL UNIQUE,
            diet_type         VARCHAR(120) DEFAULT 'Balanced',
            sleep_pattern     VARCHAR(120) DEFAULT '6-7 hours irregular',
            stress_level      VARCHAR(50) DEFAULT 'moderate',
            lifestyle_notes   TEXT,
            updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS biometric_snapshots (
            id                    INT AUTO_INCREMENT PRIMARY KEY,
            patient_id            INT NOT NULL,
            hrv                   DECIMAL(8,2) DEFAULT NULL,
            activity_level        VARCHAR(120) DEFAULT NULL,
            blood_glucose         DECIMAL(8,2) DEFAULT NULL,
            recovery_score        DECIMAL(8,2) DEFAULT NULL,
            resting_heart_rate    DECIMAL(8,2) DEFAULT NULL,
            sleep_score           DECIMAL(8,2) DEFAULT NULL,
            captured_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_biometric_patient (patient_id),
            INDEX idx_biometric_captured (captured_at)
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS genetic_profiles (
            id                       INT AUTO_INCREMENT PRIMARY KEY,
            patient_id               INT NOT NULL UNIQUE,
            encrypted_markers        TEXT,
            encrypted_predispositions TEXT,
            updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS wellness_plans (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            patient_id       INT NOT NULL,
            patient_label    VARCHAR(120) DEFAULT 'Patient',
            payload_json     JSON,
            created_by_user  INT DEFAULT NULL,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_wellness_plans_patient (patient_id),
            INDEX idx_wellness_plans_created (created_at)
        )
        """
    )
    db.commit()


def _clean_text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            value = json.dumps(value, ensure_ascii=True)
        except Exception:
            value = str(value)
    return str(value).strip()


def _extract_lab_file_text(file_storage):
    if not file_storage or not getattr(file_storage, "filename", ""):
        return ""

    filename = file_storage.filename.lower()
    raw = file_storage.read()
    file_storage.stream.seek(0)

    if filename.endswith((".txt", ".csv", ".json")):
        return raw.decode("utf-8", errors="ignore")[:5000]

    if filename.endswith(".pdf"):
        try:
            from pypdf import PdfReader
            from io import BytesIO

            reader = PdfReader(BytesIO(raw))
            text = []
            for page in reader.pages[:5]:
                text.append(page.extract_text() or "")
            return "\n".join(text)[:5000]
        except Exception:
            return "PDF lab report attached but could not be text-extracted on the server."

    return ""


def _anonymize_text(text):
    value = _clean_text(text)
    value = re.sub(r"\b[\w\.-]+@[\w\.-]+\.\w+\b", "[REDACTED_EMAIL]", value)
    value = re.sub(r"\+?\d[\d\-\s]{7,}\d", "[REDACTED_PHONE]", value)
    value = re.sub(r"\b(?:mr|mrs|ms|dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?", "[REDACTED_NAME]", value, flags=re.I)
    return value


def _anonymize_payload(value):
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            normalized_key = _clean_text(key).lower().replace(" ", "_")
            if normalized_key in {
                "name",
                "full_name",
                "first_name",
                "last_name",
                "phone",
                "phone_number",
                "mobile",
                "email",
                "address",
                "street",
                "city",
                "postal_code",
                "zip",
                "dob",
                "date_of_birth",
            }:
                continue
            redacted[key] = _anonymize_payload(item)
        return redacted
    if isinstance(value, list):
        return [_anonymize_payload(item) for item in value]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _anonymize_text(value)


def _build_case_payload(payload, db):
    patient_id = payload.get("patient_id")
    patient_label = "Anonymous case"
    patient_history = payload.get("patient_history") or {}

    if patient_id:
        cursor = db.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT id, age, gender, current_medications, known_allergies
            FROM patients WHERE id=%s
            """,
            (patient_id,),
        )
        patient = cursor.fetchone()
        if patient:
            patient_label = f"Patient #{patient['id']}"
            patient_history = {
                "age": patient.get("age"),
                "gender": patient.get("gender"),
                "pre_existing_conditions": patient_history.get("pre_existing_conditions", ""),
                "current_medications": patient.get("current_medications", ""),
                "known_allergies": patient.get("known_allergies", ""),
            }

    lab_results_text = _anonymize_text(payload.get("lab_results"))
    case_payload = {
        "symptoms": _anonymize_text(payload.get("symptoms")),
        "lab_results": lab_results_text,
        "patient_history": {
            "age": patient_history.get("age"),
            "gender": _clean_text(patient_history.get("gender")),
            "pre_existing_conditions": _anonymize_text(patient_history.get("pre_existing_conditions")),
            "current_medications": _anonymize_text(patient_history.get("current_medications")),
            "known_allergies": _anonymize_text(patient_history.get("known_allergies")),
        },
        "case_context": {
            "patient_label": patient_label,
            "lab_data_present": bool(lab_results_text),
            "attached_report_processed": bool(_clean_text(payload.get("lab_report_filename"))),
            "source": "mediguard-smart-diagnostic-assistant",
        },
        "patient_label": patient_label,
    }
    return case_payload


def _heuristic_analysis(case_payload):
    symptoms = (case_payload.get("symptoms") or "").lower()
    labs = (case_payload.get("lab_results") or "").lower()
    conditions = (case_payload.get("patient_history", {}).get("pre_existing_conditions") or "").lower()
    differential = []
    red_flags = []

    def add(condition, probability, supporting, next_steps, rationale):
        differential.append(
            {
                "condition": condition,
                "probability": probability,
                "supporting_findings": supporting,
                "recommended_next_steps": next_steps,
                "rationale": rationale,
            }
        )

    if all(term in symptoms for term in ["cough", "fever"]) and "weight loss" in symptoms:
        add(
            "Pulmonary tuberculosis",
            0.72,
            ["Persistent cough", "Fever pattern", "Weight loss"],
            ["Chest X-ray", "Sputum AFB/NAAT", "CBC, ESR/CRP", "Assess exposure history and oxygen saturation"],
            "Classic constitutional and respiratory symptom cluster suggests infectious pulmonary pathology.",
        )
        add(
            "Community-acquired pneumonia",
            0.49,
            ["Cough", "Fever", "Inflammatory symptoms"],
            ["Chest examination", "Chest imaging", "CBC with differential", "Pulse oximetry"],
            "Acute infective respiratory disease remains a common competing diagnosis.",
        )
        add(
            "Lung malignancy or chronic inflammatory lung disease",
            0.23,
            ["Weight loss", "Persistent symptoms"],
            ["Chest CT", "Smoking/exposure review", "Referral if imaging abnormal"],
            "Chronic symptoms with weight loss require exclusion of serious structural disease.",
        )
        red_flags.extend(
            [
                "Hemoptysis, hypoxia, severe dyspnea, or high persistent fever warrant urgent in-person evaluation.",
                "Immunocompromise or known TB exposure increases urgency for isolation and expedited testing.",
            ]
        )
    elif "chest pain" in symptoms:
        add(
            "Acute coronary syndrome",
            0.58,
            ["Chest pain symptom complex"],
            ["Immediate ECG", "Troponin series", "Vitals and oxygen saturation", "Urgent escalation if unstable"],
            "Potential cardiac ischemia must be prioritized in undifferentiated chest pain.",
        )
        add(
            "Pulmonary embolism",
            0.31,
            ["Chest symptoms possibly associated with dyspnea or tachycardia"],
            ["Assess Wells criteria", "D-dimer if appropriate", "CT pulmonary angiography if high suspicion"],
            "Life-threatening vascular causes need active exclusion.",
        )
        add(
            "Gastroesophageal or musculoskeletal pain",
            0.22,
            ["Common non-cardiac causes"],
            ["Focused history and exam", "Response to analgesia/antacid only after ruling out critical causes"],
            "Benign etiologies remain possible but should follow exclusion of dangerous diagnoses.",
        )
        red_flags.append("New chest pain with syncope, diaphoresis, hypotension, or resting dyspnea is an emergency.")
    else:
        add(
            "Undifferentiated infectious or inflammatory illness",
            0.34,
            ["Symptoms are non-specific"],
            ["Focused examination", "CBC, CRP/ESR, basic metabolic panel", "Targeted imaging depending on system involved"],
            "The presentation requires additional structured data before narrowing confidently.",
        )
        add(
            "Systemic metabolic or endocrine contributor",
            0.21,
            ["Background comorbidity can shape symptom burden"],
            ["Review glucose, renal profile, thyroid tests as clinically indicated"],
            "Chronic disease or metabolic imbalance may explain or amplify current symptoms.",
        )
        add(
            "Organ-specific pathology requiring targeted workup",
            0.19,
            ["History is incomplete"],
            ["Obtain fuller history, exam, and focused investigations"],
            "Further localization is needed to define a narrower differential.",
        )

    if "wbc" in labs or "crp" in labs:
        red_flags.append("Inflammatory marker elevation may indicate active infection, inflammation, or sepsis risk depending on the clinical picture.")
    if "diabetes" in conditions:
        red_flags.append("Diabetes increases risk of severe infection and may alter thresholds for escalation and antimicrobial coverage.")

    clinical_pathway = []
    for idx, item in enumerate(differential[:4], start=1):
        clinical_pathway.append(
            {
                "step": idx,
                "title": f"Evaluate for {item['condition']}",
                "details": item["recommended_next_steps"][0] if item["recommended_next_steps"] else "Perform focused workup",
                "priority": "high" if idx == 1 else "medium",
            }
        )

    return {
        "case_summary": {
            "symptoms": case_payload.get("symptoms"),
            "lab_results": case_payload.get("lab_results"),
            "patient_history": case_payload.get("patient_history"),
        },
        "differential_diagnosis": differential[:5],
        "clinical_pathway": clinical_pathway,
        "red_flags": red_flags[:5],
        "triage_recommendation": "Urgent in-person escalation recommended." if red_flags else "Continue clinician-led structured workup.",
        "clinical_reasoning_summary": "Heuristic local analysis was used because no external clinical model is configured. Findings were summarized without exposing hidden chain-of-thought.",
        "disclaimer": DISCLAIMER,
    }


def _extract_json_block(text):
    text = _clean_text(text)
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except Exception:
            return {}
    return {}


def _call_clinical_model(case_payload):
    if not LLM_API_KEY:
        if LLM_ALLOW_FALLBACK:
            return _heuristic_analysis(case_payload), {"provider": "local-fallback"}
        raise RuntimeError("Clinical AI provider is not configured on the server.")

    schema_hint = {
        "case_summary": {
            "symptoms": "string",
            "lab_results": "string",
            "patient_history": {
                "age": "number|null",
                "gender": "string",
                "pre_existing_conditions": "string",
                "current_medications": "string",
                "known_allergies": "string",
            },
        },
        "differential_diagnosis": [
            {
                "condition": "string",
                "probability": "0-1 number",
                "supporting_findings": ["string"],
                "recommended_next_steps": ["string"],
                "rationale": "string",
            }
        ],
        "clinical_pathway": [{"step": 1, "title": "string", "details": "string", "priority": "high|medium|low"}],
        "red_flags": ["string"],
        "triage_recommendation": "string",
        "clinical_reasoning_summary": "string",
    }

    system_prompt = (
        "You are a Senior Clinical Diagnostic Assistant. Analyze the provided symptoms, "
        "lab values, and history. Provide a Differential Diagnosis list ranked by probability. "
        "For each diagnosis, include Supporting Findings and Recommended Next Steps. "
        "Return strict JSON only. Do not include direct identifiers such as names, phone numbers, addresses, "
        "or emails. Provide a concise clinical reasoning summary suitable for clinician review, but do not expose "
        "hidden chain-of-thought or internal reasoning traces. Highlight urgent or life-threatening possibilities, "
        "recommend immediate next diagnostic steps, and use probabilities between 0 and 1."
    )

    user_prompt = {
        "task": "Generate clinical decision support output",
        "case_payload": case_payload,
        "required_json_shape": schema_hint,
    }

    response = requests.post(
        LLM_BASE_URL,
        headers={
            "Authorization": f"Bearer {LLM_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": LLM_MODEL,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=True)},
            ],
        },
        timeout=60,
    )
    if not response.ok:
        raise RuntimeError(f"Clinical AI request failed: {response.text[:300]}")

    data = response.json()
    content = ""
    if data.get("choices"):
        content = data["choices"][0].get("message", {}).get("content", "")
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    parsed = _extract_json_block(content)
    if not parsed:
        raise RuntimeError("Clinical AI returned an unreadable response.")
    parsed["disclaimer"] = DISCLAIMER
    return parsed, {"provider": "external", "model": LLM_MODEL}


def _build_recommendation_card(category, title, description, confidence):
    try:
        confidence = max(0.0, min(float(confidence), 1.0))
    except Exception:
        confidence = 0.6
    return {
        "category": (_clean_text(category) or "general").lower(),
        "title": _clean_text(title),
        "description": _clean_text(description),
        "confidence": confidence,
    }


def _call_recommendation_model(query):
    if not LLM_API_KEY:
        raise RuntimeError("Recommendation AI is not configured on the server. Set OPENAI_API_KEY or CLINICAL_AI_API_KEY.")

    schema_hint = {
        "answer": "string",
        "recommendations": [
            {
                "category": "urgent|treatment|diagnostic|lifestyle|follow-up|medication|general",
                "title": "string",
                "description": "string",
                "confidence": "0-1 number",
            }
        ],
        "urgent_flags": ["string"],
    }

    system_prompt = (
        "You are a careful AI assistant inside a health app. "
        "Answer the user's question directly in clear, natural language, even when the question is broad, open-ended, or not a simple symptom lookup. "
        "When the question is health-related, give practical next steps, mention red-flag situations that need urgent care, "
        "and avoid overconfident diagnosis claims. "
        "When the question is not clearly medical, still answer helpfully and honestly without pretending certainty. "
        "Return strict JSON only. Do not include identifiers such as names, phone numbers, addresses, or emails."
    )

    user_prompt = {
        "task": "Answer the user's query in an AI-generated, context-aware way with direct guidance and supporting recommendation cards",
        "query": _anonymize_text(query),
        "required_json_shape": schema_hint,
    }

    response = requests.post(
        LLM_BASE_URL,
        headers={
            "Authorization": f"Bearer {LLM_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": LLM_MODEL,
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=True)},
            ],
        },
        timeout=60,
    )
    if not response.ok:
        raise RuntimeError(f"Recommendation AI request failed: {response.text[:300]}")

    data = response.json()
    content = ""
    if data.get("choices"):
        content = data["choices"][0].get("message", {}).get("content", "")
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))

    parsed = _extract_json_block(content)
    if not parsed:
        raise RuntimeError("Recommendation AI returned an unreadable response.")
    return parsed, {"provider": "external", "model": LLM_MODEL}


def _normalize_recommendation_response(result, query):
    result = result or {}
    answer = _clean_text(result.get("answer") or result.get("summary") or result.get("answer_summary"))
    recommendations = []

    for item in (result.get("recommendations") or result.get("cards") or [])[:5]:
        title = _clean_text(item.get("title"))
        description = _clean_text(item.get("description") or item.get("details"))
        if not title or not description:
            continue
        recommendations.append(
            _build_recommendation_card(
                item.get("category", "general"),
                title,
                description,
                item.get("confidence", 0.7),
            )
        )

    if not answer:
        raise RuntimeError("Recommendation AI did not return a direct answer.")

    if not recommendations:
        raise RuntimeError("Recommendation AI did not return recommendation cards.")

    return {
        "answer": answer,
        "recommendations": recommendations,
        "disclaimer": DISCLAIMER,
    }


def _normalize_analysis(result, case_payload):
    result = result or {}
    differential = result.get("differential_diagnosis") or result.get("pathways") or []
    normalized_ddx = []
    for item in differential[:5]:
        probability = item.get("probability", item.get("confidence", 0.0))
        try:
            probability = max(0.0, min(float(probability), 1.0))
        except Exception:
            probability = 0.0
        normalized_ddx.append(
            {
                "condition": _clean_text(item.get("condition")),
                "probability": probability,
                "supporting_findings": [
                    _clean_text(entry)
                    for entry in (item.get("supporting_findings") or [])
                    if _clean_text(entry)
                ],
                "recommended_next_steps": [
                    _clean_text(entry)
                    for entry in (item.get("recommended_next_steps") or [])
                    if _clean_text(entry)
                ],
                "rationale": _clean_text(item.get("rationale")),
            }
        )

    pathway = []
    for idx, step in enumerate(result.get("clinical_pathway") or [], start=1):
        pathway.append(
            {
                "step": step.get("step", idx),
                "title": _clean_text(step.get("title")),
                "details": _clean_text(step.get("details")),
                "priority": (_clean_text(step.get("priority")) or "medium").lower(),
            }
        )

    return {
        "case_summary": result.get("case_summary") or case_payload,
        "differential_diagnosis": normalized_ddx,
        "clinical_pathway": pathway,
        "red_flags": [_clean_text(flag) for flag in (result.get("red_flags") or []) if _clean_text(flag)][:5],
        "triage_recommendation": _clean_text(result.get("triage_recommendation")),
        "clinical_reasoning_summary": _clean_text(result.get("clinical_reasoning_summary")),
        "disclaimer": DISCLAIMER,
    }


def _ensure_default_wellness_context(db, patient):
    cursor = db.cursor(dictionary=True)
    cursor.execute("SELECT * FROM wellness_profiles WHERE patient_id=%s", (patient["id"],))
    lifestyle = cursor.fetchone()
    if not lifestyle:
        write = db.cursor()
        default_diet = "Low-glycemic balanced" if "diab" in _clean_text(patient.get("current_medications")).lower() else "Balanced Mediterranean"
        write.execute(
            """
            INSERT INTO wellness_profiles (patient_id, diet_type, sleep_pattern, stress_level, lifestyle_notes)
            VALUES (%s,%s,%s,%s,%s)
            """,
            (
                patient["id"],
                default_diet,
                "6.5 hours fragmented sleep",
                "moderate",
                "Default profile created automatically. Update with richer lifestyle inputs as available.",
            ),
        )
        db.commit()
        cursor.execute("SELECT * FROM wellness_profiles WHERE patient_id=%s", (patient["id"],))
        lifestyle = cursor.fetchone()

    cursor.execute(
        """
        SELECT * FROM biometric_snapshots
        WHERE patient_id=%s
        ORDER BY captured_at DESC LIMIT 1
        """,
        (patient["id"],),
    )
    biometrics = cursor.fetchone()
    if not biometrics:
        write = db.cursor()
        age = patient.get("age") or 35
        glucose = 146 if "diab" in _clean_text(patient.get("current_medications")).lower() else 104
        write.execute(
            """
            INSERT INTO biometric_snapshots
            (patient_id, hrv, activity_level, blood_glucose, recovery_score, resting_heart_rate, sleep_score)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                patient["id"],
                28 if age > 45 else 36,
                "Sedentary" if age > 45 else "Moderately active",
                glucose,
                54,
                72,
                61,
            ),
        )
        db.commit()
        cursor.execute(
            """
            SELECT * FROM biometric_snapshots
            WHERE patient_id=%s
            ORDER BY captured_at DESC LIMIT 1
            """,
            (patient["id"],),
        )
        biometrics = cursor.fetchone()

    cursor.execute("SELECT * FROM genetic_profiles WHERE patient_id=%s", (patient["id"],))
    genetics = cursor.fetchone()
    return lifestyle, biometrics, genetics


def _upsert_genetic_profile(db, patient_id, markers_text):
    encrypted = _encrypt_value(markers_text)
    cursor = db.cursor()
    cursor.execute("SELECT id FROM genetic_profiles WHERE patient_id=%s", (patient_id,))
    row = cursor.fetchone()
    if row:
        cursor.execute(
            """
            UPDATE genetic_profiles
            SET encrypted_markers=%s, encrypted_predispositions=%s
            WHERE patient_id=%s
            """,
            (encrypted, encrypted, patient_id),
        )
    else:
        cursor.execute(
            """
            INSERT INTO genetic_profiles (patient_id, encrypted_markers, encrypted_predispositions)
            VALUES (%s,%s,%s)
            """,
            (patient_id, encrypted, encrypted),
        )
    db.commit()


def _parse_genetic_insights(marker_text):
    text = _clean_text(marker_text)
    lower = text.lower()
    insights = []
    if "vitamin d" in lower:
        insights.append({"marker": "Vitamin D predisposition", "insight": "Greater likelihood of suboptimal vitamin D status.", "implication": "Prioritize sunlight exposure, serum 25-OH vitamin D testing, and clinician-guided supplementation."})
    if "apoe" in lower:
        insights.append({"marker": "APOE-related lipid sensitivity", "insight": "Lipid response may be more sensitive to saturated fat load.", "implication": "Favor Mediterranean-style fats and trend ApoB / lipid markers."})
    if "mthfr" in lower:
        insights.append({"marker": "MTHFR methylation variant", "insight": "Folate processing may be less efficient in some variants.", "implication": "Review homocysteine, B12, folate status, and dietary folate quality."})
    if "caffeine" in lower:
        insights.append({"marker": "Caffeine sensitivity", "insight": "Late-day caffeine may worsen sleep or recovery.", "implication": "Restrict caffeine timing to earlier daylight hours."})
    return insights


def _build_wellness_payload(patient, lifestyle, biometrics, genetics_row):
    marker_text = _decrypt_value((genetics_row or {}).get("encrypted_markers"))
    predisposition_text = _decrypt_value((genetics_row or {}).get("encrypted_predispositions"))
    return {
        "patient_reference": f"Patient #{patient['id']}",
        "demographics": {
            "age": patient.get("age"),
            "gender": patient.get("gender"),
        },
        "clinical_background": {
            "current_medications": _anonymize_text(patient.get("current_medications")),
            "known_allergies": _anonymize_text(patient.get("known_allergies")),
        },
        "lifestyle_profile": {
            "diet": lifestyle.get("diet_type"),
            "sleep_pattern": lifestyle.get("sleep_pattern"),
            "stress_level": lifestyle.get("stress_level"),
            "notes": _anonymize_text(lifestyle.get("lifestyle_notes")),
        },
        "biometric_data": {
            "hrv": biometrics.get("hrv"),
            "activity_level": biometrics.get("activity_level"),
            "blood_glucose": biometrics.get("blood_glucose"),
            "recovery_score": biometrics.get("recovery_score"),
            "resting_heart_rate": biometrics.get("resting_heart_rate"),
            "sleep_score": biometrics.get("sleep_score"),
        },
        "genetic_markers": _anonymize_text(marker_text),
        "predispositions": _anonymize_text(predisposition_text),
    }


def _heuristic_wellness_plan(payload):
    biometrics = payload.get("biometric_data") or {}
    lifestyle = payload.get("lifestyle_profile") or {}
    markers = (payload.get("genetic_markers") or "") + " " + (payload.get("predispositions") or "")
    glucose = float(biometrics.get("blood_glucose") or 0)
    hrv = float(biometrics.get("hrv") or 0)
    sleep_score = float(biometrics.get("sleep_score") or 0)
    recovery = float(biometrics.get("recovery_score") or 0)

    health_scores = [
        {"label": "Recovery", "score": max(35, min(100, int(recovery or 55)))},
        {"label": "Glucose Stability", "score": 58 if glucose >= 140 else 76 if glucose >= 110 else 88},
        {"label": "Stress Resilience", "score": 52 if hrv and hrv < 30 else 74},
        {"label": "Sleep Readiness", "score": max(40, min(100, int(sleep_score or 60)))},
    ]

    misalignments = []
    if glucose >= 140:
        misalignments.append("Wearable glucose trend is elevated relative to a longevity-focused nutrition pattern.")
    if "caffeine" in markers.lower() and sleep_score < 70:
        misalignments.append("Genetic caffeine sensitivity may be contributing to reduced sleep quality and recovery.")
    if "vitamin d" in markers.lower() and lifestyle.get("activity_level", "") == "Sedentary":
        misalignments.append("Vitamin D predisposition combined with low outdoor activity suggests likely sunlight deficit.")
    if not misalignments:
        misalignments.append("No major gene-to-biometric mismatch was identified from currently available data.")

    plan = {
        "biometric_summary": {
            "headline": "Recovery-biased optimization plan generated from current biometrics.",
            "metrics": [
                {"label": "HRV", "value": biometrics.get("hrv") or "N/A", "status": "low" if hrv and hrv < 30 else "moderate", "insight": "Lower HRV suggests recovery or stress reserve may be constrained."},
                {"label": "Blood Glucose", "value": biometrics.get("blood_glucose") or "N/A", "status": "elevated" if glucose >= 140 else "stable", "insight": "Higher glucose after meals supports a lower glycemic nutrition focus."},
                {"label": "Sleep Score", "value": biometrics.get("sleep_score") or "N/A", "status": "low" if sleep_score < 70 else "good", "insight": "Sleep quality strongly shapes next-day metabolic and cognitive resilience."},
            ],
        },
        "genetic_insights": _parse_genetic_insights(markers) or [
            {"marker": "No uploaded genetic marker", "insight": "The plan is driven primarily by lifestyle and biometric data.", "implication": "Add optional markers to sharpen nutrition and recovery recommendations."}
        ],
        "actionable_pillars": {
            "nutrition": [
                {"title": "Glucose-aware macro split", "recommendation": "Aim for 30% protein, 35% low-glycemic carbohydrates, 35% unsaturated fats.", "why": "This moderates post-prandial glucose excursions while preserving satiety and muscle support."},
                {"title": "Daylight meal timing", "recommendation": "Bias carbohydrates earlier in the day and reduce late-evening glycemic load.", "why": "Earlier feeding windows are often better aligned with glucose control and circadian insulin sensitivity."},
            ],
            "exercise": [
                {"title": "Morning zone-2 base work", "recommendation": "Schedule 30-40 minutes of low-to-moderate aerobic work in the morning 4 times weekly.", "why": "Improves mitochondrial efficiency and can support better glucose disposal."},
                {"title": "Recovery-aware strength", "recommendation": "Use moderate resistance training on days when recovery score is above 60; keep intensity lower when HRV is suppressed.", "why": "Matches training dose to recovery capacity to reduce allostatic load."},
            ],
            "bio_hacks": [
                {"title": "Cold exposure", "recommendation": "Use brief cool-shower exposure 2-3 times weekly if medically appropriate.", "why": "May support autonomic tone and subjective resilience when introduced gradually."},
                {"title": "Sunlight and sleep anchoring", "recommendation": "Get 10-20 minutes of outdoor light within 60 minutes of waking.", "why": "Strengthens circadian rhythm, which improves sleep timing and recovery biology."},
            ],
        },
        "misalignments": misalignments,
        "health_scores": health_scores,
        "optimization_levels": health_scores,
        "disclaimer": DISCLAIMER,
    }
    return plan


def _call_wellness_model(payload):
    if not LLM_API_KEY:
        if LLM_ALLOW_FALLBACK:
            return _heuristic_wellness_plan(payload), {"provider": "local-fallback"}
        raise RuntimeError("Clinical AI provider is not configured on the server.")

    schema_hint = {
        "biometric_summary": {"headline": "string", "metrics": [{"label": "string", "value": "string", "status": "string", "insight": "string"}]},
        "genetic_insights": [{"marker": "string", "insight": "string", "implication": "string"}],
        "actionable_pillars": {
            "nutrition": [{"title": "string", "recommendation": "string", "why": "string"}],
            "exercise": [{"title": "string", "recommendation": "string", "why": "string"}],
            "bio_hacks": [{"title": "string", "recommendation": "string", "why": "string"}],
        },
        "misalignments": ["string"],
        "health_scores": [{"label": "string", "score": "0-100 number"}],
        "optimization_levels": [{"label": "string", "score": "0-100 number"}],
    }

    system_prompt = (
        "You are a Functional Medicine & Longevity Expert. Generate a Health Optimization Plan by correlating "
        "genetic predispositions with biometric trends and lifestyle data. Identify misalignments, prioritize "
        "actionable nutrition, exercise, and bio-hack recommendations, and explain the scientific reasoning succinctly. "
        "Return strict JSON only and do not include any direct identifiers."
    )
    response = requests.post(
        LLM_BASE_URL,
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": LLM_MODEL,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps({"task": "Generate wellness optimization plan", "payload": payload, "required_json_shape": schema_hint}, ensure_ascii=True)},
            ],
        },
        timeout=60,
    )
    if not response.ok:
        raise RuntimeError(f"Wellness AI request failed: {response.text[:300]}")
    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = _extract_json_block(content)
    if not parsed:
        raise RuntimeError("Wellness AI returned an unreadable response.")
    parsed["disclaimer"] = DISCLAIMER
    return parsed, {"provider": "external", "model": LLM_MODEL}


def _normalize_wellness_plan(plan):
    normalized = plan or {}
    for section in ("health_scores", "optimization_levels"):
        scores = []
        for item in normalized.get(section) or []:
            try:
                score = max(0, min(100, int(float(item.get("score", 0)))))
            except Exception:
                score = 0
            scores.append({"label": _clean_text(item.get("label")), "score": score})
        normalized[section] = scores
    normalized["disclaimer"] = DISCLAIMER
    return normalized


def _build_wellness_pdf(patient_label, plan):
    lines = [
        "Personalized Wellness Blueprint",
        patient_label,
        "",
        _clean_text((plan.get("biometric_summary") or {}).get("headline")),
        "",
        "Health Scores",
    ]
    for score in plan.get("health_scores") or []:
        lines.append(f"- {_clean_text(score.get('label'))}: {score.get('score', 0)}/100")

    lines.append("")
    lines.append("Genetic Insights")
    for item in plan.get("genetic_insights") or []:
        lines.append(f"- {_clean_text(item.get('marker'))}: {_clean_text(item.get('insight'))}")
        lines.append(f"  Why: {_clean_text(item.get('implication'))}")

    for heading, key in [("Nutrition", "nutrition"), ("Exercise", "exercise"), ("Bio-Hacks", "bio_hacks")]:
        lines.append("")
        lines.append(heading)
        for item in ((plan.get("actionable_pillars") or {}).get(key) or []):
            lines.append(f"- {_clean_text(item.get('title'))}: {_clean_text(item.get('recommendation'))}")
            lines.append(f"  Why: {_clean_text(item.get('why'))}")

    if plan.get("misalignments"):
        lines.append("")
        lines.append("Detected Misalignments")
        for item in plan.get("misalignments") or []:
            lines.append(f"- {_clean_text(item)}")

    lines.append("")
    lines.append(DISCLAIMER)

    def pdf_escape(text):
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    y = 800
    content_lines = ["BT", "/F1 11 Tf", "50 800 Td", "14 TL"]
    for line in lines:
        safe = pdf_escape(line[:110])
        content_lines.append(f"({safe}) Tj")
        content_lines.append("T*")
        y -= 14
        if y < 60:
            break
    content_lines.append("ET")
    content = "\n".join(content_lines).encode("latin-1", errors="replace")

    objects = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(f"<< /Length {len(content)} >>\nstream\n".encode("latin-1") + content + b"\nendstream")

    pdf = BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(pdf.tell())
        pdf.write(f"{idx} 0 obj\n".encode("latin-1"))
        pdf.write(obj)
        pdf.write(b"\nendobj\n")
    xref_pos = pdf.tell()
    pdf.write(f"xref\n0 {len(objects)+1}\n".encode("latin-1"))
    pdf.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.write(f"{offset:010d} 00000 n \n".encode("latin-1"))
    pdf.write(
        f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode("latin-1")
    )
    pdf.seek(0)
    return pdf


def register_ai_clinical_routes(app):
    from config import get_db

    @app.route("/api/clinical-insights", methods=["GET"])
    @require_roles("doctor", "admin")
    def get_clinical_insights():
        db = None
        try:
            db = get_db()
            ensure_ai_tables(db)
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT patient_label as patient_name, insight_type, priority, recommendation, created_at
                FROM clinical_insights
                ORDER BY created_at DESC
                LIMIT 20
                """
            )
            insights = cursor.fetchall()
            for row in insights:
                if row.get("created_at") and hasattr(row["created_at"], "isoformat"):
                    row["created_at"] = row["created_at"].isoformat()
            return jsonify({"insights": insights})
        finally:
            if db:
                db.close()

    @app.route("/api/ai-clinical-intelligence/diagnostic-analysis", methods=["POST"])
    @require_roles("doctor", "admin")
    def diagnostic_analysis():
        payload = request.form.to_dict() if request.form else (request.json or {})
        patient_history = payload.get("patient_history") or {}
        if isinstance(patient_history, str):
            try:
                patient_history = json.loads(patient_history)
            except Exception:
                patient_history = {"pre_existing_conditions": patient_history}

        patient_history = {
            "age": payload.get("age") or patient_history.get("age"),
            "gender": payload.get("gender") or patient_history.get("gender"),
            "pre_existing_conditions": payload.get("pre_existing_conditions") or patient_history.get("pre_existing_conditions"),
            "current_medications": payload.get("current_medications") or patient_history.get("current_medications"),
            "known_allergies": payload.get("known_allergies") or patient_history.get("known_allergies"),
        }

        uploaded_lab_report = request.files.get("lab_report")
        lab_file_text = _extract_lab_file_text(uploaded_lab_report)
        merged_payload = {
            "patient_id": payload.get("patient_id"),
            "symptoms": payload.get("symptoms"),
            "lab_results": "\n".join(filter(None, [payload.get("lab_results"), lab_file_text])),
            "patient_history": patient_history,
            "lab_report_filename": getattr(uploaded_lab_report, "filename", ""),
        }

        if not _clean_text(merged_payload["symptoms"]):
            return jsonify({"error": "Symptoms are required"}), 400

        db = None
        try:
            db = get_db()
            ensure_ai_tables(db)
            merged_payload["patient_history"] = _anonymize_payload(merged_payload.get("patient_history") or {})
            case_payload = _build_case_payload(merged_payload, db)
            analysis, metadata = analyze_diagnostics(case_payload)

            top_condition = analysis["differential_diagnosis"][0]["condition"] if analysis["differential_diagnosis"] else ""
            priority = "high" if analysis["red_flags"] else "medium"
            recommendation = ""
            if analysis["clinical_pathway"]:
                recommendation = analysis["clinical_pathway"][0]["details"]
            elif analysis["differential_diagnosis"]:
                recommendation = "; ".join(analysis["differential_diagnosis"][0].get("recommended_next_steps", [])[:2])

            cursor = db.cursor()
            cursor.execute(
                """
                INSERT INTO clinical_insights
                (patient_label, insight_type, priority, recommendation, top_condition, payload_json, created_by_user)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    case_payload.get("patient_label", "Anonymous case"),
                    "Diagnostic Analysis",
                    priority,
                    recommendation[:1000],
                    top_condition[:200],
                    json.dumps(analysis, ensure_ascii=True),
                    request.current_user["id"],
                ),
            )
            db.commit()

            return jsonify(
                {
                    "analysis": analysis,
                    "meta": {
                        "provider": metadata.get("provider"),
                        "model": metadata.get("model", ""),
                        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
                    },
                }
            )
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500
        finally:
            if db:
                db.close()

    @app.route("/api/ai-clinical-intelligence/wellness-plan", methods=["POST"])
    @require_roles("doctor", "admin")
    def wellness_plan():
        data = request.json or {}
        patient_id = data.get("patient_id")
        if not patient_id:
            return jsonify({"error": "patient_id is required"}), 400

        db = None
        try:
            db = get_db()
            ensure_ai_tables(db)
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM patients WHERE id=%s", (patient_id,))
            patient = cursor.fetchone()
            if not patient:
                return jsonify({"error": "Patient not found"}), 404
            lifestyle, biometrics, genetics = _ensure_default_wellness_context(db, patient)

            input_markers = _clean_text(data.get("genetic_markers"))
            if input_markers:
                _upsert_genetic_profile(db, patient["id"], input_markers)
                cursor.execute("SELECT * FROM genetic_profiles WHERE patient_id=%s", (patient["id"],))
                genetics = cursor.fetchone()

            ai_payload = _build_wellness_payload(patient, lifestyle, biometrics, genetics)
            plan, metadata = generate_wellness_plan(ai_payload)

            writer = db.cursor()
            writer.execute(
                """
                INSERT INTO wellness_plans (patient_id, patient_label, payload_json, created_by_user)
                VALUES (%s,%s,%s,%s)
                """,
                (
                    patient["id"],
                    f"Patient #{patient['id']}",
                    json.dumps(plan, ensure_ascii=True),
                    request.current_user["id"],
                ),
            )
            db.commit()
            plan_id = writer.lastrowid

            patient_safe = {
                "id": patient["id"],
                "age": patient.get("age"),
                "gender": patient.get("gender"),
            }
            return jsonify(
                {
                    "patient": patient_safe,
                    "plan": plan,
                    "plan_id": plan_id,
                    "context": {
                        "lifestyle_profile": lifestyle,
                        "biometric_data": biometrics,
                        "genetic_data_encrypted": bool(genetics and genetics.get("encrypted_markers")),
                    },
                    "meta": {
                        "provider": metadata.get("provider"),
                        "model": metadata.get("model", ""),
                    },
                    "disclaimer": DISCLAIMER,
                }
            )
        finally:
            if db:
                db.close()

    @app.route("/api/ai-clinical-intelligence/wellness-plan/<int:plan_id>/pdf", methods=["GET"])
    @require_roles("doctor", "admin")
    def wellness_plan_pdf(plan_id):
        db = None
        try:
            db = get_db()
            ensure_ai_tables(db)
            cursor = db.cursor(dictionary=True)
            cursor.execute("SELECT * FROM wellness_plans WHERE id=%s", (plan_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({"error": "Wellness plan not found"}), 404
            payload = row.get("payload_json") or {}
            if isinstance(payload, str):
                payload = json.loads(payload)
            pdf_buffer = _build_wellness_pdf(row.get("patient_label", f"Patient #{row['patient_id']}"), payload)
            return send_file(
                pdf_buffer,
                mimetype="application/pdf",
                as_attachment=True,
                download_name=f"wellness-plan-{plan_id}.pdf",
            )
        finally:
            if db:
                db.close()

    @app.route("/api/ai-clinical-intelligence/recommendations", methods=["POST"])
    @require_roles("doctor", "admin")
    def recommendations():
        data = request.json or {}
        query = _anonymize_text(data.get("query"))
        if not query:
            return jsonify({"error": "query is required"}), 400
        try:
            payload, _metadata = get_health_recommendation(query)
        except Exception as exc:
            return jsonify({"error": _clean_text(exc) or "Recommendation AI failed"}), 503

        return jsonify(payload)
