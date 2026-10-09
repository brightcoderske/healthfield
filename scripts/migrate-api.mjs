import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const repositoryRoot = resolve(import.meta.dirname, "..");
const applicationRoot = resolve(repositoryRoot, "api-service");
// Production keeps its API environment beside the service, while local split
// development uses the repository-level .env.local. API_ENV_FILE overrides both;
// otherwise the first of the two that exists wins, so the same command works on a
// developer machine and on the server without a shell-specific env prefix.
const candidates = process.env.API_ENV_FILE
  ? [resolve(repositoryRoot, process.env.API_ENV_FILE)]
  : [resolve(applicationRoot, ".env"), resolve(repositoryRoot, ".env.local")];
const environmentFile = candidates.find((candidate) => existsSync(candidate));

if (!environmentFile) {
  throw new Error(`Missing API environment file. Looked for: ${candidates.join(", ")}`);
}

console.log(`Using environment: ${environmentFile}`);

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
