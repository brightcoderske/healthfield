#!/bin/bash
set -Eeuo pipefail

REPOSITORY_ROOT="/home/healthfi/health_field"
APPLICATION_ROOT="${REPOSITORY_ROOT}/api-service"
VIRTUAL_ENV="/home/healthfi/nodevenv/health_field/api-service/24/bin/activate"
STORAGE_ROOT="/home/healthfi/healthfield-storage"

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
# Shared cPanel accounts can reject pnpm's default worker burst with EAGAIN.
# Keep installs deliberately single-worker; this runs only when pnpm-lock.yaml changes.
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

# Install only on the first deployment or when pnpm-lock.yaml changes.
LOCK_HASH="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
LOCK_MARKER="node_modules/.healthfield-pnpm-lock.sha256"
CURRENT_BUNDLE="${APPLICATION_ROOT}/dist"
STAGED_BUNDLE="${APPLICATION_ROOT}/dist.next"
PREVIOUS_BUNDLE="${APPLICATION_ROOT}/dist.previous"
INSTALLED_HASH="$(cat "${LOCK_MARKER}" 2>/dev/null || true)"
if [[ ! -d node_modules || "${LOCK_HASH}" != "${INSTALLED_HASH}" ]]; then
  echo "Dependency lock changed; installing packages..."
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm install --frozen-lockfile --prod=false --network-concurrency=1 --child-concurrency=1
  else
    npx --yes pnpm@10.15.0 install --frozen-lockfile --prod=false --network-concurrency=1 --child-concurrency=1
  fi
  printf '%s\n' "${LOCK_HASH}" > "${LOCK_MARKER}"
else
  echo "Dependency lock is unchanged; skipping package installation."
fi

node node_modules/typescript/bin/tsc --noEmit -p api-service/tsconfig.json

# Build away from the live bundle. A failed build leaves the running API's dist untouched.
rm -rf "${STAGED_BUNDLE}"
HEALTHFIELD_API_OUTPUT="${STAGED_BUNDLE}" node scripts/build-api.mjs
test -s "${STAGED_BUNDLE}/server.mjs"

# Fail the deployment before replacing the current bundle if the database cannot migrate.
node scripts/migrate-api.mjs

# Keep one rollback bundle only. The two renames occur on the same filesystem.
# The active Node process continues serving its in-memory code until cPanel reloads it.
SWAP_STARTED=0
restore_bundle() {
  if [[ "${SWAP_STARTED}" == "1" && ! -d "${CURRENT_BUNDLE}" && -d "${PREVIOUS_BUNDLE}" ]]; then
    mv "${PREVIOUS_BUNDLE}" "${CURRENT_BUNDLE}"
  fi
}
trap restore_bundle ERR
rm -rf "${PREVIOUS_BUNDLE}"
if [[ -d "${CURRENT_BUNDLE}" ]]; then
  SWAP_STARTED=1
  mv "${CURRENT_BUNDLE}" "${PREVIOUS_BUNDLE}"
fi
mv "${STAGED_BUNDLE}" "${CURRENT_BUNDLE}"
SWAP_STARTED=0
trap - ERR

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

echo "API build, migrations, and bundle swap completed: ${DEPLOY_SHORT_COMMIT} at ${DEPLOY_COMPLETED_AT}"
echo "Rollback bundle retained at ${PREVIOUS_BUNDLE} (replaced on the next successful deployment)."
echo "Restart signal written to ${APPLICATION_ROOT}/tmp/restart.txt."
echo "After cPanel reloads the Node application, verify: curl -fsS https://api.healthfieldpharmacy.co.ke/health"
