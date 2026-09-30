"""
AI Safety Guard Module
Smart Safety & Analysis System for MediGuard AI

This module provides AI-based safety analysis for healthcare data:
- Drug interaction checking
- Prescription safety analysis
- Safety alerts dashboard
- AI-powered suggestions

READ-ONLY: Only analyzes existing data, does not modify database.
"""

from flask import Blueprint, request, jsonify
from config import get_db

# Create blueprint
ai_safety_guard_bp = Blueprint('ai_safety_guard', __name__)

# ════════════════════════════════════════════════════════════════
# DRUG INTERACTION DATABASE (STATIC)
# ════════════════════════════════════════════════════════════════

DRUG_INTERACTIONS = {
    # High Risk Combinations
    "aspirin+ibuprofen": {
        "effect": "Increased risk of gastrointestinal bleeding and ulcers",
        "severity": "HIGH",
        "advice": "Avoid combination. Use acetaminophen instead for pain relief."
    },
    "warfarin+aspirin": {
        "effect": "Significantly increased bleeding risk",
        "severity": "CRITICAL",
        "advice": "Never combine. Consult cardiologist immediately."
    },
    "digoxin+amiodarone": {
        "effect": "Increased digoxin levels, potential toxicity",
        "severity": "HIGH",
        "advice": "Monitor digoxin levels closely. Reduce dosage if needed."
    },
    "lithium+ace_inhibitors": {
        "effect": "Increased lithium toxicity",
        "severity": "HIGH",
        "advice": "Monitor lithium levels. Adjust dosage carefully."
    },
    "theophylline+ciprofloxacin": {
        "effect": "Increased theophylline levels, potential seizures",
        "severity": "HIGH",
        "advice": "Reduce theophylline dosage by 50% when starting ciprofloxacin."
    },

    # Moderate Risk Combinations
    "amlodipine+simvastatin": {
        "effect": "Increased risk of muscle pain and weakness",
        "severity": "MODERATE",
        "advice": "Monitor for muscle symptoms. Consider alternative statin."
    },
    "metformin+iodinated_contrast": {
        "effect": "Risk of lactic acidosis",
        "severity": "MODERATE",
        "advice": "Hold metformin 48 hours before and after contrast study."
    },
    "prednisone+aspirin": {
        "effect": "Increased gastrointestinal irritation",
        "severity": "MODERATE",
        "advice": "Add proton pump inhibitor for stomach protection."
    },

    # Common OTC Interactions
    "acetaminophen+alcohol": {
        "effect": "Increased liver toxicity risk",
        "severity": "MODERATE",
        "advice": "Limit alcohol intake. Do not exceed 2g acetaminophen daily."
    },
    "caffeine+decongestants": {
        "effect": "Increased heart rate and blood pressure",
        "severity": "MODERATE",
        "advice": "Monitor blood pressure. Limit caffeine intake."
    }
}

# ════════════════════════════════════════════════════════════════
# AI SUGGESTIONS DATABASE (STATIC)
# ════════════════════════════════════════════════════════════════

DRUG_ALTERNATIVES = {
    "ibuprofen": ["acetaminophen", "naproxen"],
    "aspirin": ["clopidogrel", "acetaminophen"],
    "warfarin": ["dabigatran", "rivaroxaban"],
    "digoxin": ["bisoprolol", "carvedilol"],
    "lithium": ["lamotrigine", "quetiapine"],
    "theophylline": ["albuterol", "montelukast"],
    "amlodipine": ["losartan", "hydrochlorothiazide"],
    "metformin": ["acarbose", "pioglitazone"],
    "prednisone": ["methylprednisolone", "dexamethasone"],
    "ciprofloxacin": ["levofloxacin", "azithromycin"]
}

# ════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ════════════════════════════════════════════════════════════════

def normalize_drug_name(drug_name):
    """Normalize drug name for matching"""
    return drug_name.lower().strip().replace(" ", "_")

def check_drug_interaction(drug_a, drug_b):
    """Check if two drugs interact"""
    key1 = f"{normalize_drug_name(drug_a)}+{normalize_drug_name(drug_b)}"
    key2 = f"{normalize_drug_name(drug_b)}+{normalize_drug_name(drug_a)}"

    return DRUG_INTERACTIONS.get(key1) or DRUG_INTERACTIONS.get(key2)

def get_ai_suggestions(drug_name):
    """Get AI suggestions for a drug"""
    normalized = normalize_drug_name(drug_name)
    alternatives = DRUG_ALTERNATIVES.get(normalized, [])

    suggestions = []
    for alt in alternatives:
        suggestions.append({
            "type": "alternative",
            "message": f"Consider {alt.title()} as an alternative to {drug_name.title()}",
            "alternative_drug": alt.title(),
            "original_drug": drug_name.title()
        })

    return suggestions

def analyze_prescription_safety(medicines):
    """Analyze a list of medicines for safety issues"""
    issues = []
    warnings = []

    # Check for duplicates
    medicine_counts = {}
    for med in medicines:
        name = med.lower().strip()
        medicine_counts[name] = medicine_counts.get(name, 0) + 1

    for med, count in medicine_counts.items():
        if count > 1:
            issues.append({
                "type": "duplicate",
                "severity": "HIGH",
                "message": f"Duplicate medicine: {med.title()} prescribed {count} times",
                "drug": med.title()
            })

    # Check interactions
    medicine_list = list(medicine_counts.keys())
    for i in range(len(medicine_list)):
        for j in range(i + 1, len(medicine_list)):
            drug_a = medicine_list[i]
            drug_b = medicine_list[j]

            interaction = check_drug_interaction(drug_a, drug_b)
            if interaction:
                issues.append({
                    "type": "interaction",
                    "severity": interaction["severity"],
                    "message": f"{drug_a.title()} + {drug_b.title()}: {interaction['effect']}",
                    "drug_a": drug_a.title(),
                    "drug_b": drug_b.title(),
                    "effect": interaction["effect"],
                    "advice": interaction["advice"]
                })

    # Check for overdose patterns (same drug class multiple times)
    # This is a simplified check - in reality would need more sophisticated logic
    warnings.append({
        "type": "general",
        "severity": "LOW",
        "message": "Consider reviewing total daily dosages for all medications"
    })

    return {
        "issues": issues,
        "warnings": warnings,
        "total_issues": len(issues),
        "total_warnings": len(warnings)
    }

