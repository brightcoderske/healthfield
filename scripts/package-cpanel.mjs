import { mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const buildId = resolve(projectRoot, ".next", "BUILD_ID");
const deployDirectory = resolve(projectRoot, "deploy");
const archive = resolve(deployDirectory, "healthfield-next-production.tar.gz");

try {
  statSync(buildId);
} catch {
  console.error("No production build found. Run npm run build first.");
  process.exit(1);
}

mkdirSync(deployDirectory, { recursive: true });
rmSync(archive, { force: true });

const result = spawnSync("tar", [
  "-czf", archive,
  "--exclude=.next/cache",
  "--exclude=.next/dev",
  "--exclude=.next/standalone",
  ".next",
  "public",
], { cwd: projectRoot, stdio: "inherit" });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Created ${archive}`);
