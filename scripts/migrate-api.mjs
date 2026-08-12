import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const repositoryRoot = resolve(import.meta.dirname, "..");
const applicationRoot = resolve(repositoryRoot, "api-service");
// Production keeps its API environment beside the service, while local split
// development uses the repository-level .env.local. Allow callers to select
// that file without copying credentials into another location.
const environmentFile = process.env.API_ENV_FILE
  ? resolve(repositoryRoot, process.env.API_ENV_FILE)
  : resolve(applicationRoot, ".env");

if (!existsSync(environmentFile)) {
  throw new Error(`Missing API environment file: ${environmentFile}`);
}

loadEnvFile(environmentFile);

if (!process.env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is missing from ${environmentFile}`);
}

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 1,
});

try {
  await migrate(drizzle(pool), {
    migrationsFolder: resolve(repositoryRoot, "drizzle"),
  });
  console.log("Database migrations completed.");
} finally {
  await pool.end();
}
