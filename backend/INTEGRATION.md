# MediGuard Pharmacy System - UPDATED INTEGRATION GUIDE

## Overview of Changes

This update implements THREE separate pharmacy features with clear separation of concerns:

### Feature 1: FIND PHARMACIES BY PLACE (Google Maps API)
- **Location**: Frontend → Backend → Google Maps API
- **Data Source**: Google Maps Places API (NOT database)
- **What It Shows**: Pharmacy name, address, rating, phone, hours
- **Does NOT Show**: Internal stock information
- **API Endpoint**: `/api/places/search?query=<location>`

### Feature 2: FIND PHARMACIES BY MEDICINE (Database)
- **Location**: Frontend → Backend Database
- **Data Source**: `pharmacy_inventory` table
- **What It Shows**: Pharmacy name, address, medicine stock levels
- **Does NOT Show**: Google Maps integration
- **API Endpoint**: `/api/inventory/live?medicine=<medicine_name>`

### Feature 3: PHARMACIST INVENTORY DASHBOARD (Pharmacist Only)
- **Location**: Dashboard page (for logged-in pharmacists)
- **Access Control**: `owner_id` in pharmacies table + authentication
- **Features**:
  - View all medicines in their pharmacy
  - Update stock quantities
  - See low stock / out of stock alerts
- **API Endpoints**:
  - `GET /api/my-pharmacy/inventory` - View inventory
  - `POST /api/my-pharmacy/update-stock` - Update quantity
  - `POST /api/my-pharmacy/increase-stock` - Add units
  - `POST /api/my-pharmacy/decrease-stock` - Remove units
  - `GET /api/my-pharmacy/get-alerts` - Get stock alerts
  - `POST /api/my-pharmacy/initialize-stock` - Initialize default stock

---

## Installation Instructions

### 1. DATABASE SCHEMA UPDATES

Add the `owner_id` field to the pharmacies table:

```sql
ALTER TABLE pharmacies ADD COLUMN owner_id INT DEFAULT NULL;
ALTER TABLE pharmacies ADD INDEX idx_pharm_owner (owner_id);
```

If the pharmacies table needs to be recreated, use:

```sql
CREATE TABLE IF NOT EXISTS pharmacies (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    owner_id        INT DEFAULT NULL,
    name            VARCHAR(200) NOT NULL,
    address         TEXT,
    area            VARCHAR(100),
    city            VARCHAR(100) DEFAULT 'Pune',
    state           VARCHAR(50)  DEFAULT 'Maharashtra',
    pincode         VARCHAR(10),
    phone           VARCHAR(30),
    latitude        DECIMAL(10,7),
    longitude       DECIMAL(10,7),
    open_hours      VARCHAR(100) DEFAULT '8:00 AM – 10:00 PM',
    is_24hr         TINYINT(1)   DEFAULT 0,
    has_delivery    TINYINT(1)   DEFAULT 0,
    rating          DECIMAL(3,2) DEFAULT 4.00,
    license_no      VARCHAR(100),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pharm_area (area),
    INDEX idx_pharm_owner (owner_id)
);

CREATE TABLE IF NOT EXISTS pharmacy_inventory (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    pharmacy_id     INT NOT NULL,
    medicine_name   VARCHAR(200) NOT NULL,
    generic_name    VARCHAR(200),
    quantity        INT DEFAULT 0,
    unit_price      DECIMAL(10,2) DEFAULT 0.00,
    is_available    TINYINT(1) DEFAULT 1,
    last_updated    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_pharm_med (pharmacy_id, medicine_name),
    FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE,
    INDEX idx_inv_pharmacy (pharmacy_id),
    INDEX idx_inv_medicine (medicine_name)
);
```

### 2. ENVIRONMENT VARIABLES

Update your `.env` file:

```bash
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=1234
DB_NAME=mediguard

# Google Maps API Key (REQUIRED for place search)
GOOGLE_MAPS_API_KEY=AIzaSyCI63fhDphtk84JeAYweIp-kSqlqiXP5Oc

# Zoom Configuration (for telemedicine)
ZOOM_ACCOUNT_ID=zklvjtbpSuydl8w0rzQjww
ZOOM_CLIENT_ID=l10rPJNSVuSELC9NDgh6w
ZOOM_CLIENT_SECRET=L4p3cuh0wU1tNt3mvGUau2TiWbu4PfEH
```

### 3. BACKEND FILE UPDATES

Replace the following files in `mediguard-backend/`:

