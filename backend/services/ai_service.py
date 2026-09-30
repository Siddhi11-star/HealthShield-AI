import json
import os
import re
from collections import OrderedDict

import requests

AI_PROVIDER = os.getenv("AI_PROVIDER", "auto").strip().lower()
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate").strip()
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3").strip()
HUGGING_FACE_BASE = os.getenv("HUGGING_FACE_BASE", "https://api-inference.huggingface.co/models").strip()
HUGGING_FACE_MODEL = os.getenv("HUGGING_FACE_MODEL", "google/flan-t5-base").strip()
HUGGING_FACE_API_TOKEN = os.getenv("HUGGING_FACE_API_TOKEN", "").strip()
AI_ALLOW_FALLBACK = os.getenv("AI_ALLOW_FALLBACK", "1").strip().lower() not in ("0", "false", "no")
AI_MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "800"))
AI_CACHE_MAX = int(os.getenv("AI_CACHE_MAX", "120"))
DISCLAIMER = (
    "AI-generated suggestions are not a substitute for professional medical advice. "
    "This is not a medical diagnosis."
)

_cache = {
    "recommendation": OrderedDict(),
    "diagnostic": OrderedDict(),
    "wellness": OrderedDict(),
}


def _clean_text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            value = json.dumps(value, ensure_ascii=False)
        except Exception:
            value = str(value)
    return str(value).strip()


def _extract_json_block(text):
    if not isinstance(text, str):
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


def _cache_get(kind, key):
    cache = _cache.get(kind)
    if key in cache:
        cache.move_to_end(key)
        return cache[key]
    return None


def _cache_set(kind, key, value):
    cache = _cache.get(kind)
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > AI_CACHE_MAX:
        cache.popitem(last=False)


def _normalize_recommendation(result):
    if not isinstance(result, dict):
        return {"answer": _clean_text(str(result)), "recommendations": [], "disclaimer": DISCLAIMER}
    answer = _clean_text(result.get("answer") or result.get("summary") or result.get("response") or "")
    recommendations = []
    for item in (result.get("recommendations") or result.get("cards") or []):
        if not isinstance(item, dict):
            continue
        recommendations.append(
            {
                "category": _clean_text(item.get("category") or item.get("type") or "general").lower(),
                "title": _clean_text(item.get("title") or item.get("heading") or "Recommendation"),
                "description": _clean_text(item.get("description") or item.get("details") or item.get("note") or ""),
                "confidence": float(item.get("confidence") or item.get("score") or 0.7),
            }
        )
    if not answer:
        answer = "The AI could not generate a direct health summary. Please consult a qualified provider for more information."
    return {"answer": answer, "recommendations": recommendations, "disclaimer": DISCLAIMER}


def _normalize_diagnostics(result):
    if not isinstance(result, dict):
        return {
            "case_summary": {},
            "differential_diagnosis": [],
            "clinical_pathway": [],
            "red_flags": [],
            "triage_recommendation": "No clear triage recommendation available.",
            "clinical_reasoning_summary": "No structured diagnostic output could be extracted.",
            "disclaimer": DISCLAIMER,
        }
    return {
        "case_summary": result.get("case_summary") or {},
        "differential_diagnosis": [
            {
                "condition": _clean_text(item.get("condition")),
                "probability": min(1.0, max(0.0, float(item.get("probability") or item.get("confidence") or 0.0))),
                "supporting_findings": [str(x) for x in (item.get("supporting_findings") or []) if str(x).strip()],
                "recommended_next_steps": [str(x) for x in (item.get("recommended_next_steps") or item.get("next_steps") or []) if str(x).strip()],
                "rationale": _clean_text(item.get("rationale") or item.get("reason") or ""),
            }
            for item in (result.get("differential_diagnosis") or result.get("pathways") or [])
        ],
        "clinical_pathway": [
            {
                "step": int(item.get("step") or idx + 1),
                "title": _clean_text(item.get("title") or item.get("headline") or "Follow up"),
                "details": _clean_text(item.get("details") or item.get("recommendation") or ""),
                "priority": _clean_text(item.get("priority") or "medium").lower(),
            }
            for idx, item in enumerate((result.get("clinical_pathway") or result.get("pathway") or [])[:5])
        ],
        "red_flags": [str(x).strip() for x in (result.get("red_flags") or []) if str(x).strip()][:5],
        "triage_recommendation": _clean_text(result.get("triage_recommendation") or result.get("triage") or "Follow clinician judgment and seek urgent care if symptoms worsen."),
        "clinical_reasoning_summary": _clean_text(result.get("clinical_reasoning_summary") or result.get("summary") or "Clinical reasoning was generated in support of clinician review."),
        "disclaimer": DISCLAIMER,
    }


