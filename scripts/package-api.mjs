import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const deploy = resolve(root, "deploy");
const archive = resolve(deploy, "healthfield-api-production.tar.gz");
if (!existsSync(resolve(root, "api-service", "dist", "server.mjs"))) {
  console.error("API bundle is missing. Run npm run build:api first.");
  process.exit(1);
}
mkdirSync(deploy, { recursive: true });
rmSync(archive, { force: true });
const result = spawnSync("tar", ["-czf", archive, "-C", "api-service", "dist", "drizzle", "package.json", "server.cjs", ".env.example"], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Created ${archive}`);