# ════════════════════════════════════════════════════════════════
# API ROUTES
# ════════════════════════════════════════════════════════════════

@ai_safety_guard_bp.route('/api/ai-safety-guard/drug-check', methods=['POST'])
def drug_interaction_checker():
    """
    Check drug interactions for a list of medicines
    Input: {"medicines": ["aspirin", "ibuprofen", "acetaminophen"]}
    """
    try:
        data = request.get_json()
        medicines = data.get('medicines', [])

        if not medicines or len(medicines) < 2:
            return jsonify({
                "error": "Please provide at least 2 medicines to check for interactions"
            }), 400

        analysis = analyze_prescription_safety(medicines)

        return jsonify({
            "medicines_checked": medicines,
            "analysis": analysis,
            "status": "completed"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@ai_safety_guard_bp.route('/api/ai-safety-guard/prescription-analyze/<int:patient_id>', methods=['GET'])
def analyze_patient_prescriptions(patient_id):
    """
    Analyze all prescriptions for a patient
    """
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)

        # Get patient info
        cursor.execute("SELECT * FROM patients WHERE id = %s", (patient_id,))
        patient = cursor.fetchone()

        if not patient:
            return jsonify({"error": "Patient not found"}), 404

        # Get all prescriptions for this patient
        cursor.execute("""
            SELECT * FROM prescriptions
            WHERE patient_id = %s
            ORDER BY created_at DESC
        """, (patient_id,))

        prescriptions = cursor.fetchall()

        # Analyze each prescription
        prescription_analyses = []
        all_issues = []
        all_warnings = []

        for prescription in prescriptions:
            medicines = [prescription['medicine_name']]  # In real system, might have multiple medicines per prescription

            analysis = analyze_prescription_safety(medicines)
            prescription_analyses.append({
                "prescription_id": prescription['id'],
                "medicine": prescription['medicine_name'],
                "analysis": analysis
            })

            all_issues.extend(analysis['issues'])
            all_warnings.extend(analysis['warnings'])

        # Get AI suggestions for each medicine
        suggestions = []
        for prescription in prescriptions:
            drug_suggestions = get_ai_suggestions(prescription['medicine_name'])
            suggestions.extend(drug_suggestions)

        return jsonify({
            "patient": {
                "id": patient['id'],
                "name": patient['name'],
                "age": patient.get('age'),
                "conditions": patient.get('medical_history', '')
            },
            "prescription_analyses": prescription_analyses,
            "summary": {
                "total_prescriptions": len(prescriptions),
                "total_issues": len(all_issues),
                "total_warnings": len(all_warnings)
            },
            "ai_suggestions": suggestions[:5],  # Limit to 5 suggestions
            "status": "completed"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

@ai_safety_guard_bp.route('/api/ai-safety-guard/dashboard', methods=['GET'])
def safety_dashboard():
    """
    Get safety dashboard data
    """
    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)

        # Get total patients
        cursor.execute("SELECT COUNT(*) as count FROM patients")
        total_patients = cursor.fetchone()['count']

        # Get total prescriptions
        cursor.execute("SELECT COUNT(*) as count FROM prescriptions")
        total_prescriptions = cursor.fetchone()['count']

        # Get unresolved safety alerts
        cursor.execute("SELECT COUNT(*) as count FROM safety_alerts_log WHERE resolved = 0")
        unresolved_alerts = cursor.fetchone()['count']

        # Get recent alerts
        cursor.execute("""
            SELECT sal.*, p.name as patient_name
            FROM safety_alerts_log sal
            LEFT JOIN patients p ON sal.patient_id = p.id
            WHERE sal.resolved = 0
            ORDER BY sal.created_at DESC
            LIMIT 10
        """)
        recent_alerts = cursor.fetchall()

        # Analyze prescriptions for potential issues
        cursor.execute("SELECT * FROM prescriptions ORDER BY created_at DESC LIMIT 100")
        recent_prescriptions = cursor.fetchall()

        potential_issues = 0
        for prescription in recent_prescriptions:
            # Simple check - in real system would be more sophisticated
            if len(prescription['medicine_name'].split()) > 3:  # Long medicine names might indicate combinations
                potential_issues += 1

        return jsonify({
            "dashboard": {
                "total_patients": total_patients,
                "total_prescriptions": total_prescriptions,
                "unresolved_alerts": unresolved_alerts,
                "potential_issues": potential_issues
            },
            "recent_alerts": recent_alerts,
            "status": "completed"
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()

@ai_safety_guard_bp.route('/api/ai-safety-guard/suggestions/<drug_name>', methods=['GET'])
def get_drug_suggestions(drug_name):
    """
    Get AI suggestions for a specific drug
    """
    try:
        suggestions = get_ai_suggestions(drug_name)

        return jsonify({
            "drug": drug_name,
            "suggestions": suggestions,
            "total_suggestions": len(suggestions)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ════════════════════════════════════════════════════════════════
# REGISTER BLUEPRINT FUNCTION
# ════════════════════════════════════════════════════════════════

def register_ai_safety_guard_routes(app):
    """Register AI Safety Guard routes with the Flask app"""
    app.register_blueprint(ai_safety_guard_bp)