def _normalize_wellness(result):
    if not isinstance(result, dict):
        return {
            "biometric_summary": {"headline": "No wellness summary could be generated."},
            "genetic_insights": [],
            "actionable_pillars": {"nutrition": [], "exercise": [], "bio_hacks": []},
            "misalignments": [],
            "health_scores": [],
            "optimization_levels": [],
            "disclaimer": DISCLAIMER,
        }
    normalized = {
        "biometric_summary": result.get("biometric_summary") or {},
        "genetic_insights": [
            {"marker": _clean_text(item.get("marker")), "insight": _clean_text(item.get("insight")), "implication": _clean_text(item.get("implication"))}
            for item in (result.get("genetic_insights") or [])
        ],
        "actionable_pillars": {
            "nutrition": [
                {"title": _clean_text(item.get("title")), "recommendation": _clean_text(item.get("recommendation")), "why": _clean_text(item.get("why"))}
                for item in (result.get("actionable_pillars", {}).get("nutrition") or [])
            ],
            "exercise": [
                {"title": _clean_text(item.get("title")), "recommendation": _clean_text(item.get("recommendation")), "why": _clean_text(item.get("why"))}
                for item in (result.get("actionable_pillars", {}).get("exercise") or [])
            ],
            "bio_hacks": [
                {"title": _clean_text(item.get("title")), "recommendation": _clean_text(item.get("recommendation")), "why": _clean_text(item.get("why"))}
                for item in (result.get("actionable_pillars", {}).get("bio_hacks") or [])
            ],
        },
        "misalignments": [str(x).strip() for x in (result.get("misalignments") or []) if str(x).strip()],
        "health_scores": [
            {"label": _clean_text(item.get("label")), "score": int(min(100, max(0, float(item.get("score") or 0))))}
            for item in (result.get("health_scores") or [])
        ],
        "optimization_levels": [
            {"label": _clean_text(item.get("label")), "score": int(min(100, max(0, float(item.get("score") or 0))))}
            for item in (result.get("optimization_levels") or [])
        ],
        "disclaimer": DISCLAIMER,
    }
    return normalized


