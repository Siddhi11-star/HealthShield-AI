-- ════════════════════════════════════════════════════════════════════
-- DATABASE MIGRATION SCRIPT
-- ════════════════════════════════════════════════════════════════════
-- For: MediGuard Pharmacy System Update
-- Date: April 2026
-- ════════════════════════════════════════════════════════════════════

-- Use your mediguard database
USE mediguard;

-- ────────────────────────────────────────────────────────────────────
-- STEP 1: Add owner_id column to pharmacies table
-- ────────────────────────────────────────────────────────────────────

-- Check if column already exists
ALTER TABLE pharmacies ADD COLUMN owner_id INT DEFAULT NULL;
ALTER TABLE pharmacies ADD INDEX idx_pharm_owner (owner_id);

-- ────────────────────────────────────────────────────────────────────
-- STEP 2: Verify pharmacy_inventory table exists with correct structure
-- ────────────────────────────────────────────────────────────────────

-- If pharmacy_inventory doesn't exist, create it:
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

-- ────────────────────────────────────────────────────────────────────
-- STEP 3: Seed sample data if needed
-- ────────────────────────────────────────────────────────────────────

-- If you want to test with sample data, run:
-- (This adds 5 test pharmacies with owner_id = NULL for now)

INSERT IGNORE INTO pharmacies 
(owner_id, name, address, area, city, state, pincode, phone, latitude, longitude, open_hours, is_24hr, has_delivery, rating)
VALUES
(NULL, 'Apollo Pharmacy – Koregaon Park', 'North Main Road, Koregaon Park, Pune', 'Koregaon Park', 'Pune', 'Maharashtra', '411001', '020-26120002', 18.5370, 73.8950, '8:00 AM – 10:00 PM', 0, 1, 4.5),
(NULL, '24Hr LifeCare Pharmacy – Kalyani Nagar', 'Wanowrie Road, Kalyani Nagar, Pune', 'Kalyani Nagar', 'Pune', 'Maharashtra', '411006', '020-27130002', 18.5450, 73.9032, '24 Hours', 1, 1, 4.6),
(NULL, 'Apollo Pharmacy – Shivajinagar', 'FC Road, Shivajinagar, Pune', 'Shivajinagar', 'Pune', 'Maharashtra', '411005', '020-25513001', 18.5308, 73.8474, '8:00 AM – 10:00 PM', 0, 1, 4.8),
(NULL, 'Netmeds Pharmacy – Aundh', 'ITI Road, Aundh, Pune', 'Aundh', 'Pune', 'Maharashtra', '411007', '020-25893001', 18.5642, 73.8197, '8:00 AM – 10:00 PM', 0, 1, 4.6),
(NULL, 'CVS Pharmacy – Wakad', 'Kalyani Nagar Flyover, Wakad, Pune', 'Wakad', 'Pune', 'Maharashtra', '411057', '020-42340022', 18.5896, 73.8850, '8:00 AM – 11:00 PM', 0, 1, 4.4);

-- ────────────────────────────────────────────────────────────────────
-- STEP 4: Verify medicines table exists
-- ────────────────────────────────────────────────────────────────────

-- If medicines table doesn't exist, create it:
CREATE TABLE IF NOT EXISTS medicines (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(200) NOT NULL UNIQUE,
    generic_name    VARCHAR(200),
    category        VARCHAR(100),
    form            VARCHAR(50),
    strength        VARCHAR(50),
    dosage          VARCHAR(100),
    manufacturer    VARCHAR(200),
    unit_price      DECIMAL(10,2) DEFAULT 0.00,
    description     TEXT,
    side_effects    TEXT,
    precautions     TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_med_name (name),
    INDEX idx_med_category (category)
);

-- ────────────────────────────────────────────────────────────────────
-- STEP 5: Create tables for users (if not exists)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    email           VARCHAR(200) UNIQUE NOT NULL,
    password        VARCHAR(255) NOT NULL,
    role            VARCHAR(50) DEFAULT 'patient',
    phone           VARCHAR(30),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_email (email),
    INDEX idx_user_role (role)
);

-- ────────────────────────────────────────────────────────────────────
-- STEP 7: Create notifications table for doctor alerts
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,           -- Doctor or admin user ID
    type            VARCHAR(50) NOT NULL,   -- 'appointment', 'consultation', 'alert'
    title           VARCHAR(200) NOT NULL,
    message         TEXT,
    data            JSON,                   -- Additional data (appointment_id, consultation_id, etc.)
    is_read         TINYINT(1) DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notif_user (user_id),
    INDEX idx_notif_type (type),
    INDEX idx_notif_read (is_read)
);

INSERT IGNORE INTO users (name, email, password, role, phone)
VALUES
('Dr. Amit Singh', 'doctor@example.com', '482c811da5d5b4bc6d497ffa98491e38', 'doctor', '9876543210'),
('Priya Pharmacist', 'priya@pharmacy.com', '482c811da5d5b4bc6d497ffa98491e38', 'pharmacist', '9876543211'),
('Admin User', 'admin@mediguard.com', '482c811da5d5b4bc6d497ffa98491e38', 'admin', '9876543212'),
('John Patient', 'patient@example.com', '482c811da5d5b4bc6d497ffa98491e38', 'patient', '9876543213');

-- ────────────────────────────────────────────────────────────────────
-- STEP 7: Verify all indexes are in place
-- ────────────────────────────────────────────────────────────────────

-- Show the pharmacies table structure
SHOW CREATE TABLE pharmacies\G

-- Show the pharmacy_inventory table structure
SHOW CREATE TABLE pharmacy_inventory\G

-- Show the users table structure
SHOW CREATE TABLE users\G

-- ════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ════════════════════════════════════════════════════════════════════

-- Check if owner_id column exists and is indexed
SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'pharmacies' AND COLUMN_NAME = 'owner_id';

-- Check all indexes on pharmacies table
SELECT * FROM INFORMATION_SCHEMA.STATISTICS 
WHERE TABLE_NAME = 'pharmacies';

-- Count total pharmacies
SELECT COUNT(*) as total_pharmacies FROM pharmacies;

-- Count pharmacies with owner_id (registered by pharmacists)
SELECT COUNT(*) as owned_pharmacies FROM pharmacies WHERE owner_id IS NOT NULL;

-- Count all medicines
SELECT COUNT(*) as total_medicines FROM medicines;

-- Check pharmacy_inventory has correct structure
DESCRIBE pharmacy_inventory;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed)
-- ════════════════════════════════════════════════════════════════════

-- To undo all changes and revert to previous state, use:
/*
ALTER TABLE pharmacies DROP COLUMN owner_id;
ALTER TABLE pharmacies DROP INDEX idx_pharm_owner;
DROP TABLE IF EXISTS pharmacy_inventory;

-- This will restore the original state
*/

-- ════════════════════════════════════════════════════════════════════
-- END OF MIGRATION SCRIPT
-- ════════════════════════════════════════════════════════════════════
