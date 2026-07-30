import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const databaseUrl =
  process.env.DATABASE_URL ??
  "mysql://root@127.0.0.1:3306/healthfield_pharmacy";
const email = "healthfieldpharmacy32@gmail.com";
const temporaryPassword = "Password";
const passwordHash = await bcrypt.hash(temporaryPassword, 12);
const connection = await mysql.createConnection(databaseUrl);

await connection.execute(
  `INSERT INTO users
    (email, password_hash, role, first_name, last_name, is_active,
     two_factor_enabled, force_password_change, created_at, updated_at)
   VALUES (?, ?, 'SUPER_ADMIN', 'Healthfield', 'Administrator', 1, 0, 0, NOW(), NOW())
   ON DUPLICATE KEY UPDATE
     password_hash = VALUES(password_hash),
     role = 'SUPER_ADMIN',
     is_active = 1,
     force_password_change = 0,
     updated_at = NOW()`,
  [email, passwordHash],
);

const conditions = [
  ["Pain & Fever", "pain-fever", 1],
  ["Cold & Flu", "cold-flu", 2],
  ["Allergy", "allergy", 3],
  ["Digestive Health", "digestive-health", 4],
  ["Skin Care", "skin-care", 5],
  ["Heart Health", "heart-health", 6],
  ["Diabetes Care", "diabetes-care", 7],
  ["Mother & Baby", "mother-baby", 8],
  ["Acne & Blemishes", "acne-blemishes", 9],
  ["Dry & Sensitive Skin", "dry-sensitive-skin", 10],
  ["Eczema & Dermatitis", "eczema-dermatitis", 11],
  ["Fungal Skin Care", "fungal-skin-care", 12],
  ["Sun Protection", "sun-protection", 13],
];
for (const [name, slug, order] of conditions) {
  await connection.execute(
    `INSERT INTO health_conditions (name, slug, is_active, display_order, created_at, updated_at)
     VALUES (?, ?, 1, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE name=VALUES(name), is_active=1, display_order=VALUES(display_order)`,
    [name, slug, order],
  );
}

const categoryNames = [
  ["Prescription Medicines", "prescription-medicines", 1],
  ["OTC Medicines", "otc-medicines", 2],
  ["Vitamins & Supplements", "vitamins-supplements", 3],
  ["Personal Care", "personal-care", 4],
  ["Baby Care", "baby-care", 5],
  ["Medical Devices", "medical-devices", 6],
  ["Skin Care", "skin-care", 7],
];
for (const [name, slug, order] of categoryNames) {
  await connection.execute(
    `INSERT INTO categories (name, slug, display_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE name=VALUES(name), display_order=VALUES(display_order), is_active=1`,
    [name, slug, order],
  );
}

const [categoryRows] = await connection.query("SELECT id, slug FROM categories");
const categoryIds = Object.fromEntries(categoryRows.map((row) => [row.slug, row.id]));
const catalog = [
  ["Panadol Extra Tablets", "panadol-extra-tablets", "HF-PAN-001", "Panadol", 120, "12 tablets", "otc-medicines"],
  ["Vitamin C 1000mg", "vitamin-c-1000mg", "HF-VIT-001", "Healthfield", 950, "100 tablets", "vitamins-supplements"],
  ["Accu-Chek 50 Test Strips", "accu-chek-50-test-strips", "HF-MED-001", "Accu-Chek", 1450, "50 strips", "medical-devices"],
  ["Dettol Antiseptic Liquid", "dettol-antiseptic-liquid", "HF-OTC-002", "Dettol", 350, "250ml", "otc-medicines"],
  ["Nivea Natural Glow", "nivea-natural-glow", "HF-PC-001", "Nivea", 650, "400ml", "personal-care"],
  ["Beurer Blood Pressure Monitor", "beurer-blood-pressure-monitor", "HF-MED-002", "Beurer", 4500, "1 unit", "medical-devices"],
];
for (const [name, slug, sku, brand, price, packSize, categorySlug] of catalog) {
  await connection.execute(
    `INSERT INTO products
      (category_id, name, slug, sku, brand, short_description, price, pack_size,
       prescription_required, is_featured, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE name=VALUES(name), brand=VALUES(brand), price=VALUES(price),
       pack_size=VALUES(pack_size), is_active=1`,
    [categoryIds[categorySlug], name, slug, sku, brand, `${brand} ${packSize}`, price, packSize],
  );
}

await connection.execute(
  `INSERT INTO site_settings
    (id, pharmacy_name, delivery_message, created_at, updated_at)
   VALUES (1, 'Healthfield Pharmacy', 'Fast Delivery Across Kenya', NOW(), NOW())
   ON DUPLICATE KEY UPDATE pharmacy_name=VALUES(pharmacy_name)`,
);

await connection.end();
console.log(`Seeded ${email}, categories, and the starter product catalogue.`);
