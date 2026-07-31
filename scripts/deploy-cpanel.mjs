import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const archive = resolve(projectRoot, "deploy", "healthfield-next-production.tar.gz");
const stagingRoot = resolve(projectRoot, ".cpanel-release-staging");
const stagedBuild = resolve(stagingRoot, ".next");
const activeBuild = resolve(projectRoot, ".next");

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
