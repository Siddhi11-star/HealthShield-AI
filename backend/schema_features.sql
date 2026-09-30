-- ════════════════════════════════════════════════════════════════
--  MediGuard AI — Feature Additions
--  1) Teleconsultation (Zoom-integrated)
--  2) Live Pharmacy Inventory (Pune Dataset + Google Maps)
--  Run once against your `mediguard` database.
-- ════════════════════════════════════════════════════════════════

USE mediguard;

-- ── 1. Consultations (Zoom meetings) ────────────────────────────
CREATE TABLE IF NOT EXISTS consultations (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id      INT DEFAULT NULL,
    patient_name        VARCHAR(200),
    patient_phone       VARCHAR(30),
    doctor_name         VARCHAR(200),
    doctor_id           INT DEFAULT NULL,
    specialty           VARCHAR(100),
    zoom_meeting_id     VARCHAR(100),
    zoom_join_url       TEXT,
    zoom_start_url      TEXT,
    zoom_password       VARCHAR(50),
    zoom_meeting_topic  VARCHAR(300),
    status              VARCHAR(30) DEFAULT 'scheduled',
    scheduled_at        DATETIME,
    started_at          DATETIME,
    ended_at            DATETIME,
    duration_minutes    INT DEFAULT NULL,
    notes               TEXT,
    diagnosis           TEXT,
    prescription_issued TEXT,
    follow_up_date      DATE DEFAULT NULL,
    mode                VARCHAR(20) DEFAULT 'video',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_con_apt    (appointment_id),
    INDEX idx_con_doctor (doctor_id),
    INDEX idx_con_status (status)
);

