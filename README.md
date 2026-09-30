# MediGuard AI — Full Stack Setup

## Project Structure
```
medigaurd-full/
├── frontend/
│   ├── index.html   ← Main HTML (open this directly OR serve via backend)
│   ├── style.css    ← All styles
│   └── script.js    ← All frontend logic + API calls
└── backend/
    ├── server.js    ← Express API server
    ├── package.json
    └── medigaurd.db ← SQLite database (auto-created on first run)
```

---

## Quick Start

### 1. Install backend dependencies
```bash
cd backend
npm install
```

### 2. Start the server
```bash
npm start
```
Server starts at **http://localhost:3000**

The backend serves the frontend automatically — just open http://localhost:3000

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Create new user account |
| POST | /api/auth/login | Login and get JWT token |
| GET | /api/auth/me | Get current user (requires token) |

### Patients
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/patients | List all patients (auth required) |
| GET | /api/patients?search=name | Search patients |
| GET | /api/patients/:id | Get patient + prescriptions |
| POST | /api/patients | Create patient |
| DELETE | /api/patients/:id | Delete patient |

### Prescriptions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/prescriptions | All prescriptions |
| POST | /api/prescriptions | Create + auto safety-check |

### Inventory
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/inventory | All inventory items |
| POST | /api/inventory | Add/update stock |
| PATCH | /api/inventory/:id/restock | Add quantity |

### Drug Interactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/drug-interactions | All known interactions |
| POST | /api/drug-interactions/check | Check two drugs |
| POST | /api/drug-interactions | Add new interaction |

### Stats
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/stats | Counts for homepage |

---

## Database
SQLite database auto-created at `backend/medigaurd.db`

**Pre-seeded with:**
- 15 known dangerous drug interactions
- 8 sample inventory items
- No patients (add via dashboard)

---

## Demo Credentials
Register any account via the Login modal — first registered user becomes the admin.

---

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| JWT_SECRET | medigaurd_secret_key_2024 | JWT signing secret (change in production!) |
