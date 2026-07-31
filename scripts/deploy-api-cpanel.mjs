import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "..");
const archive = resolve(repository, "deploy", "healthfield-api-production.tar.gz");
const target = process.env.API_DEPLOY_ROOT || "/home/healthfi/healthfield-api";
const storage = process.env.API_STORAGE_ROOT || "/home/healthfi/healthfield-storage";
const staging = `${target}.staging`;
const previous = `${target}.previous`;

if (!existsSync(archive)) {
  console.error("The compiled API release archive is missing.");
  process.exit(1);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const extracted = spawnSync("tar", ["-xzf", archive, "-C", staging], { stdio: "inherit" });
if (extracted.status !== 0 || !existsSync(resolve(staging, "dist", "server.mjs"))) {
  rmSync(staging, { recursive: true, force: true });
  console.error("API release extraction failed.");
  process.exit(extracted.status || 1);
}

// Private configuration is preserved; operational uploads live outside releases.
if (existsSync(resolve(target, ".env"))) cpSync(resolve(target, ".env"), resolve(staging, ".env"));
mkdirSync(resolve(storage, "uploads", "products"), { recursive: true });
mkdirSync(resolve(storage, "prescriptions"), { recursive: true });
mkdirSync(resolve(staging, "tmp"), { recursive: true });

rmSync(previous, { recursive: true, force: true });
if (existsSync(target)) renameSync(target, previous);
renameSync(staging, target);
writeFileSync(resolve(target, "tmp", "restart.txt"), `${new Date().toISOString()}\n`);
console.log("Healthfield API release installed. Passenger restart requested.");