-- ── 2. Doctors table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctors (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(200) NOT NULL,
    specialty    VARCHAR(100),
    qualification VARCHAR(200),
    experience_yrs INT DEFAULT 0,
    phone        VARCHAR(30),
    email        VARCHAR(200),
    avatar_initials VARCHAR(5),
    avatar_color VARCHAR(50) DEFAULT '#3b82f6',
    status       VARCHAR(20) DEFAULT 'available',
    rating       DECIMAL(3,2) DEFAULT 4.50,
    consult_fee  DECIMAL(10,2) DEFAULT 300.00,
    zoom_user_id VARCHAR(200) DEFAULT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed doctors
INSERT IGNORE INTO doctors (id, name, specialty, qualification, experience_yrs, phone, email, avatar_initials, avatar_color, status, rating, consult_fee)
VALUES
(1,  'Dr. Rahul Sharma',     'General Physician',  'MBBS, MD',           12, '9876543210', 'rahul@mediguard.in',  'RS', 'linear-gradient(135deg,#3b82f6,#2563eb)', 'available', 4.8, 300),
(2,  'Dr. Priya Kulkarni',   'Pediatrician',       'MBBS, DCH',           8, '9876543211', 'priya@mediguard.in',  'PK', 'linear-gradient(135deg,#22c55e,#16a34a)', 'available', 4.9, 400),
(3,  'Dr. Anil Mehta',       'Cardiologist',       'MBBS, MD, DM',       15, '9876543212', 'anil@mediguard.in',   'AM', 'linear-gradient(135deg,#a855f7,#9333ea)', 'busy',      4.7, 600),
(4,  'Dr. Sneha Joshi',      'Dermatologist',      'MBBS, MD Derma',      7, '9876543213', 'sneha@mediguard.in',  'SJ', 'linear-gradient(135deg,#f97316,#ea580c)', 'available', 4.6, 450),
(5,  'Dr. Vijay Rao',        'Diabetologist',      'MBBS, MD, FRCP',     10, '9876543214', 'vijay@mediguard.in',  'VR', 'linear-gradient(135deg,#06b6d4,#0891b2)', 'available', 4.9, 500),
(6,  'Dr. Meera Patil',      'Gynaecologist',      'MBBS, MS OBG',       14, '9876543215', 'meera@mediguard.in',  'MP', 'linear-gradient(135deg,#ec4899,#db2777)', 'available', 4.8, 550),
(7,  'Dr. Sanjay Deshmukh',  'Orthopaedic',        'MBBS, MS Ortho',     18, '9876543216', 'sanjay@mediguard.in', 'SD', 'linear-gradient(135deg,#84cc16,#65a30d)', 'available', 4.7, 500),
(8,  'Dr. Kavita Nair',      'Neurologist',        'MBBS, MD, DM Neuro',  9, '9876543217', 'kavita@mediguard.in', 'KN', 'linear-gradient(135deg,#f59e0b,#d97706)', 'offline',   4.5, 700);

-- ── 3. Pharmacies (Pune Dataset) ────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacies (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    address     TEXT,
    area        VARCHAR(100),
    city        VARCHAR(100) DEFAULT 'Pune',
    state       VARCHAR(50)  DEFAULT 'Maharashtra',
    pincode     VARCHAR(10),
    phone       VARCHAR(30),
    latitude    DECIMAL(10,7),
    longitude   DECIMAL(10,7),
    open_hours  VARCHAR(100) DEFAULT '8:00 AM – 10:00 PM',
    is_24hr     TINYINT(1)   DEFAULT 0,
    has_delivery TINYINT(1)  DEFAULT 0,
    rating      DECIMAL(3,2) DEFAULT 4.00,
    license_no  VARCHAR(100),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pharm_area (area)
);

-- Seed 30 Pune pharmacies with real-ish coordinates
INSERT IGNORE INTO pharmacies
    (id, name, address, area, pincode, phone, latitude, longitude, open_hours, is_24hr, has_delivery, rating)
VALUES
-- Koregaon Park
(1,  'Apollo Pharmacy – Koregaon Park',      'Lane 5, Koregaon Park, Pune',           'Koregaon Park', '411001', '020-26120001', 18.5362, 73.8939, '7:00 AM – 11:00 PM', 0, 1, 4.7),
(2,  'MedPlus Pharmacy – North Main Road',   'North Main Road, Koregaon Park, Pune',  'Koregaon Park', '411001', '020-26120002', 18.5370, 73.8950, '8:00 AM – 10:00 PM', 0, 1, 4.5),
-- Kalyani Nagar
(3,  'Janaushadhi Kendra – Kalyani Nagar',   'Nagar Road, Kalyani Nagar, Pune',       'Kalyani Nagar', '411006', '020-27130001', 18.5465, 73.9019, '9:00 AM –  9:00 PM', 0, 0, 4.3),
(4,  '24Hr LifeCare Pharmacy – Kalyani Ngr', 'Wanowrie Road, Kalyani Nagar, Pune',    'Kalyani Nagar', '411006', '020-27130002', 18.5450, 73.9032, '24 Hours',           1, 1, 4.6),
-- Shivajinagar
(5,  'Apollo Pharmacy – Shivajinagar',       'FC Road, Shivajinagar, Pune',           'Shivajinagar',  '411005', '020-25513001', 18.5308, 73.8474, '8:00 AM – 10:00 PM', 0, 1, 4.8),
(6,  'Arogya Medical – Shivajinagar',        'University Road, Shivajinagar, Pune',   'Shivajinagar',  '411005', '020-25513002', 18.5295, 73.8460, '7:30 AM – 11:00 PM', 0, 0, 4.4),
-- Kothrud
(7,  'MedPlus Pharmacy – Kothrud',           'Paud Road, Kothrud, Pune',              'Kothrud',       '411029', '020-25383001', 18.5074, 73.8077, '8:00 AM – 10:00 PM', 0, 1, 4.5),
(8,  'Health Point Pharmacy – Kothrud',      'Karve Road, Kothrud, Pune',             'Kothrud',       '411038', '020-25383002', 18.5050, 73.8055, '8:00 AM –  9:00 PM', 0, 0, 4.2),
-- Aundh
(9,  'Netmeds Pharmacy – Aundh',             'ITI Road, Aundh, Pune',                 'Aundh',         '411007', '020-25893001', 18.5642, 73.8197, '8:00 AM – 10:00 PM', 0, 1, 4.6),
(10, 'Sai Medicos – Aundh',                  'Aundh Road, Near D-Mart, Pune',         'Aundh',         '411007', '020-25893002', 18.5629, 73.8175, '7:00 AM – 11:00 PM', 0, 0, 4.3),
-- Wakad
(11, 'Apollo Pharmacy – Wakad',              'Wakad-Hinjewadi Road, Wakad, Pune',     'Wakad',         '411057', '020-27500001', 18.5993, 73.7601, '8:00 AM –  9:00 PM', 0, 1, 4.4),
(12, 'Medkart Pharmacy – Wakad',             'Mumbai-Pune Expressway, Wakad, Pune',   'Wakad',         '411057', '020-27500002', 18.5980, 73.7580, '9:00 AM –  9:00 PM', 0, 0, 4.1),
-- Hinjewadi (IT Hub)
(13, 'LifeCare 24Hr Pharmacy – Hinjewadi',   'Phase 1, Hinjewadi, Pune',              'Hinjewadi',     '411057', '020-22929001', 18.5921, 73.7384, '24 Hours',           1, 1, 4.7),
(14, 'Pharmeasy Store – Hinjewadi',          'Phase 2 Road, Hinjewadi, Pune',         'Hinjewadi',     '411057', '020-22929002', 18.5905, 73.7368, '8:00 AM – 11:00 PM', 0, 1, 4.5),
-- Magarpatta / Hadapsar
(15, 'Apollo Pharmacy – Magarpatta',         'Magarpatta City, Hadapsar, Pune',       'Magarpatta',    '411028', '020-26890001', 18.5099, 73.9270, '8:00 AM – 10:00 PM', 0, 1, 4.8),
(16, 'Medline Pharmacy – Hadapsar',          'Solapur Road, Hadapsar, Pune',          'Hadapsar',      '411028', '020-26890002', 18.5018, 73.9267, '7:00 AM – 11:00 PM', 0, 0, 4.4),
-- Camp / MG Road
(17, 'Wilson Garden Pharmacy – Camp',        'MG Road, Camp, Pune',                   'Camp',          '411001', '020-26130001', 18.5180, 73.8815, '8:00 AM – 10:00 PM', 0, 0, 4.6),
(18, 'Deccan Medical Stores – Camp',         'East Street, Camp, Pune',               'Camp',          '411001', '020-26130002', 18.5170, 73.8800, '9:00 AM –  9:00 PM', 0, 1, 4.3),
-- Sadashiv Peth / Kasba
(19, 'Kasba Pharmacy – Sadashiv Peth',       'Tilak Road, Sadashiv Peth, Pune',       'Sadashiv Peth', '411030', '020-24452001', 18.5089, 73.8475, '8:00 AM –  9:00 PM', 0, 0, 4.2),
(20, 'Tilak Medicals – Kasba Peth',          'Kasba Peth, Near Ganpati Temple, Pune', 'Kasba Peth',    '411011', '020-24452002', 18.5095, 73.8569, '7:30 AM – 10:30 PM', 0, 0, 4.4),
-- Viman Nagar
(21, 'MedPlus – Viman Nagar',                'Viman Nagar Road, Near Phoenix, Pune',  'Viman Nagar',   '411014', '020-26630001', 18.5679, 73.9143, '8:00 AM – 11:00 PM', 0, 1, 4.7),
(22, 'HealthMart – Viman Nagar',             'Clover Center, Viman Nagar, Pune',      'Viman Nagar',   '411014', '020-26630002', 18.5665, 73.9120, '24 Hours',           1, 1, 4.9),
-- Kharadi
(23, 'Kharadi LifeCare Pharmacy',            'Kharadi Bypass, Kharadi, Pune',         'Kharadi',       '411014', '020-27460001', 18.5497, 73.9422, '8:00 AM – 10:00 PM', 0, 1, 4.5),
(24, 'NetMeds Express – Kharadi',            'EON IT Park Road, Kharadi, Pune',       'Kharadi',       '411014', '020-27460002', 18.5512, 73.9440, '9:00 AM –  9:00 PM', 0, 0, 4.3),
-- Baner
(25, 'Apollo Pharmacy – Baner',              'Baner Road, Near Balewadi, Pune',       'Baner',         '411045', '020-27290001', 18.5590, 73.7858, '8:00 AM – 10:00 PM', 0, 1, 4.6),
(26, 'Sai Health – Baner',                   'Sus Road, Baner, Pune',                 'Baner',         '411045', '020-27290002', 18.5575, 73.7840, '9:00 AM –  9:00 PM', 0, 0, 4.2),
-- Pimpri-Chinchwad
(27, 'Apollo Pharmacy – Pimpri',             'Old Mumbai Road, Pimpri, PCMC',         'Pimpri',        '411018', '020-27420001', 18.6298, 73.7997, '8:00 AM – 10:00 PM', 0, 1, 4.5),
(28, 'Chinchwad Medical – Chinchwad',        'Chinchwad Station Road, PCMC',          'Chinchwad',     '411033', '020-27420002', 18.6406, 73.7988, '24 Hours',           1, 1, 4.6),
-- Pune Station / Deccan
(29, 'Station Road Pharmacy – Pune Stn',     'Station Road, Pune Railway Station',    'Pune Station',  '411001', '020-26120005', 18.5277, 73.8743, '24 Hours',           1, 0, 4.4),
(30, 'Deccan Gymkhana Pharma – Deccan',      'Fergusson College Road, Deccan, Pune',  'Deccan',        '411004', '020-25660001', 18.5189, 73.8388, '8:00 AM – 11:00 PM', 0, 1, 4.7);

-- ── 4. Pharmacy Inventory ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_inventory (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    pharmacy_id     INT NOT NULL,
    medicine_name   VARCHAR(200) NOT NULL,
    generic_name    VARCHAR(200),
    quantity        INT DEFAULT 0,
    unit_price      DECIMAL(10,2) DEFAULT 0.00,
    is_available    TINYINT(1) DEFAULT 1,
    last_updated    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pi_pharm   (pharmacy_id),
    INDEX idx_pi_med     (medicine_name),
    UNIQUE KEY uniq_pharm_med (pharmacy_id, medicine_name),
    FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE
);

-- Seed pharmacy inventory with common Indian medicines across all 30 pharmacies
-- Common medicines list: Paracetamol, Aspirin, Metformin, Amlodipine, Atorvastatin,
-- Omeprazole, Azithromycin, Amoxicillin, Ciprofloxacin, Cefixime, Metronidazole,
-- Pantoprazole, Losartan, Atenolol, Glipizide, Insulin, Ibuprofen, Diclofenac,
-- Cetirizine, Montelukast, Salbutamol, Doxycycline, Ranitidine, Tramadol, Vitamin D3

-- Apollo Pharmacy Koregaon Park (1)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(1,'Paracetamol 500mg','Paracetamol',850,12.50),(1,'Aspirin 75mg','Aspirin',300,8.00),
(1,'Metformin 500mg','Metformin',420,45.00),(1,'Amlodipine 5mg','Amlodipine',380,35.00),
(1,'Atorvastatin 10mg','Atorvastatin',290,65.00),(1,'Omeprazole 20mg','Omeprazole',510,18.00),
(1,'Azithromycin 500mg','Azithromycin',180,95.00),(1,'Amoxicillin 500mg','Amoxicillin',320,42.00),
(1,'Cetirizine 10mg','Cetirizine',640,12.00),(1,'Ibuprofen 400mg','Ibuprofen',720,15.00),
(1,'Pantoprazole 40mg','Pantoprazole',460,28.00),(1,'Losartan 50mg','Losartan',0,55.00),
(1,'Vitamin D3 60000IU','Cholecalciferol',280,85.00),(1,'Salbutamol Inhaler','Salbutamol',45,180.00),
(1,'Insulin Glargine','Insulin Glargine',8,950.00);

-- MedPlus North Main Rd (2)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(2,'Paracetamol 500mg','Paracetamol',600,12.00),(2,'Metformin 500mg','Metformin',200,44.00),
(2,'Ciprofloxacin 500mg','Ciprofloxacin',150,48.00),(2,'Montelukast 10mg','Montelukast',190,75.00),
(2,'Diclofenac 50mg','Diclofenac',350,18.00),(2,'Ranitidine 150mg','Ranitidine',0,14.00),
(2,'Doxycycline 100mg','Doxycycline',120,35.00),(2,'Atenolol 50mg','Atenolol',280,25.00),
(2,'Glipizide 5mg','Glipizide',160,38.00),(2,'Cetirizine 10mg','Cetirizine',500,12.00),
(2,'Ibuprofen 400mg','Ibuprofen',450,15.00),(2,'Vitamin D3 60000IU','Cholecalciferol',0,85.00);

-- Janaushadhi Kendra Kalyani Nagar (3)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(3,'Paracetamol 500mg','Paracetamol',1200,8.00),(3,'Aspirin 75mg','Aspirin',800,5.00),
(3,'Metformin 500mg','Metformin',600,25.00),(3,'Atenolol 50mg','Atenolol',450,15.00),
(3,'Omeprazole 20mg','Omeprazole',700,10.00),(3,'Amoxicillin 500mg','Amoxicillin',500,28.00),
(3,'Cetirizine 10mg','Cetirizine',900,8.00),(3,'Ibuprofen 400mg','Ibuprofen',1100,10.00),
(3,'Pantoprazole 40mg','Pantoprazole',600,15.00),(3,'Metronidazole 400mg','Metronidazole',400,12.00);

-- 24Hr LifeCare Kalyani Nagar (4)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(4,'Paracetamol 500mg','Paracetamol',300,12.50),(4,'Insulin Glargine','Insulin Glargine',15,950.00),
(4,'Salbutamol Inhaler','Salbutamol',30,180.00),(4,'Azithromycin 500mg','Azithromycin',90,95.00),
(4,'Amlodipine 5mg','Amlodipine',200,35.00),(4,'Atorvastatin 10mg','Atorvastatin',150,65.00),
(4,'Losartan 50mg','Losartan',175,55.00),(4,'Tramadol 50mg','Tramadol',60,28.00),
(4,'Vitamin D3 60000IU','Cholecalciferol',120,85.00),(4,'Cetirizine 10mg','Cetirizine',400,12.00),
(4,'Montelukast 10mg','Montelukast',145,75.00),(4,'Ciprofloxacin 500mg','Ciprofloxacin',200,48.00);

-- Apollo Shivajinagar (5)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(5,'Paracetamol 500mg','Paracetamol',950,12.50),(5,'Aspirin 75mg','Aspirin',400,8.00),
(5,'Metformin 500mg','Metformin',500,45.00),(5,'Amlodipine 5mg','Amlodipine',420,35.00),
(5,'Atorvastatin 10mg','Atorvastatin',310,65.00),(5,'Omeprazole 20mg','Omeprazole',580,18.00),
(5,'Azithromycin 500mg','Azithromycin',200,95.00),(5,'Losartan 50mg','Losartan',260,55.00),
(5,'Cetirizine 10mg','Cetirizine',700,12.00),(5,'Ibuprofen 400mg','Ibuprofen',800,15.00),
(5,'Insulin Glargine','Insulin Glargine',12,950.00),(5,'Vitamin D3 60000IU','Cholecalciferol',300,85.00),
(5,'Salbutamol Inhaler','Salbutamol',55,180.00),(5,'Montelukast 10mg','Montelukast',220,75.00);

-- Arogya Medical Shivajinagar (6)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(6,'Paracetamol 500mg','Paracetamol',500,12.00),(6,'Diclofenac 50mg','Diclofenac',300,18.00),
(6,'Metformin 500mg','Metformin',0,44.00),(6,'Cefixime 200mg','Cefixime',140,68.00),
(6,'Doxycycline 100mg','Doxycycline',100,35.00),(6,'Cetirizine 10mg','Cetirizine',450,12.00),
(6,'Atenolol 50mg','Atenolol',250,25.00),(6,'Pantoprazole 40mg','Pantoprazole',380,28.00);

-- MedPlus Kothrud (7)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(7,'Paracetamol 500mg','Paracetamol',700,12.00),(7,'Metformin 500mg','Metformin',350,44.00),
(7,'Amlodipine 5mg','Amlodipine',290,35.00),(7,'Atorvastatin 10mg','Atorvastatin',220,65.00),
(7,'Omeprazole 20mg','Omeprazole',440,18.00),(7,'Ibuprofen 400mg','Ibuprofen',620,15.00),
(7,'Cetirizine 10mg','Cetirizine',580,12.00),(7,'Vitamin D3 60000IU','Cholecalciferol',0,85.00),
(7,'Losartan 50mg','Losartan',195,55.00),(7,'Azithromycin 500mg','Azithromycin',160,95.00);

-- Health Point Kothrud (8)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(8,'Paracetamol 500mg','Paracetamol',400,12.00),(8,'Aspirin 75mg','Aspirin',200,8.00),
(8,'Diclofenac 50mg','Diclofenac',280,18.00),(8,'Metronidazole 400mg','Metronidazole',320,12.00),
(8,'Cetirizine 10mg','Cetirizine',350,12.00),(8,'Pantoprazole 40mg','Pantoprazole',0,28.00);

-- NetMeds Aundh (9)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(9,'Paracetamol 500mg','Paracetamol',800,12.50),(9,'Metformin 500mg','Metformin',430,45.00),
(9,'Amlodipine 5mg','Amlodipine',360,35.00),(9,'Atorvastatin 10mg','Atorvastatin',280,65.00),
(9,'Azithromycin 500mg','Azithromycin',175,95.00),(9,'Salbutamol Inhaler','Salbutamol',40,180.00),
(9,'Montelukast 10mg','Montelukast',200,75.00),(9,'Cetirizine 10mg','Cetirizine',600,12.00),
(9,'Vitamin D3 60000IU','Cholecalciferol',240,85.00),(9,'Insulin Glargine','Insulin Glargine',6,950.00),
(9,'Ibuprofen 400mg','Ibuprofen',700,15.00),(9,'Losartan 50mg','Losartan',0,55.00);

-- Sai Medicos Aundh (10)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(10,'Paracetamol 500mg','Paracetamol',500,12.00),(10,'Ciprofloxacin 500mg','Ciprofloxacin',180,48.00),
(10,'Doxycycline 100mg','Doxycycline',110,35.00),(10,'Cetirizine 10mg','Cetirizine',430,12.00),
(10,'Ibuprofen 400mg','Ibuprofen',550,15.00),(10,'Glipizide 5mg','Glipizide',140,38.00);

-- Apollo Wakad (11)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(11,'Paracetamol 500mg','Paracetamol',650,12.50),(11,'Metformin 500mg','Metformin',380,45.00),
(11,'Amlodipine 5mg','Amlodipine',310,35.00),(11,'Atorvastatin 10mg','Atorvastatin',0,65.00),
(11,'Omeprazole 20mg','Omeprazole',490,18.00),(11,'Cetirizine 10mg','Cetirizine',520,12.00),
(11,'Vitamin D3 60000IU','Cholecalciferol',200,85.00),(11,'Amoxicillin 500mg','Amoxicillin',270,42.00);

-- Medkart Wakad (12)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(12,'Paracetamol 500mg','Paracetamol',300,11.00),(12,'Ibuprofen 400mg','Ibuprofen',420,14.00),
(12,'Cetirizine 10mg','Cetirizine',380,11.00),(12,'Metformin 500mg','Metformin',0,43.00),
(12,'Pantoprazole 40mg','Pantoprazole',300,27.00),(12,'Diclofenac 50mg','Diclofenac',260,17.00);

-- LifeCare 24Hr Hinjewadi (13)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(13,'Paracetamol 500mg','Paracetamol',900,12.50),(13,'Aspirin 75mg','Aspirin',350,8.00),
(13,'Metformin 500mg','Metformin',460,45.00),(13,'Amlodipine 5mg','Amlodipine',390,35.00),
(13,'Atorvastatin 10mg','Atorvastatin',300,65.00),(13,'Insulin Glargine','Insulin Glargine',18,950.00),
(13,'Salbutamol Inhaler','Salbutamol',50,180.00),(13,'Azithromycin 500mg','Azithromycin',190,95.00),
(13,'Cetirizine 10mg','Cetirizine',660,12.00),(13,'Losartan 50mg','Losartan',240,55.00),
(13,'Vitamin D3 60000IU','Cholecalciferol',310,85.00),(13,'Tramadol 50mg','Tramadol',55,28.00),
(13,'Montelukast 10mg','Montelukast',230,75.00),(13,'Ibuprofen 400mg','Ibuprofen',780,15.00);

-- Pharmeasy Hinjewadi (14)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(14,'Paracetamol 500mg','Paracetamol',600,12.00),(14,'Metformin 500mg','Metformin',320,44.00),
(14,'Ciprofloxacin 500mg','Ciprofloxacin',170,48.00),(14,'Cetirizine 10mg','Cetirizine',490,12.00),
(14,'Ibuprofen 400mg','Ibuprofen',560,15.00),(14,'Pantoprazole 40mg','Pantoprazole',420,28.00),
(14,'Vitamin D3 60000IU','Cholecalciferol',0,85.00),(14,'Atenolol 50mg','Atenolol',260,25.00);

-- Apollo Magarpatta (15)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(15,'Paracetamol 500mg','Paracetamol',1000,12.50),(15,'Aspirin 75mg','Aspirin',450,8.00),
(15,'Metformin 500mg','Metformin',550,45.00),(15,'Amlodipine 5mg','Amlodipine',430,35.00),
(15,'Atorvastatin 10mg','Atorvastatin',340,65.00),(15,'Omeprazole 20mg','Omeprazole',600,18.00),
(15,'Insulin Glargine','Insulin Glargine',20,950.00),(15,'Salbutamol Inhaler','Salbutamol',60,180.00),
(15,'Losartan 50mg','Losartan',280,55.00),(15,'Cetirizine 10mg','Cetirizine',720,12.00),
(15,'Vitamin D3 60000IU','Cholecalciferol',350,85.00),(15,'Montelukast 10mg','Montelukast',250,75.00),
(15,'Azithromycin 500mg','Azithromycin',210,95.00),(15,'Amoxicillin 500mg','Amoxicillin',340,42.00),
(15,'Ibuprofen 400mg','Ibuprofen',850,15.00);

-- HealthMart Viman Nagar 24hr (22)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(22,'Paracetamol 500mg','Paracetamol',1100,12.50),(22,'Aspirin 75mg','Aspirin',500,8.00),
(22,'Metformin 500mg','Metformin',620,45.00),(22,'Amlodipine 5mg','Amlodipine',480,35.00),
(22,'Atorvastatin 10mg','Atorvastatin',380,65.00),(22,'Omeprazole 20mg','Omeprazole',660,18.00),
(22,'Azithromycin 500mg','Azithromycin',230,95.00),(22,'Insulin Glargine','Insulin Glargine',25,950.00),
(22,'Salbutamol Inhaler','Salbutamol',65,180.00),(22,'Losartan 50mg','Losartan',300,55.00),
(22,'Cetirizine 10mg','Cetirizine',800,12.00),(22,'Vitamin D3 60000IU','Cholecalciferol',400,85.00),
(22,'Tramadol 50mg','Tramadol',70,28.00),(22,'Montelukast 10mg','Montelukast',270,75.00),
(22,'Amoxicillin 500mg','Amoxicillin',360,42.00),(22,'Ibuprofen 400mg','Ibuprofen',920,15.00),
(22,'Glipizide 5mg','Glipizide',200,38.00),(22,'Cefixime 200mg','Cefixime',180,68.00),
(22,'Metronidazole 400mg','Metronidazole',440,12.00),(22,'Ciprofloxacin 500mg','Ciprofloxacin',250,48.00);

-- Station Road 24hr Pharmacy (29)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(29,'Paracetamol 500mg','Paracetamol',500,12.50),(29,'Aspirin 75mg','Aspirin',200,8.00),
(29,'Ibuprofen 400mg','Ibuprofen',420,15.00),(29,'Cetirizine 10mg','Cetirizine',360,12.00),
(29,'Pantoprazole 40mg','Pantoprazole',280,28.00),(29,'Metronidazole 400mg','Metronidazole',300,12.00),
(29,'Tramadol 50mg','Tramadol',40,28.00),(29,'Insulin Glargine','Insulin Glargine',10,950.00),
(29,'Salbutamol Inhaler','Salbutamol',25,180.00),(29,'Amoxicillin 500mg','Amoxicillin',200,42.00);

-- Deccan Gymkhana Pharma (30)
INSERT IGNORE INTO pharmacy_inventory (pharmacy_id, medicine_name, generic_name, quantity, unit_price) VALUES
(30,'Paracetamol 500mg','Paracetamol',750,12.50),(30,'Metformin 500mg','Metformin',400,45.00),
(30,'Amlodipine 5mg','Amlodipine',340,35.00),(30,'Cetirizine 10mg','Cetirizine',580,12.00),
(30,'Losartan 50mg','Losartan',220,55.00),(30,'Vitamin D3 60000IU','Cholecalciferol',260,85.00),
(30,'Azithromycin 500mg','Azithromycin',180,95.00),(30,'Ibuprofen 400mg','Ibuprofen',680,15.00),
(30,'Atorvastatin 10mg','Atorvastatin',260,65.00),(30,'Montelukast 10mg','Montelukast',195,75.00),
(30,'Omeprazole 20mg','Omeprazole',510,18.00),(30,'Amoxicillin 500mg','Amoxicillin',290,42.00);

-- ════════════════════════════════════════════════════════════════
--  Done! Run teleconsult.py and pharmacy_routes.py are now ready.
-- ════════════════════════════════════════════════════════════════