def _fallback_recommendation(query):
    query_text = _clean_text(query)
    query_lower = query_text.lower()

    if not query_text:
        answer = (
            "This is a safe fallback response because no specific question was provided. "
            "It is not a medical diagnosis. Consult a licensed healthcare provider for any health concerns."
        )
        recommendations = [
            {"category": "general", "title": "Describe your symptoms clearly", "description": "Include duration, severity, and any triggers.", "confidence": 0.75},
            {"category": "follow-up", "title": "See a healthcare provider", "description": "A clinician can review your history and exam findings for a more accurate evaluation.", "confidence": 0.85},
        ]
        return {"answer": answer, "recommendations": recommendations, "disclaimer": DISCLAIMER}

    answer = f"This is a safe fallback response for your query: \"{query_text}\". "
    recommendations = []

    if any(term in query_lower for term in ["fever", "temperature", "chills", "sweats"]):
        answer += "A fever may indicate infection or inflammation, so monitor your temperature and seek care if it is high or persistent. "
        recommendations.extend([
            {"category": "symptom", "title": "Track your temperature", "description": "Record fever patterns and note whether it increases with activity or nighttime.", "confidence": 0.78},
            {"category": "hydration", "title": "Stay hydrated", "description": "Drink fluids frequently and rest while you are unwell.", "confidence": 0.72},
        ])
    elif any(term in query_lower for term in ["pain", "ache", "hurt", "sore"]):
        answer += "Pain should be described clearly by location, intensity, and what makes it better or worse. "
        recommendations.extend([
            {"category": "pain", "title": "Describe pain details", "description": "Note sudden vs gradual onset, location, and any activity that changes the pain.", "confidence": 0.77},
            {"category": "follow-up", "title": "Review with a clinician", "description": "Persistent or severe pain should be assessed by a healthcare professional.", "confidence": 0.82},
        ])
    elif any(term in query_lower for term in ["cough", "shortness of breath", "breath", "wheeze"]):
        answer += "Respiratory symptoms can range from mild to serious; watch for difficulty breathing or chest tightness. "
        recommendations.extend([
            {"category": "respiratory", "title": "Monitor breathing", "description": "Pay attention to whether breathing becomes harder or if you feel dizzy.", "confidence": 0.79},
            {"category": "urgent", "title": "Seek care if breathing worsens", "description": "Seek medical attention if difficulty breathing develops or symptoms worsen rapidly.", "confidence": 0.88},
        ])
    elif any(term in query_lower for term in ["headache", "migraine", "pressure"]):
        answer += "Headache causes are broad, so describe any changes in vision, nausea, or the way the pain feels. "
        recommendations.extend([
            {"category": "symptom", "title": "Track headache features", "description": "Note whether headache is sudden, one-sided, or tied to light and sound sensitivity.", "confidence": 0.74},
            {"category": "hydration", "title": "Rest and hydrate", "description": "Many headaches improve with rest, hydration, and a quiet environment.", "confidence": 0.70},
        ])
    else:
        answer += "This response uses a safe fallback guide because live AI is not configured. "
        recommendations.extend([
            {"category": "general", "title": "Clarify your concern", "description": f"For the query '{query_text}', mention the most important symptom, timeline, or question when seeking care.", "confidence": 0.72},
            {"category": "follow-up", "title": "Consult a clinician", "description": "A healthcare provider can make a more accurate assessment with a full clinical review.", "confidence": 0.80},
        ])

    recommendations.append(
        {"category": "safety", "title": "Use medical help if in doubt", "description": "If symptoms are severe, sudden, or getting worse, seek care promptly.", "confidence": 0.86}
    )
    return {"answer": answer.strip(), "recommendations": recommendations, "disclaimer": DISCLAIMER}


def _fallback_diagnostics(payload):
    symptoms = _clean_text(payload.get("symptoms") or "").lower()
    findings = []
    if "cough" in symptoms and "fever" in symptoms:
        findings.append(
            {"condition": "Possible respiratory infection", "probability": 0.55, "supporting_findings": ["Cough", "Fever"], "recommended_next_steps": ["Chest exam", "CBC and basic infection panel"], "rationale": "Common respiratory infections can present with cough and fever."}
        )
    if "chest pain" in symptoms:
        findings.append(
            {"condition": "Potential cardiac or musculoskeletal cause", "probability": 0.45, "supporting_findings": ["Chest pain"], "recommended_next_steps": ["ECG", "Monitor vital signs"], "rationale": "Chest pain requires prompt evaluation to exclude serious causes."}
        )
    if not findings:
        findings.append(
            {"condition": "Undifferentiated illness", "probability": 0.30, "supporting_findings": ["Non-specific symptoms"], "recommended_next_steps": ["Collect more history", "Consider basic labs"], "rationale": "Symptoms are broad and need further data."}
        )
    return {
        "case_summary": {
            "symptoms": payload.get("symptoms"),
            "lab_results": payload.get("lab_results"),
            "patient_history": payload.get("patient_history") or {},
        },
        "differential_diagnosis": findings,
        "clinical_pathway": [
            {"step": 1, "title": "Assess urgent red-flags", "details": "Check for severe breathing difficulty, chest pain, altered consciousness, or high fever.", "priority": "high"},
            {"step": 2, "title": "Order baseline labs", "details": "Obtain CBC, metabolic panel, and inflammatory markers as clinically appropriate.", "priority": "medium"},
        ],
        "red_flags": ["Seek urgent care if symptoms worsen rapidly or new alarming features appear."],
        "triage_recommendation": "Consult a healthcare provider for a structured clinical evaluation.",
        "clinical_reasoning_summary": "Fallback local analysis was used because no external AI provider was available.",
        "disclaimer": DISCLAIMER,
    }


