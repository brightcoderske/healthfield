#!/bin/bash
set -Eeuo pipefail

REPOSITORY_ROOT="/home/healthfi/health_field"
APPLICATION_ROOT="${REPOSITORY_ROOT}/api-service"
VIRTUAL_ENV="/home/healthfi/nodevenv/health_field/api-service/24/bin/activate"
STORAGE_ROOT="/home/healthfi/healthfield-storage"
RELEASE_ARCHIVE="${REPOSITORY_ROOT}/deploy/healthfield-api-production.tar.gz"
RELEASE_STAGE="${APPLICATION_ROOT}/.release.next"
RELEASE_PREVIOUS="${APPLICATION_ROOT}/.release.previous"

if [[ ! -f "${VIRTUAL_ENV}" ]]; then
  echo "Node.js virtual environment was not found: ${VIRTUAL_ENV}" >&2
  exit 1
fi

if [[ ! -f "${APPLICATION_ROOT}/.env" ]]; then
  echo "Missing ${APPLICATION_ROOT}/.env. Create it in cPanel before deploying." >&2
  exit 1
fi

# cPanel creates this activation script for the configured Node.js 24 app.
set +u
source "${VIRTUAL_ENV}"
set -u
cd "${REPOSITORY_ROOT}"

export NODE_ENV=production
export CI=true
# Dependencies are normally installed through cPanel only when package dependencies change.
# The production API bundle itself is built locally and delivered as a release archive.
export PNPM_CONFIG_NETWORK_CONCURRENCY=1
export PNPM_CONFIG_CHILD_CONCURRENCY=1
export PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy
# pnpm 11 uses this worker pool while importing packages from its store.
export PNPM_MAX_WORKERS=1
# esbuild is a Go binary; shared hosting exposes many CPUs but restricts threads.
export GOMAXPROCS=1

DEPLOY_COMMIT="$(git rev-parse HEAD)"
DEPLOY_SHORT_COMMIT="$(git rev-parse --short HEAD)"
DEPLOY_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Deploying repository commit ${DEPLOY_SHORT_COMMIT} at ${DEPLOY_STARTED_AT}..."

# Set INSTALL_DEPS=1 only after changing runtime dependencies in package.json.
if [[ "${INSTALL_DEPS:-0}" == "1" ]]; then
  echo "Installing changed dependencies with cPanel-safe limits..."
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm install --frozen-lockfile --prod=false --network-concurrency=1 --child-concurrency=1
  else
    npx --yes pnpm@10.15.0 install --frozen-lockfile --prod=false --network-concurrency=1 --child-concurrency=1
  fi
else
  echo "Using existing cPanel dependencies (set INSTALL_DEPS=1 only for dependency changes)."
fi

if [[ ! -f "${RELEASE_ARCHIVE}" ]]; then
  echo "Missing locally built API release archive: ${RELEASE_ARCHIVE}" >&2
  exit 1
fi

# Extract the Git-delivered local build away from the live runtime directories.
rm -rf "${RELEASE_STAGE}"
mkdir -p "${RELEASE_STAGE}"
tar -xzf "${RELEASE_ARCHIVE}" -C "${RELEASE_STAGE}"
test -s "${RELEASE_STAGE}/dist/server.mjs"
test -d "${RELEASE_STAGE}/drizzle"
test -s "${RELEASE_STAGE}/.release-manifest.json"
ARCHIVE_SOURCE_COMMIT="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!/^[a-f0-9]{40}$/.test(p.sourceCommit||""))process.exit(1);process.stdout.write(p.sourceCommit)' "${RELEASE_STAGE}/.release-manifest.json")"
if ! git merge-base --is-ancestor "${ARCHIVE_SOURCE_COMMIT}" HEAD; then
  echo "API release archive was built from an unrelated commit: ${ARCHIVE_SOURCE_COMMIT}" >&2
  exit 1
fi
if ! git diff --quiet "${ARCHIVE_SOURCE_COMMIT}" HEAD -- api-service/src db/schema.ts drizzle package.json pnpm-lock.yaml scripts/build-api.mjs; then
  echo "API source, schema, migrations, or dependencies changed after the release archive was built." >&2
  echo "Run pnpm release:api locally, commit deploy/healthfield-api-production.tar.gz, then deploy again." >&2
  exit 1
fi
echo "Local API release archive extracted and verified."

# Fail before replacing the live runtime if the database cannot migrate.
node scripts/migrate-api.mjs

# Retain exactly one rollback release. The app root and private .env are never renamed.
rm -rf "${RELEASE_PREVIOUS}"
mkdir -p "${RELEASE_PREVIOUS}"
if [[ -d "${APPLICATION_ROOT}/dist" ]]; then mv "${APPLICATION_ROOT}/dist" "${RELEASE_PREVIOUS}/dist"; fi
if [[ -d "${APPLICATION_ROOT}/drizzle" ]]; then mv "${APPLICATION_ROOT}/drizzle" "${RELEASE_PREVIOUS}/drizzle"; fi
mv "${RELEASE_STAGE}/dist" "${APPLICATION_ROOT}/dist"
mv "${RELEASE_STAGE}/drizzle" "${APPLICATION_ROOT}/drizzle"
# The archive also carries package metadata for manual recovery; it is not part of the live app root.
rm -rf "${RELEASE_STAGE}"

# This stamp is written only after type-check, bundle, and migrations succeed.
# /health returns it after the Node application has actually reloaded.
DEPLOY_COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"commit":"%s","builtAt":"%s"}\n' "${DEPLOY_COMMIT}" "${DEPLOY_COMPLETED_AT}" > "${APPLICATION_ROOT}/.healthfield-build.json"

# Uploaded images and prescriptions live outside Git, builds, and application restarts.
mkdir -p "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions"
chmod 750 "${STORAGE_ROOT}" "${STORAGE_ROOT}/uploads" "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions"

# Preserve images from the former in-repository location during the first deployment.
if [[ -d "${REPOSITORY_ROOT}/public/uploads/products" ]]; then
  cp -an "${REPOSITORY_ROOT}/public/uploads/products/." "${STORAGE_ROOT}/uploads/products/"
fi

mkdir -p "${APPLICATION_ROOT}/tmp"
touch "${APPLICATION_ROOT}/tmp/restart.txt"

echo "Local release extraction, migrations, and runtime swap completed: ${DEPLOY_SHORT_COMMIT} at ${DEPLOY_COMPLETED_AT}"
echo "Rollback release retained at ${RELEASE_PREVIOUS} (replaced on the next successful deployment)."
echo "Restart signal written to ${APPLICATION_ROOT}/tmp/restart.txt."
echo "After cPanel reloads the Node application, verify: curl -fsS https://api.healthfieldpharmacy.co.ke/health"