1. **pharmacy_routes.py** - COMPLETE REPLACEMENT
   - New implementation with all three features
   - Proper authentication and authorization
   - Google Maps API integration

2. **app.py** - ADD these changes:
   - Add `owner_id` column to pharmacies table creation in `ensure_tables()`
   - Update pharmacy registration to accept `owner_id`
   - After pharmacy registration, call stock initialization

### 4. FRONTEND FILE UPDATES

Update these files in `mediguard_frontend/`:

1. **script.js** - ADD these functions:
   - `searchPharmaciesByPlace()` - Updated to use new API
   - `searchPharmByMedicine()` - Updated to use new API
   - `loadPharmacistInventory()` - NEW
   - `updatePharmacyStock()` - NEW
   - `increasePharmacyStock()` - NEW
   - `decreasePharmacyStock()` - NEW
   - `loadStockAlerts()` - NEW

2. **index.html** - SECTIONS ALREADY EXIST
   - Pharmacy Finder (Find by Place) - Uses updated API
   - Medicine Finder (Find by Medicine) - Uses updated API
   - Inventory Dashboard - Enhanced for pharmacist-only access

3. **style.css** - ADD these styles:
   - `.pharm-inventory-controls` - Control buttons
   - `.stock-alert-banner` - Alert styling
   - `.inventory-action-btn` - Action button styling

---

## API Endpoint Reference

### 1. PLACE-BASED SEARCH

**Endpoint**: `GET /api/places/search?query=<location>`

**Request**:
```javascript
GET /api/places/search?query=Koregaon+Park,+Pune
```

**Response**:
```json
{
  "results": [
    {
      "id": "ChIJ...",
      "name": "Apollo Pharmacy",
      "address": "123 Main Road, Pune",
      "latitude": 18.5370,
      "longitude": 73.8950,
      "rating": 4.5,
      "user_ratings_total": 120,
      "phone": "020-1234567",
      "open_now": true,
      "open_hours": "Open ⋅ Closes 10:00 PM",
      "business_status": "OPERATIONAL"
    }
  ],
  "center": {
    "lat": 18.5370,
    "lng": 73.8950
  },
  "total_results": 1,
  "query": "Koregaon Park, Pune"
}
```

### 2. MEDICINE-BASED SEARCH

**Endpoint**: `GET /api/inventory/live?medicine=<medicine_name>`

**Request**:
```javascript
GET /api/inventory/live?medicine=Paracetamol
```

**Response**:
```json
{
  "pharmacies": [
    {
      "id": 1,
      "name": "Apollo Pharmacy",
      "address": "123 Main Road, Pune",
      "phone": "020-1234567",
      "latitude": 18.5370,
      "longitude": 73.8950,
      "area": "Koregaon Park",
      "rating": 4.5,
      "is_24hr": 0,
      "has_delivery": 1,
      "medicine_name": "Paracetamol",
      "quantity": 45,
      "stock_status": "in_stock",
      "category": "Pain Relief",
      "form": "Tablet",
      "manufacturer": "Cipla"
    }
  ],
  "medicine": "Paracetamol",
  "total_found": 5
}
```

### 3. PHARMACIST INVENTORY MANAGEMENT

#### Get All Medicines in Pharmacy

**Endpoint**: `GET /api/my-pharmacy/inventory`

**Headers**: `Authorization: Bearer mg_token_<user_id>`

**Response**:
```json
{
  "inventory": [
    {
      "id": 1,
      "pharmacy_id": 1,
      "medicine_name": "Paracetamol",
      "quantity": 45,
      "category": "Pain Relief",
      "form": "Tablet",
      "manufacturer": "Cipla",
      "dosage": "500mg",
      "stock_status": "in_stock"
    }
  ],
  "pharmacy_id": 1,
  "pharmacy_name": "Apollo Pharmacy",
  "total_items": 150
}
```

#### Update Stock (Set Absolute Quantity)

**Endpoint**: `POST /api/my-pharmacy/update-stock`

**Headers**: `Authorization: Bearer mg_token_<user_id>`

**Body**:
```json
{
  "inventory_id": 1,
  "quantity": 50
}
```

**Response**:
```json
{
  "success": true,
  "message": "Stock updated successfully",
  "inventory_id": 1,
  "new_quantity": 50
}
```

#### Increase Stock (Add Units)

**Endpoint**: `POST /api/my-pharmacy/increase-stock`

**Body**:
```json
{
  "inventory_id": 1,
  "amount": 10
}
```

