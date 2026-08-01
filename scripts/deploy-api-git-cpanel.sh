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
source "${VIRTUAL_ENV}"
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

echo "Deploying repository commit $(git rev-parse --short HEAD)..."

# Install only on the first deployment or when pnpm-lock.yaml changes.
LOCK_HASH="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
LOCK_MARKER="node_modules/.healthfield-pnpm-lock.sha256"
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
node scripts/build-api.mjs

# Fail the deployment before restarting Passenger if the database cannot migrate.
node scripts/migrate-api.mjs

# Uploaded images and prescriptions live outside Git, builds, and application restarts.
mkdir -p "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions"
chmod 750 "${STORAGE_ROOT}" "${STORAGE_ROOT}/uploads" "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions"

# Preserve images from the former in-repository location during the first deployment.
if [[ -d "${REPOSITORY_ROOT}/public/uploads/products" ]]; then
  cp -an "${REPOSITORY_ROOT}/public/uploads/products/." "${STORAGE_ROOT}/uploads/products/"
fi

mkdir -p "${APPLICATION_ROOT}/tmp"
touch "${APPLICATION_ROOT}/tmp/restart.txt"

echo "API deployment completed; Passenger restart requested."