def _fallback_wellness(profile):
    return {
        "biometric_summary": {
            "headline": "Wellness plan created from current lifestyle and biometric data.",
            "metrics": [
                {"label": "Recovery", "value": "Moderate", "status": "moderate", "insight": "Aim to improve nightly rest and recovery."},
                {"label": "Glucose Stability", "value": "Stable", "status": "moderate", "insight": "Maintain balanced carbohydrates and lean proteins."},
            ],
        },
        "genetic_insights": [
            {"marker": "Genetic markers not provided", "insight": "The plan is primarily based on lifestyle and biometric data.", "implication": "Add optional genetic markers for a more tailored plan."},
        ],
        "actionable_pillars": {
            "nutrition": [
                {"title": "Balanced meals", "recommendation": "Include lean protein, vegetables, and whole grains at every meal.", "why": "Supports steady energy and blood sugar control."},
            ],
            "exercise": [
                {"title": "Daily movement", "recommendation": "Aim for 30 minutes of walking or light activity most days.", "why": "Supports cardiovascular health and mood."},
            ],
            "bio_hacks": [
                {"title": "Better sleep hygiene", "recommendation": "Wind down at least 30 minutes before bed and avoid screens.", "why": "Improves recovery and metabolic health."},
            ],
        },
        "misalignments": ["No major misalignment identified from available data."],
        "health_scores": [{"label": "Wellness", "score": 72}],
        "optimization_levels": [{"label": "Readiness", "score": 65}],
        "disclaimer": DISCLAIMER,
    }


def _call_ollama(prompt, model=OLLAMA_MODEL, temperature=0.2, max_tokens=AI_MAX_TOKENS):
    payload = {
        "model": model,
        "prompt": prompt,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    response = requests.post(OLLAMA_URL, headers={"Content-Type": "application/json"}, json=payload, timeout=60)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict) and data.get("output"):
        output = data.get("output")
        if isinstance(output, list) and output:
            text_parts = []
            for item in output:
                if isinstance(item, dict):
                    text_parts.append(item.get("content", ""))
                    if item.get("type") == "message":
                        if isinstance(item.get("content"), str):
                            text_parts.append(item["content"])
                elif isinstance(item, str):
                    text_parts.append(item)
            return "".join(text_parts).strip()
    if isinstance(data, dict) and data.get("choices"):
        choice = data["choices"][0]
        if isinstance(choice, dict):
            return _clean_text(choice.get("content") or choice.get("text") or "")
    if isinstance(data, str):
        return data
    return json.dumps(data, ensure_ascii=False)


def _call_huggingface(prompt, model=HUGGING_FACE_MODEL, token=HUGGING_FACE_API_TOKEN):
    url = f"{HUGGING_FACE_BASE}/{model}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {"inputs": prompt, "options": {"wait_for_model": True, "use_cache": False}}
    response = requests.post(url, headers=headers, json=payload, timeout=90)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            return _clean_text(first.get("generated_text") or first.get("text") or json.dumps(first, ensure_ascii=False))
        return str(first)
    if isinstance(data, dict):
        return _clean_text(data.get("generated_text") or data.get("text") or json.dumps(data, ensure_ascii=False))
    return _clean_text(str(data))