#### Decrease Stock (Remove Units)

**Endpoint**: `POST /api/my-pharmacy/decrease-stock`

**Body**:
```json
{
  "inventory_id": 1,
  "amount": 5
}
```

#### Get Stock Alerts

**Endpoint**: `GET /api/my-pharmacy/get-alerts`

**Response**:
```json
{
  "low_stock_count": 5,
  "out_of_stock_count": 2,
  "alerts": [
    {
      "id": 1,
      "medicine_name": "Aspirin",
      "quantity": 0,
      "status": "out_of_stock"
    },
    {
      "id": 2,
      "medicine_name": "Ibuprofen",
      "quantity": 15,
      "status": "low_stock"
    }
  ]
}
```

#### Initialize Default Stock

**Endpoint**: `POST /api/my-pharmacy/initialize-stock`

**Description**: Sets all medicines to 20 units in pharmacist's pharmacy

**Response**:
```json
{
  "success": true,
  "message": "Initialized 250 medicines with 20 units each",
  "inserted_count": 250,
  "default_quantity": 20
}
```

---

## Frontend Implementation Notes

### Pharmacy Finder (Find by Place)

```javascript
async function searchPharmaciesByPlace(query) {
  const data = await api('GET', '/places/search?query=' + encodeURIComponent(query));
  // data.pharmacies contains pharmacy list
  // data.center contains center coordinates for map
  // Map and display using Google Maps SDK
}
```

### Medicine Finder (Find by Medicine)

```javascript
async function searchPharmByMedicine(medicine) {
  const data = await api('GET', '/inventory/live?medicine=' + encodeURIComponent(medicine));
  // data.pharmacies contains pharmacy list with stock levels
  // data.medicine contains search medicine name
  // Display in grid with stock status
}
```

### Pharmacist Inventory Dashboard

```javascript
// Check if user is pharmacist
if (currentUser.role === 'pharmacist' || currentUser.role === 'admin') {
  // Show inventory management section
  loadPharmacistInventory();
}

async function loadPharmacistInventory() {
  const data = await api('GET', '/my-pharmacy/inventory');
  // Display in table with update controls
}

async function updatePharmacyStock(inventoryId, newQuantity) {
  const response = await api('POST', '/my-pharmacy/update-stock', {
    inventory_id: inventoryId,
    quantity: newQuantity
  });
}
```

---

## Security Considerations

1. **Authentication**: All pharmacist endpoints require `Authorization: Bearer mg_token_<user_id>`
2. **Ownership Verification**: Backend verifies `owner_id` matches the authenticated user
3. **Google Maps API Key**: Should be kept in `.env` file (never commit to git)
4. **CORS**: Already configured in Flask app
5. **Input Validation**: All endpoints validate input parameters

---

## Testing Checklist

- [ ] Register a pharmacist user
- [ ] Create a pharmacy with `owner_id` set to pharmacist's user ID
- [ ] Search by place (e.g., "Koregaon Park, Pune")
- [ ] Search by medicine (e.g., "Paracetamol")
- [ ] View inventory in pharmacist dashboard
- [ ] Increase stock
- [ ] Decrease stock
- [ ] Check stock alerts display correctly
- [ ] Verify non-pharmacists cannot access inventory endpoints
- [ ] Verify pharmacists cannot modify other pharmacies' stock

---

## Troubleshooting

### "Google Maps API key not configured"
- Add `GOOGLE_MAPS_API_KEY` to `.env` file
- Restart the Flask server

### "You are not registered as a pharmacy"
- The logged-in user doesn't have a pharmacy record
- Check that `owner_id` in pharmacies table matches the user ID

### "You do not own this pharmacy"
- The user is trying to modify a pharmacy they don't own
- Verify correct pharmacy ownership

### Empty results from place search
- Google Maps quota might be exceeded
- Check API key is valid in Google Cloud Console
- Verify query is valid (e.g., "Pune, India")

---

## Migration from Old System

If migrating from the old system:

1. Run the database schema update to add `owner_id` column
2. Update `.env` file with Google Maps API key
3. Replace `pharmacy_routes.py` completely
4. Update `app.py` with the new table creation logic
5. Update frontend files with new functions
6. Test all three features before going live

---

## Future Enhancements

- Add batch stock update capability
- Implement inventory history/audit logs
- Add low stock alerts via email/SMS
- Integrate with POS systems for automatic stock deduction
- Add inventory forecasting based on sales trends
