#!/bin/bash
set -Eeuo pipefail

REPOSITORY_ROOT="/home/healthfi/health_field"
APPLICATION_ROOT="${REPOSITORY_ROOT}/api-service"
VIRTUAL_ENV="/home/healthfi/nodevenv/health_field/api-service/24/bin/activate"
STORAGE_ROOT="/home/healthfi/healthfield-storage"
RELEASE_STAGE="${APPLICATION_ROOT}/.release.next"
RELEASE_PREVIOUS="${APPLICATION_ROOT}/.release.previous"
DEPENDENCY_MARKER="${APPLICATION_ROOT}/.pnpm-lock.sha256"

if [[ ! -f "${VIRTUAL_ENV}" ]]; then
  echo "Node.js virtual environment was not found: ${VIRTUAL_ENV}" >&2
  exit 1
fi
if [[ ! -f "${APPLICATION_ROOT}/.env" ]]; then
  echo "Missing ${APPLICATION_ROOT}/.env. The server-managed environment file must remain in place." >&2
  exit 1
fi

set +u
source "${VIRTUAL_ENV}"
set -u
cd "${REPOSITORY_ROOT}"

export NODE_ENV=production
export CI=true
export PNPM_CONFIG_NETWORK_CONCURRENCY=1
export PNPM_CONFIG_CHILD_CONCURRENCY=1
export PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy
export PNPM_MAX_WORKERS=1
export GOMAXPROCS=1

if command -v pnpm >/dev/null 2>&1; then
  PNPM_COMMAND=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM_COMMAND=(corepack pnpm)
else
  PNPM_COMMAND=(npx --yes pnpm@11.9.0)
fi

DEPLOY_COMMIT="$(git rev-parse HEAD)"
DEPLOY_SHORT_COMMIT="$(git rev-parse --short HEAD)"
DEPLOY_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Building repository commit ${DEPLOY_SHORT_COMMIT} on cPanel at ${DEPLOY_STARTED_AT}..."

# Stop the application from cPanel before deploying. LiteSpeed sometimes leaves lsnode
# workers alive afterward, so clean up only processes whose resolved working directory is
# exactly this API root. Never match by a broad process name or affect the legacy app path.
find_api_workers() {
  for process_directory in /proc/[0-9]*; do
    process_cwd="$(readlink "${process_directory}/cwd" 2>/dev/null || true)"
    if [[ "${process_cwd}" == "${APPLICATION_ROOT}" ]]; then
      printf '%s\n' "${process_directory##*/}"
    fi
  done
}

mapfile -t API_WORKERS < <(find_api_workers)
if [[ "${#API_WORKERS[@]}" -gt 0 ]]; then
  echo "Stopping lingering API workers after verifying their application directory: ${API_WORKERS[*]}"
  kill -TERM "${API_WORKERS[@]}" 2>/dev/null || true
  sleep 5
fi

mapfile -t API_WORKERS < <(find_api_workers)
if [[ "${#API_WORKERS[@]}" -gt 0 ]]; then
  echo "Graceful stop timed out; force-stopping verified API workers: ${API_WORKERS[*]}"
  kill -KILL "${API_WORKERS[@]}" 2>/dev/null || true
  sleep 2
fi

mapfile -t API_WORKERS < <(find_api_workers)
if [[ "${#API_WORKERS[@]}" -gt 0 ]]; then
  echo "API workers keep respawning: ${API_WORKERS[*]}" >&2
  echo "Stop health_field/api-service from cPanel before deploying, then try again." >&2
  exit 1
fi
echo "No health_field/api-service workers remain; continuing with the source build."

LOCK_FINGERPRINT="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
INSTALLED_FINGERPRINT="$(cat "${DEPENDENCY_MARKER}" 2>/dev/null || true)"
if [[ -d node_modules && -z "${INSTALLED_FINGERPRINT}" && "${INSTALL_DEPS:-0}" != "1" ]]; then
  echo "Bootstrapping the dependency marker from the existing cPanel installation."
  printf '%s\n' "${LOCK_FINGERPRINT}" > "${DEPENDENCY_MARKER}"
  INSTALLED_FINGERPRINT="${LOCK_FINGERPRINT}"
fi
if [[ "${INSTALL_DEPS:-0}" == "1" || ! -d node_modules || "${LOCK_FINGERPRINT}" != "${INSTALLED_FINGERPRINT}" ]]; then
  echo "Dependency lockfile changed or dependencies are missing; installing with cPanel-safe limits..."
  "${PNPM_COMMAND[@]}" install --frozen-lockfile --prod=false --network-concurrency=1 --child-concurrency=1
  printf '%s\n' "${LOCK_FINGERPRINT}" > "${DEPENDENCY_MARKER}"
else
  echo "Dependency lockfile unchanged; using existing cPanel dependencies."
fi

rm -rf "${RELEASE_STAGE}"
mkdir -p "${RELEASE_STAGE}"

echo "Type-checking the API..."
"${PNPM_COMMAND[@]}" run check:api

echo "Building the API into an isolated release stage..."
HEALTHFIELD_API_OUTPUT="${RELEASE_STAGE}/dist" \
HEALTHFIELD_API_DRIZZLE_OUTPUT="${RELEASE_STAGE}/drizzle" \
node scripts/build-api.mjs
test -s "${RELEASE_STAGE}/dist/server.mjs"
test -d "${RELEASE_STAGE}/drizzle"

echo "Applying database migrations before the runtime swap..."
node scripts/migrate-api.mjs

rm -rf "${RELEASE_PREVIOUS}"
mkdir -p "${RELEASE_PREVIOUS}"
if [[ -d "${APPLICATION_ROOT}/dist" ]]; then mv "${APPLICATION_ROOT}/dist" "${RELEASE_PREVIOUS}/dist"; fi
if [[ -d "${APPLICATION_ROOT}/drizzle" ]]; then mv "${APPLICATION_ROOT}/drizzle" "${RELEASE_PREVIOUS}/drizzle"; fi
mv "${RELEASE_STAGE}/dist" "${APPLICATION_ROOT}/dist"
mv "${RELEASE_STAGE}/drizzle" "${APPLICATION_ROOT}/drizzle"
rm -rf "${RELEASE_STAGE}"

DEPLOY_COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"commit":"%s","builtAt":"%s","buildMode":"cpanel-source"}\n' "${DEPLOY_COMMIT}" "${DEPLOY_COMPLETED_AT}" > "${APPLICATION_ROOT}/.healthfield-build.json"

mkdir -p "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions" "${APPLICATION_ROOT}/tmp"
chmod 750 "${STORAGE_ROOT}" "${STORAGE_ROOT}/uploads" "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions"
if [[ -d "${REPOSITORY_ROOT}/public/uploads/products" ]]; then
  cp -an "${REPOSITORY_ROOT}/public/uploads/products/." "${STORAGE_ROOT}/uploads/products/"
fi

echo "Source build, migrations, and runtime swap completed: ${DEPLOY_SHORT_COMMIT} at ${DEPLOY_COMPLETED_AT}"
echo "Rollback release retained at ${RELEASE_PREVIOUS}."
echo "Start health_field/api-service from cPanel, then verify the worker start time and live feature routes."
