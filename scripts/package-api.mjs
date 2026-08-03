import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const deploy = resolve(root, "deploy");
const archive = resolve(deploy, "healthfield-api-production.tar.gz");
const manifest = resolve(root, "api-service", ".release-manifest.json");
if (!existsSync(resolve(root, "api-service", "dist", "server.mjs"))) {
  console.error("API bundle is missing. Run npm run build:api first.");
  process.exit(1);
}
mkdirSync(deploy, { recursive: true });
rmSync(archive, { force: true });
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (commit.status !== 0 || !commit.stdout.trim()) process.exit(commit.status ?? 1);
writeFileSync(manifest, `${JSON.stringify({ sourceCommit: commit.stdout.trim(), builtAt: new Date().toISOString() })}\n`);
const result = spawnSync("tar", ["-czf", archive, "-C", "api-service", "dist", "drizzle", "package.json", "server.cjs", ".env.example", ".release-manifest.json"], { cwd: root, stdio: "inherit" });
rmSync(manifest, { force: true });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Created ${archive}`);
