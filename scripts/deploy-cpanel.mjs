import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const projectRoot = resolve(import.meta.dirname, "..");
const archive = resolve(projectRoot, "deploy", "healthfield-next-production.tar.gz");
const stagingRoot = resolve(projectRoot, ".cpanel-release-staging");
const stagedBuild = resolve(stagingRoot, ".next");
const activeBuild = resolve(projectRoot, ".next");

// cPanel deployment tasks do not always inherit the Node application variables.
// Load the private server environment file without overriding variables supplied
// by the hosting platform, then migrate before changing the active build.
const environmentFile = resolve(projectRoot, ".env");
if (existsSync(environmentFile)) loadEnvFile(environmentFile);
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to run production migrations.");
  process.exit(1);
}

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: resolve(projectRoot, "drizzle") });
  console.log("Database migrations completed.");
} finally {
  await pool.end();
}

if (!existsSync(archive)) {
  console.error("Compiled cPanel archive is missing. Pull the latest Git release first.");
  process.exit(1);
}

// Extract away from the live build so a failed release cannot interrupt the site.
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
const result = spawnSync("tar", ["-xzf", archive, "-C", stagingRoot], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.status !== 0 || !existsSync(resolve(stagedBuild, "BUILD_ID"))) {
  rmSync(stagingRoot, { recursive: true, force: true });
  console.error("Release extraction failed or BUILD_ID is missing. Existing site was not changed.");
  process.exit(result.status || 1);
}

// Keep one recoverable previous build until the next successful deployment.
const previousBuild = resolve(projectRoot, ".next-previous");
rmSync(previousBuild, { recursive: true, force: true });
if (existsSync(activeBuild)) renameSync(activeBuild, previousBuild);
renameSync(stagedBuild, activeBuild);
rmSync(stagingRoot, { recursive: true, force: true });

const restartDirectory = resolve(projectRoot, "tmp");
mkdirSync(restartDirectory, { recursive: true });
writeFileSync(resolve(restartDirectory, "restart.txt"), `${new Date().toISOString()}\n`);
console.log("Healthfield release installed. Passenger restart requested.");