def _run_model(prompt, kind="recommendation"):
    cache_key = json.dumps({"provider": AI_PROVIDER, "prompt": prompt}, sort_keys=True, ensure_ascii=False)
    cached = _cache_get(kind, cache_key)
    if cached is not None:
        return cached
    last_error = None
    if AI_PROVIDER in ("none", "fallback", "disabled"):
        raise RuntimeError("AI provider is disabled; using local fallback.")

    providers = []
    if AI_PROVIDER in ("ollama", "auto"):
        providers.append("ollama")
    if AI_PROVIDER in ("huggingface", "auto"):
        providers.append("huggingface")
    if not providers:
        providers = ["ollama", "huggingface"]
    for provider in providers:
        try:
            if provider == "ollama":
                result = _call_ollama(prompt)
            else:
                result = _call_huggingface(prompt)
            _cache_set(kind, cache_key, (result, provider))
            return result, provider
        except Exception as exc:
            last_error = exc
            if provider == "ollama" and not AI_ALLOW_FALLBACK:
                break
            if provider == "huggingface" and not AI_ALLOW_FALLBACK:
                break
            continue
    raise RuntimeError(f"AI provider failure: {last_error}")


def get_health_recommendation(query):
    query_text = _clean_text(query)
    if not query_text:
        raise ValueError("The query must contain text.")
    prompt = (
        "You are a cautious medical assistant helping users with general health questions. "
        "Respond in safe, non-diagnostic language and make it clear that this is not a medical diagnosis. "
        "Provide a short answer and recommend actions, red flags, or follow-up steps. "
        "Return strict JSON only with keys: answer, recommendations (list of {category,title,description,confidence}), urgent_flags. "
        f"User query: {query_text}"
    )
    try:
        content, provider = _run_model(prompt, "recommendation")
        parsed = _extract_json_block(content)
        if not parsed:
            raise ValueError("Unreadable recommendation response")
        normalized = _normalize_recommendation(parsed)
        return normalized, {"provider": provider, "model": AI_PROVIDER}
    except Exception:
        fallback = _fallback_recommendation(query_text)
        return fallback, {"provider": "fallback", "model": "local"}


def analyze_diagnostics(payload):
    payload = payload or {}
    prompt = (
        "You are a senior diagnostic assistant. Analyze the symptoms, lab results, and history. "
        "Do not provide a diagnosis. Instead, offer a differential diagnosis list, clinical pathways, red flags, and a safe triage recommendation. "
        "Return strict JSON only with keys: case_summary, differential_diagnosis, clinical_pathway, red_flags, triage_recommendation, clinical_reasoning_summary. "
        f"Input data: {json.dumps(payload, ensure_ascii=False)}"
    )
    try:
        content, provider = _run_model(prompt, "diagnostic")
        parsed = _extract_json_block(content)
        if not parsed:
            raise ValueError("Unreadable diagnostics response")
        normalized = _normalize_diagnostics(parsed)
        return normalized, {"provider": provider, "model": AI_PROVIDER}
    except Exception:
        fallback = _fallback_diagnostics(payload)
        return fallback, {"provider": "fallback", "model": "local"}


def generate_wellness_plan(payload):
    payload = payload or {}
    prompt = (
        "You are a wellness coach specializing in safe lifestyle planning. Analyze the user's lifestyle, biometric trends, and genetic markers. "
        "Provide a structured wellness plan with nutrition, exercise, and recovery recommendations. "
        "Return strict JSON only with keys: biometric_summary, genetic_insights, actionable_pillars, misalignments, health_scores, optimization_levels. "
        f"Input data: {json.dumps(payload, ensure_ascii=False)}"
    )
    try:
        content, provider = _run_model(prompt, "wellness")
        parsed = _extract_json_block(content)
        if not parsed:
            raise ValueError("Unreadable wellness response")
        normalized = _normalize_wellness(parsed)
        return normalized, {"provider": provider, "model": AI_PROVIDER}
    except Exception:
        fallback = _fallback_wellness(payload)
        return fallback, {"provider": "fallback", "model": "local"}
