import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL || {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "healthfield",
});

const [result] = await connection.execute(`
  INSERT IGNORE INTO branch_inventory
    (branch_id, product_id, quantity_available, quantity_reserved, reorder_level, created_at, updated_at)
  SELECT b.id, p.id, 0, 0, 5, NOW(), NOW()
  FROM branches b
  CROSS JOIN products p
`);
console.log(`Inventory synchronized: ${result.affectedRows} missing product/store rows added.`);
await connection.end();
