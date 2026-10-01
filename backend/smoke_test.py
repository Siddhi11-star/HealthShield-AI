#!/usr/bin/env python3
"""
Smoke test: Register a test doctor and exercise all new dashboard APIs (agenda, patients, tasks, notifications).
Run after starting the Flask backend.
"""
import requests
import json
import sys
from datetime import datetime, timedelta

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "http://127.0.0.1:5001"
DOCTOR_EMAIL = f"testdoctor_{int(datetime.now().timestamp())}@mediguard.io"
DOCTOR_PASS = "Test@1234"
DOCTOR_NAME = "Dr. Test Smoke"

# Track results
results = {"passed": 0, "failed": 0, "errors": []}

def log_test(name, passed, message=""):
    if passed:
        print(f"✓ {name}")
        results["passed"] += 1
    else:
        print(f"✗ {name}")
        results["failed"] += 1
        if message:
            results["errors"].append(f"{name}: {message}")

def test_register():
    """Register a new doctor account."""
    global token, doctor_id, user_id
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"name": DOCTOR_NAME, "email": DOCTOR_EMAIL, "password": DOCTOR_PASS, "role": "doctor"},
            timeout=5
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            token = data.get("token")
            user_id = data.get("user", {}).get("id")
            if token and user_id:
                log_test("Register doctor", True)
                return True
        log_test("Register doctor", False, f"Status {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log_test("Register doctor", False, str(e))
        return False

def test_login():
    """Login with the test doctor account."""
    global token, user_id
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": DOCTOR_EMAIL, "password": DOCTOR_PASS},
            timeout=5
        )
        if resp.status_code == 200:
            data = resp.json()
            new_token = data.get("token")
            new_uid = data.get("user", {}).get("id")
            if new_token and new_uid:
                token = new_token
                user_id = new_uid
                log_test("Login doctor", True)
                return True
        log_test("Login doctor", False, f"Status {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log_test("Login doctor", False, str(e))
        return False

def headers():
    """Return auth headers."""
    return {"Authorization": f"Bearer {token}"}

def test_doctor_register_profile():
    """Register as doctor in the doctor_portal."""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/doctors/register",
            json={"name": DOCTOR_NAME, "specialty": "Cardiology", "experience_yrs": 10},
            headers=headers(),
            timeout=5
        )
        if resp.status_code in (200, 201):
            log_test("Doctor profile registration", True)
            return True
        log_test("Doctor profile registration", False, f"Status {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log_test("Doctor profile registration", False, str(e))
        return False

def test_create_agenda():
    """Create an agenda item."""
    try:
        today = datetime.now().date()
        scheduled_at = f"{today}T09:00:00"
        resp = requests.post(
            f"{BASE_URL}/api/doctors/agenda",
            json={"title": "Test Agenda Item", "note": "Smoke test agenda", "scheduled_at": scheduled_at},
            headers=headers(),
            timeout=5
        )
        if resp.status_code in (200, 201):
            agenda = resp.json()
            agenda_id = agenda.get("id")
            log_test("Create agenda item", True)
            return agenda_id
        log_test("Create agenda item", False, f"Status {resp.status_code}: {resp.text}")
        return None
    except Exception as e:
        log_test("Create agenda item", False, str(e))
        return None

def test_list_agenda(date_str=None):
    """List agenda items for a date."""
    try:
        url = f"{BASE_URL}/api/doctors/agenda"
        if date_str:
            url += f"?date={date_str}"
        resp = requests.get(url, headers=headers(), timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("agenda", [])
            log_test(f"List agenda items ({len(items)} found)", True)
            return items
        log_test("List agenda items", False, f"Status {resp.status_code}: {resp.text}")
        return []
    except Exception as e:
        log_test("List agenda items", False, str(e))
        return []

def test_delete_agenda(agenda_id):
    """Delete an agenda item."""
    try:
        resp = requests.delete(
            f"{BASE_URL}/api/doctors/agenda/{agenda_id}",
            headers=headers(),
            timeout=5
        )
        if resp.status_code == 200:
            log_test("Delete agenda item", True)
            return True
        log_test("Delete agenda item", False, f"Status {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log_test("Delete agenda item", False, str(e))
        return False

def test_create_patient():
    """Create a patient."""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/doctors/patients",
            json={"name": "John Doe", "age": 45, "gender": "Male", "phone": "9876543210", "known_allergies": "Penicillin"},
            headers=headers(),
            timeout=5
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            patient_id = data.get("id")
            log_test("Create patient", True)
            return patient_id
        log_test("Create patient", False, f"Status {resp.status_code}: {resp.text}")
        return None
    except Exception as e:
        log_test("Create patient", False, str(e))
        return None

def test_list_patients():
    """List patients."""
    try:
        resp = requests.get(f"{BASE_URL}/api/doctors/patients", headers=headers(), timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            patients = data.get("patients", [])
            log_test(f"List patients ({len(patients)} found)", True)
            return patients
        log_test("List patients", False, f"Status {resp.status_code}: {resp.text}")
        return []
    except Exception as e:
        log_test("List patients", False, str(e))
        return []

def test_delete_patient(patient_id):
    """Delete a patient."""
    try:
        resp = requests.delete(
            f"{BASE_URL}/api/doctors/patients/{patient_id}",
            headers=headers(),
            timeout=5
        )
        if resp.status_code == 200:
            log_test("Delete patient", True)
            return True
        log_test("Delete patient", False, f"Status {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log_test("Delete patient", False, str(e))
        return False

def test_create_task():
    """Create a task."""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/doctors/tasks",
            json={"text": "Follow up with patient John", "assignee": "Nurse Smith"},
            headers=headers(),
            timeout=5
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            task_id = data.get("id")
            log_test("Create task", True)
            return task_id
        log_test("Create task", False, f"Status {resp.status_code}: {resp.text}")
        return None
    except Exception as e:
        log_test("Create task", False, str(e))
        return None

def test_list_tasks():
    """List tasks."""
    try:
        resp = requests.get(f"{BASE_URL}/api/doctors/tasks", headers=headers(), timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            tasks = data.get("tasks", [])
            log_test(f"List tasks ({len(tasks)} found)", True)
            return tasks
        log_test("List tasks", False, f"Status {resp.status_code}: {resp.text}")
        return []
    except Exception as e:
        log_test("List tasks", False, str(e))
        return []

def test_update_task(task_id):
    """Mark a task as done."""
    try:
        resp = requests.patch(
            f"{BASE_URL}/api/doctors/tasks/{task_id}",
            json={"done": 1},
            headers=headers(),
            timeout=5
        )
        if resp.status_code == 200:
            log_test("Mark task as done", True)
            return True
        log_test("Mark task as done", False, f"Status {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log_test("Mark task as done", False, str(e))
        return False

def test_delete_task(task_id):
    """Delete a task."""
    try:
        resp = requests.delete(
            f"{BASE_URL}/api/doctors/tasks/{task_id}",
            headers=headers(),
            timeout=5
        )
        if resp.status_code == 200:
            log_test("Delete task", True)
            return True
        log_test("Delete task", False, f"Status {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        log_test("Delete task", False, str(e))
        return False

def test_list_notifications():
    """List notifications."""
    try:
        resp = requests.get(f"{BASE_URL}/api/notifications?user_id={user_id}", headers=headers(), timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            notifs = data.get("notifications", [])
            log_test(f"List notifications ({len(notifs)} found)", True)
            return notifs
        log_test("List notifications", False, f"Status {resp.status_code}: {resp.text}")
        return []
    except Exception as e:
        log_test("List notifications", False, str(e))
        return []

def main():
    global token, user_id
    print("=" * 60)
    print("DASHBOARD SMOKE TEST")
    print("=" * 60)
    
    # Auth flow
    print("\n[Auth]")
    if not test_register():
        print("Registration failed; aborting.")
        sys.exit(1)
    if not test_login():
        print("Login failed; aborting.")
        sys.exit(1)

    # Doctor profile
    print("\n[Doctor Setup]")
    test_doctor_register_profile()

    # Agenda tests
    print("\n[Agenda Endpoints]")
    agenda_id = test_create_agenda()
    today = datetime.now().date()
    test_list_agenda(str(today))
    if agenda_id:
        test_delete_agenda(agenda_id)

    # Patient tests
    print("\n[Patient Endpoints]")
    patient_id = test_create_patient()
    test_list_patients()
    if patient_id:
        test_delete_patient(patient_id)

    # Task tests
    print("\n[Task Endpoints]")
    task_id = test_create_task()
    test_list_tasks()
    if task_id:
        test_update_task(task_id)
        test_delete_task(task_id)

    # Notification tests
    print("\n[Notification Endpoints]")
    test_list_notifications()

    # Summary
    print("\n" + "=" * 60)
    print(f"RESULTS: {results['passed']} passed, {results['failed']} failed")
    print("=" * 60)
    if results["errors"]:
        print("\nErrors:")
        for err in results["errors"]:
            print(f"  - {err}")
    sys.exit(0 if results["failed"] == 0 else 1)

if __name__ == "__main__":
    token = None
    user_id = None
    main()
