import mysql from "mysql2/promise";

const databaseUrl =
  process.env.DATABASE_URL ??
  "mysql://root@127.0.0.1:3306/healthfield_pharmacy";
const parsed = new URL(databaseUrl);
const database = parsed.pathname.replace(/^\//, "");
const connection = await mysql.createConnection({
  host: parsed.hostname,
  port: Number(parsed.port || 3306),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
});

// Identifiers cannot be parameterized. Restrict the configured database name
// to safe MySQL identifier characters before using it in the CREATE statement.
if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error("DATABASE_URL contains an unsafe database name.");
}

await connection.query(
  `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
await connection.end();
console.log(`Database ${database} is ready.`);
