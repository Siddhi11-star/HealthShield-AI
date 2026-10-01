# MediGuard — AI-Powered Healthcare Platform

MediGuard is a full-stack healthcare management platform built with a Python Flask backend and a vanilla HTML/CSS/JS frontend. It combines patient management, pharmacy operations, AI-assisted clinical intelligence, telemedicine, and emergency response into a single system.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [API Reference](#api-reference)
- [User Roles](#user-roles)
- [Security Notes](#security-notes)

---

## Project Structure

```
EDIL_merged/
├── frontend/
│   ├── index.html                  ← Single-page application shell
│   ├── script.js                   ← All frontend logic and API calls
│   ├── style.css                   ← Core styles
│   ├── features.js                 ← Feature-specific JS modules
│   ├── features.css                ← Feature-specific styles
│   ├── emergency_quick_access.js   ← Emergency flow JS
│   ├── dashboard-patch.css         ← Dashboard overrides
│   └── fixes.css                   ← Bug-fix style patches
│
└── backend/
    ├── app.py                      ← Flask application entry point, core routes
    ├── config.py                   ← Database connection config
    ├── auth_routes.py              ← Auth route handlers
    ├── auth_utils.py               ← JWT helpers, role decorators
    ├── doctor_portal.py            ← Doctor-specific endpoints
    ├── pharmacy_routes.py          ← Pharmacy search & inventory endpoints
    ├── teleconsult.py              ← Telemedicine (v1)
    ├── teleconsult_v2.py           ← Telemedicine with Zoom integration (v2)
    ├── ai_clinical_intelligence.py ← GPT-powered diagnostics & wellness
    ├── ai_safety_guard.py          ← AI safety validation layer
    ├── ayurveda.py                 ← Ayurvedic medicine module
    ├── emergency_quick_access.py   ← Emergency dispatch system
    ├── notifications_patch.py      ← SMS/push notification helpers
    ├── import_interactions.py      ← Drug interaction data seeder
    ├── import_medicines.py         ← Medicine data seeder
    ├── init_db.py                  ← Database initialiser
    ├── run_backend_no_debug.py     ← Production server launcher
    ├── smoke_test.py               ← Integration smoke tests
    ├── requirements.txt            ← Python dependencies
    ├── schema_features.sql         ← Feature schema definitions
    ├── DATABASE_MIGRATION.sql      ← Migration scripts
    ├── INTEGRATION.md              ← Pharmacy integration guide
    ├── .env                        ← Environment variables (do not commit)
    └── services/
        └── ai_service.py           ← AI provider abstraction layer
```

---

## Tech Stack

| Layer    | Technology                                      |
|----------|-------------------------------------------------|
| Backend  | Python 3.x, Flask, Flask-CORS                   |
| Database | MySQL (via `mysql-connector-python`)            |
| Frontend | HTML5, CSS3, Vanilla JavaScript                 |
| AI       | OpenAI GPT-4 (via `CLINICAL_AI_API_KEY`)        |
| Video    | Zoom Meetings API (telemedicine)                |
| Maps     | OpenStreetMap + Nominatim (pharmacy search)     |
| Auth     | JWT tokens + Google OAuth 2.0                   |
| SMS      | MSG91                                           |
| PDF      | ReportLab, pypdf                                |

---

## Features

### Authentication & Users
- Email/password registration and login with SHA-256 hashed passwords
- Google OAuth 2.0 sign-in
- JWT-based session management
- Role-based access control (admin, doctor, pharmacist, patient, nurse)
- Profile update and password change

### Patient Management
- Create, update, search, and delete patient records
- Patient detail view with full prescription history
- Export patient list to CSV
- Patient PDF report generation
- Patient stats and analytics dashboard

### Prescriptions
- Create prescriptions with automatic drug interaction safety checks
- Export prescriptions to CSV
- Generate prescription PDFs
- Prescription search with filters

### Drug Interaction Checker
- Check interactions between any two drugs
- Bulk-check all active medications for a patient
- Admin-managed interaction knowledge base

### Pharmacy System (3 independent features)
1. **Find Pharmacies by Location** — OpenStreetMap (via the Nominatim geocoding API) returns nearby pharmacies with ratings, hours, and contact info — no API key required
2. **Find Pharmacies by Medicine** — searches the internal `pharmacy_inventory` database to show which pharmacies currently stock a given medicine
3. **Pharmacist Inventory Dashboard** — authenticated pharmacists can view, add to, reduce, or reset the stock levels for their own pharmacy and see low/out-of-stock alerts

### AI Clinical Intelligence
- **Diagnostic analysis**: GPT-powered interpretation of patient symptoms and lab results
- **Wellness plan generation**: personalised health plans based on patient profile
- **Health recommendations**: evidence-based suggestions for a given condition
- All AI output is clearly labelled as decision-support only and requires clinician validation

### Ayurveda Module
- Ayurvedic remedy and wellness information endpoints

### Telemedicine
- Zoom meeting creation and management via the Zoom Server-to-Server OAuth API
- In-app appointment chat between doctor and patient
- Appointment scheduling with time-slot parsing

### Emergency Quick Access
- Trigger emergency case with auto-hospital selection and notification
- Ambulance assignment and real-time case tracking
- Emergency payment processing

### Doctor Portal
- Doctor-specific views: patient lists, appointment queue, prescription history
- Portal patient lookup by name or ID

### Notifications & Alerts
- In-app notification inbox with read/unread state
- SMS notifications via MSG91
- System-level safety alerts and audit logging

### Admin Panel
- User management (list, delete)
- Platform-wide stats and analytics
- Audit log viewer
- System settings (key/value store)

---

## Getting Started

### Prerequisites
- Python 3.9+
- MySQL 8.0+
- A Zoom Server-to-Server OAuth app (for telemedicine)
- An OpenAI API key (for AI clinical features)
- No API key needed for maps — OpenStreetMap/Nominatim is free and open

### 1. Set up the database

```bash
mysql -u root -p < backend/DATABASE_MIGRATION.sql
mysql -u root -p mediguard < backend/schema_features.sql
```

### 2. Configure environment variables

Copy the example below into `backend/.env` and fill in your values:

```bash
# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=mediguard

# JWT
JWT_SECRET=change_this_in_production

# OpenAI (AI clinical intelligence)
CLINICAL_AI_API_KEY=your_openai_key
CLINICAL_AI_MODEL=gpt-4.1-mini

# Zoom (telemedicine)
ZOOM_ACCOUNT_ID=your_zoom_account_id
ZOOM_CLIENT_ID=your_zoom_client_id
ZOOM_CLIENT_SECRET=your_zoom_client_secret

# Google OAuth
GOOGLE_CLIENT_ID=your_google_oauth_client_id

# MSG91 (SMS notifications)
MSG91_AUTHKEY=your_msg91_key
MSG91_TEMPLATE_ID=your_msg91_template_id
```

### 3. Install Python dependencies

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Initialise the database tables

```bash
python init_db.py
```

### 5. Start the backend

```bash
# Development
python app.py

# Production (no debug mode)
python run_backend_no_debug.py
```

The API server starts at **http://localhost:5000** by default.

### 6. Open the frontend

Open `frontend/index.html` directly in a browser, or serve it from Flask by placing it in the correct static path. All API calls are prefixed with `/api/` and target `localhost:5000`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | Yes | MySQL host |
| `DB_USER` | Yes | MySQL username |
| `DB_PASSWORD` | Yes | MySQL password |
| `DB_NAME` | Yes | MySQL database name |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens |
| `CLINICAL_AI_API_KEY` | For AI features | OpenAI API key |
| `CLINICAL_AI_MODEL` | No | Defaults to `gpt-4.1-mini` |
| `CLINICAL_AI_BASE_URL` | No | Defaults to OpenAI endpoint |
| `ZOOM_ACCOUNT_ID` | For telemedicine | Zoom Server-to-Server OAuth |
| `ZOOM_CLIENT_ID` | For telemedicine | Zoom OAuth client ID |
| `ZOOM_CLIENT_SECRET` | For telemedicine | Zoom OAuth client secret |
| `GOOGLE_CLIENT_ID` | For Google login | Google OAuth 2.0 client ID |
| `MSG91_AUTHKEY` | For SMS | MSG91 auth key |
| `MSG91_TEMPLATE_ID` | For SMS | MSG91 SMS template ID |

---

## Database Setup

Tables are created automatically by `ensure_tables()` on first backend start. To run migrations manually:

```bash
mysql -u root -p mediguard < backend/DATABASE_MIGRATION.sql
```

To add the `owner_id` column to the pharmacies table (required for the pharmacist inventory dashboard):

```sql
ALTER TABLE pharmacies ADD COLUMN owner_id INT DEFAULT NULL;
ALTER TABLE pharmacies ADD INDEX idx_pharm_owner (owner_id);
```

To seed drug interaction and medicine data:

```bash
python backend/import_interactions.py
python backend/import_medicines.py
```

---

## API Reference

All endpoints are prefixed with `/api/`. Protected endpoints require the header:

```
Authorization: Bearer mg_token_<user_id>
```

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login and receive a token |
| GET | `/auth/me` | Get the current user |
| POST | `/auth/change-password` | Change password |
| POST | `/auth/update-profile` | Update profile fields |

### Patients
| Method | Endpoint | Description |
|---|---|---|
| GET | `/patients` | List / search patients |
| POST | `/patients` | Create a patient |
| GET | `/patients/:id` | Get patient + prescriptions |
| PUT | `/patients/:id` | Update patient |
| DELETE | `/patients/:id` | Delete patient |
| GET | `/patients/:id/report` | Download PDF report |
| GET | `/patients/export` | Export CSV |

### Prescriptions
| Method | Endpoint | Description |
|---|---|---|
| GET | `/prescriptions` | List all prescriptions |
| POST | `/prescriptions` | Create (auto safety-checks) |
| DELETE | `/prescriptions/:id` | Delete prescription |
| GET | `/prescriptions/:id/pdf` | Download PDF |
| GET | `/prescriptions/export` | Export CSV |

### Drug Interactions
| Method | Endpoint | Description |
|---|---|---|
| GET | `/drug-interactions` | List all known interactions |
| POST | `/drug-interactions` | Add an interaction |
| DELETE | `/drug-interactions/:id` | Remove an interaction |
| POST | `/drug-interactions/check` | Check two drug names |
| GET | `/drug-interactions/bulk-check/:patient_id` | Check all meds for a patient |

### Inventory
| Method | Endpoint | Description |
|---|---|---|
| GET | `/inventory` | List all inventory items |
| POST | `/inventory` | Add / update stock |
| PATCH | `/inventory/:id/restock` | Add quantity |
| PATCH | `/inventory/:id/adjust` | Adjust quantity |

### Pharmacy
| Method | Endpoint | Description |
|---|---|---|
| GET | `/places/search?query=...` | Find pharmacies by location (OpenStreetMap / Nominatim) |
| GET | `/inventory/live?medicine=...` | Find pharmacies stocking a medicine |
| GET | `/my-pharmacy/inventory` | Pharmacist: view own stock |
| POST | `/my-pharmacy/update-stock` | Pharmacist: set absolute quantity |
| POST | `/my-pharmacy/increase-stock` | Pharmacist: add units |
| POST | `/my-pharmacy/decrease-stock` | Pharmacist: remove units |
| GET | `/my-pharmacy/get-alerts` | Pharmacist: low/out-of-stock alerts |
| POST | `/my-pharmacy/initialize-stock` | Pharmacist: seed default stock |

### Appointments
| Method | Endpoint | Description |
|---|---|---|
| GET | `/appointments` | List appointments |
| POST | `/appointments` | Book appointment |
| PATCH | `/appointments/:id` | Update appointment |
| DELETE | `/appointments/:id` | Cancel appointment |
| GET/POST | `/appointments/:id/chat` | Appointment chat messages |

### Telemedicine
| Method | Endpoint | Description |
|---|---|---|
| POST | `/teleconsult/create` | Create a Zoom meeting |

### AI Clinical Intelligence
| Method | Endpoint | Description |
|---|---|---|
| POST | `/ai/diagnose` | Analyse symptoms / lab results |
| POST | `/ai/wellness-plan` | Generate personalised wellness plan |
| POST | `/ai/recommendation` | Get health recommendations |

### Emergency
| Method | Endpoint | Description |
|---|---|---|
| POST | `/emergency/trigger` | Trigger an emergency case |
| POST | `/hospital/select` | Select responding hospital |
| POST | `/hospital/notify` | Notify the hospital |
| GET | `/emergency/case/:case_id` | Track emergency case |
| POST | `/emergency/payment` | Process emergency payment |
| POST | `/ambulance/assign` | Assign ambulance |
| GET | `/ambulance/track/:case_id` | Track ambulance |

### Admin
| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/users` | List all users |
| DELETE | `/admin/users/:id` | Delete a user |
| GET | `/admin/stats` | Platform-wide statistics |
| GET | `/admin/audit-log` | View audit log |
| GET | `/admin/summary` | Summary counts and uptime |

### Miscellaneous
| Method | Endpoint | Description |
|---|---|---|
| GET | `/stats` | Homepage counts |
| GET | `/analytics` | Analytics data |
| GET | `/notifications` | Inbox |
| PATCH | `/notifications/:id/read` | Mark notification as read |
| GET | `/health` | Health check / ping |
| GET | `/health-tips` | Health tip content |

---

## User Roles

| Role | Description |
|---|---|
| `admin` | Full access to all endpoints and admin panel |
| `doctor` | Patient management, prescriptions, appointments |
| `pharmacist` | Own pharmacy inventory management |
| `nurse` | Patient records and appointment support |
| `patient` | Portal access to own records and appointments |

---

## Security Notes

- **Never commit `.env`** — it contains database credentials, API keys, and secrets.
- Change `JWT_SECRET` from the default before deploying to production.
- Nominatim (OpenStreetMap) is free and requires no API key — respect its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) by setting a descriptive `User-Agent` header in requests.
- All pharmacist inventory endpoints verify `owner_id` so pharmacists cannot modify other pharmacies.
- AI clinical output is decorated with a mandatory disclaimer and is not a substitute for professional medical advice.
- Run `smoke_test.py` after deployment to verify core endpoints are operational.