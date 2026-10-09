#!/bin/bash
# Deploys Healthfield: one app, one folder, one process.
#
#   cPanel "Deploy HEAD Commit" runs this through .cpanel.yml; it can also be run by hand:
#   bash scripts/deploy.sh            deploy what is checked out now
#   bash scripts/deploy.sh --pull     first fast-forward to origin/main, then deploy
#
# The storefront and the API are one Node app. The API is built into api-service/dist and is
# started inside the storefront's own process by the root server.cjs, so there is a single
# cPanel Node app, a single .env and a single restart. Where it lives is worked out from where
# this script is, so the checkout can sit in any folder of the cPanel account (~/apps/healthfield).
#
# Optional settings, all read from the environment:
#   NODE_VERSION        Node selector version used to find the nodevenv (default 24)
#   NODE_VENV           full path of the nodevenv "bin/activate" to use instead of the guessed one
#   STORAGE_ROOT        persistent uploads/prescriptions (default ~/healthfield-storage)
#   BUILD_MEMORY_MB     heap limit for the build (default 1400)
#   BUILD_SPLIT=0       build in one process instead of two (needs about 2 GB free)
#   INSTALL_DEPS=1      force a dependency install even if pnpm-lock.yaml is unchanged
#
# The order is chosen so that a failure leaves the running site as it was: the app is stopped,
# everything is built and checked, the database is migrated, and only then are the new builds
# swapped in. A failed build or migration puts the previous storefront build back.
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/.." && pwd)"
APP_ROOT="${REPOSITORY_ROOT}"
API_ROOT="${REPOSITORY_ROOT}/api-service"

# --pull: bring the checkout up to date with main, then run the (possibly updated) script again.
if [[ "${1:-}" == "--pull" && "${DEPLOY_ALREADY_PULLED:-0}" != "1" ]]; then
  git -C "${REPOSITORY_ROOT}" fetch origin main
  git -C "${REPOSITORY_ROOT}" merge --ff-only origin/main
  DEPLOY_ALREADY_PULLED=1 exec bash "${SCRIPT_DIRECTORY}/deploy.sh"
fi

ACCOUNT_HOME="${HOME:-$(cd ~ && pwd)}"
NODE_VERSION="${NODE_VERSION:-24}"
STORAGE_ROOT="${STORAGE_ROOT:-${ACCOUNT_HOME}/healthfield-storage}"
BUILD_MEMORY_MB="${BUILD_MEMORY_MB:-1400}"

RELEASE_STAGE="${API_ROOT}/.release.next"
RELEASE_PREVIOUS="${API_ROOT}/.release.previous"
STOREFRONT_BUILD="${APP_ROOT}/.next"
STOREFRONT_PREVIOUS="${APP_ROOT}/.next.previous"
DEPENDENCY_MARKER="${API_ROOT}/.pnpm-lock.sha256"

# cPanel keeps the app's tools in ~/nodevenv/<application root relative to the home folder>/<version>.
RELATIVE_ROOT="${REPOSITORY_ROOT#"${ACCOUNT_HOME}"/}"
NODE_VENV="${NODE_VENV:-${ACCOUNT_HOME}/nodevenv/${RELATIVE_ROOT}/${NODE_VERSION}/bin/activate}"

fail() { echo "deploy: $*" >&2; exit 1; }

# ---------------------------------------------------------------- checks before touching anything
if [[ ! -f "${APP_ROOT}/.env" ]]; then
  fail "missing ${APP_ROOT}/.env. The server-managed environment file must stay in place."
fi
[[ -f "${NODE_VENV}" ]] || fail "no Node.js environment found at ${NODE_VENV}. Create the Node.js app in cPanel first, or set NODE_VENV."

set +u
# shellcheck disable=SC1090
source "${NODE_VENV}"
set -u

export NODE_ENV=production
export CI=true
export NEXT_TELEMETRY_DISABLED=1
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

# Work from the account home while looking for processes, so this script's own folder is not
# mistaken for an app that needs stopping.
cd "${ACCOUNT_HOME}"

if git -C "${REPOSITORY_ROOT}" rev-parse HEAD >/dev/null 2>&1; then
  DEPLOY_COMMIT="$(git -C "${REPOSITORY_ROOT}" rev-parse HEAD)"
else
  DEPLOY_COMMIT="unknown"
fi
DEPLOY_SHORT_COMMIT="${DEPLOY_COMMIT:0:7}"
echo "Deploying ${DEPLOY_SHORT_COMMIT} from ${REPOSITORY_ROOT} at $(date -u +%Y-%m-%dT%H:%M:%SZ)."

# ---------------------------------------------------------------- stop the app
# LiteSpeed sometimes leaves lsnode workers alive after an app is stopped. Only processes whose
# working directory is exactly the app's folder and that are Node processes are touched, so a
# terminal someone left open in the folder is safe — and never this script or anything that
# started it.
PROTECTED_PIDS=" $$ "
walk_pid="$$"
while [[ -n "${walk_pid}" && "${walk_pid}" != "0" && "${walk_pid}" != "1" ]]; do
  # The parent is the second field after the ")" that closes the command name.
  walk_pid="$(sed 's/.*) //' "/proc/${walk_pid}/stat" 2>/dev/null | awk '{print $2}' || true)"
  if [[ -n "${walk_pid}" && "${walk_pid}" != "0" ]]; then PROTECTED_PIDS+="${walk_pid} "; fi
done

find_workers() {
  local wanted="$1" directory process_cwd pid
  for directory in /proc/[0-9]*; do
    pid="${directory##*/}"
    [[ "${PROTECTED_PIDS}" == *" ${pid} "* ]] && continue
    process_cwd="$(readlink "${directory}/cwd" 2>/dev/null || true)"
    [[ "${process_cwd}" == "${wanted}" ]] || continue
    # LiteSpeed's workers show up as "lsnode:<folder>"; a hand-started one as "node server.cjs".
    if tr '\0' ' ' < "${directory}/cmdline" 2>/dev/null | grep -qi 'node'; then printf '%s\n' "${pid}"; fi
  done
}

stop_app() {
  local label="$1" folder="$2" workers
  workers="$(find_workers "${folder}" | tr '\n' ' ')"
  if [[ -n "${workers// /}" ]]; then
    echo "Stopping lingering ${label} workers (verified by working directory): ${workers}"
    # shellcheck disable=SC2086
    kill -TERM ${workers} 2>/dev/null || true
    sleep 5
  fi
  workers="$(find_workers "${folder}" | tr '\n' ' ')"
  if [[ -n "${workers// /}" ]]; then
    echo "Graceful stop timed out; force-stopping ${label} workers: ${workers}"
    # shellcheck disable=SC2086
    kill -KILL ${workers} 2>/dev/null || true
    sleep 2
  fi
  workers="$(find_workers "${folder}" | tr '\n' ' ')"
  if [[ -n "${workers// /}" ]]; then
    fail "${label} workers keep respawning (${workers}). Stop the ${label} app from cPanel, then run the deploy again."
  fi
  echo "No ${label} workers remain."
}

stop_app "Healthfield" "${APP_ROOT}"

cd "${REPOSITORY_ROOT}"

# ---------------------------------------------------------------- dependencies (shared by both apps)
LOCK_FINGERPRINT="$(sha256sum pnpm-lock.yaml | awk '{print $1}')"
INSTALLED_FINGERPRINT="$(cat "${DEPENDENCY_MARKER}" 2>/dev/null || true)"
if [[ -d node_modules && -z "${INSTALLED_FINGERPRINT}" && "${INSTALL_DEPS:-0}" != "1" ]]; then
  echo "Bootstrapping the dependency marker from the existing installation."
  printf '%s\n' "${LOCK_FINGERPRINT}" > "${DEPENDENCY_MARKER}"
  INSTALLED_FINGERPRINT="${LOCK_FINGERPRINT}"
fi
if [[ "${INSTALL_DEPS:-0}" == "1" || ! -d node_modules || "${LOCK_FINGERPRINT}" != "${INSTALLED_FINGERPRINT}" ]]; then
  echo "Dependencies changed or are missing; installing with cPanel-safe limits..."
  "${PNPM_COMMAND[@]}" install --frozen-lockfile --prod=false --network-concurrency=1 --child-concurrency=1
  printf '%s\n' "${LOCK_FINGERPRINT}" > "${DEPENDENCY_MARKER}"
else
  echo "Dependency lockfile unchanged; using the existing installation."
fi

# ---------------------------------------------------------------- build everything first
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

STOREFRONT_REPLACED=0
restore_storefront() {
  # Runs when anything fails after the storefront build was started: the previous build goes back
  # so the site is not left with a half-written one.
  if [[ "${STOREFRONT_REPLACED}" == "1" && -d "${STOREFRONT_PREVIOUS}" ]]; then
    echo "Restoring the previous storefront build." >&2
    rm -rf "${STOREFRONT_BUILD}"
    mv "${STOREFRONT_PREVIOUS}" "${STOREFRONT_BUILD}"
    STOREFRONT_REPLACED=0
  fi
}
on_exit() {
  local status=$?
  if [[ ${status} -ne 0 ]]; then restore_storefront; fi
  rm -rf "${RELEASE_STAGE}" 2>/dev/null || true
  exit ${status}
}
trap on_exit EXIT

echo "Building the storefront (heap limit ${BUILD_MEMORY_MB} MB)..."
rm -rf "${STOREFRONT_PREVIOUS}"
if [[ -d "${STOREFRONT_BUILD}" ]]; then mv "${STOREFRONT_BUILD}" "${STOREFRONT_PREVIOUS}"; fi
STOREFRONT_REPLACED=1
export RAYON_NUM_THREADS=1 UV_THREADPOOL_SIZE=2
BUILD_NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_MB} --v8-pool-size=1"
if [[ "${BUILD_SPLIT:-1}" == "1" ]]; then
  # One `next build` keeps the compiler's memory (about 1.4 GB) while it starts the worker that
  # renders the static pages, and a hosting account with a memory cap kills that worker (SIGABRT).
  # Run as two processes, the compiler's memory is freed before the pages are generated, and the
  # most either needs is about 1.4 GB and 0.5 GB.
  echo "  1/2 compiling..."
  NODE_OPTIONS="${BUILD_NODE_OPTIONS}" "${PNPM_COMMAND[@]}" exec next build --webpack --experimental-build-mode=compile
  # The compile step has already renamed the proxy file to the name the server uses; the
  # generate step looks for the original name once more, so it is put back as a copy.
  if [[ -f "${STOREFRONT_BUILD}/server/middleware.js" && ! -f "${STOREFRONT_BUILD}/server/proxy.js" ]]; then
    cp "${STOREFRONT_BUILD}/server/middleware.js" "${STOREFRONT_BUILD}/server/proxy.js"
    if [[ -f "${STOREFRONT_BUILD}/server/middleware.js.nft.json" ]]; then
      cp "${STOREFRONT_BUILD}/server/middleware.js.nft.json" "${STOREFRONT_BUILD}/server/proxy.js.nft.json"
    fi
  fi
  echo "  2/2 generating pages..."
  NODE_OPTIONS="${BUILD_NODE_OPTIONS}" "${PNPM_COMMAND[@]}" exec next build --webpack --experimental-build-mode=generate
else
  NODE_OPTIONS="${BUILD_NODE_OPTIONS}" "${PNPM_COMMAND[@]}" run build
fi
test -s "${STOREFRONT_BUILD}/BUILD_ID"
test -s "${STOREFRONT_BUILD}/server/middleware.js"

# ---------------------------------------------------------------- database
echo "Applying database migrations before the runtime swap..."
node scripts/migrate-api.mjs

# ---------------------------------------------------------------- swap in the new builds
COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
build_record() {
  printf '{"commit":"%s","builtAt":"%s","buildMode":"cpanel-source"}\n' "${DEPLOY_COMMIT}" "${COMPLETED_AT}"
}

rm -rf "${RELEASE_PREVIOUS}"
mkdir -p "${RELEASE_PREVIOUS}"
if [[ -d "${API_ROOT}/dist" ]]; then mv "${API_ROOT}/dist" "${RELEASE_PREVIOUS}/dist"; fi
if [[ -d "${API_ROOT}/drizzle" ]]; then mv "${API_ROOT}/drizzle" "${RELEASE_PREVIOUS}/drizzle"; fi
mv "${RELEASE_STAGE}/dist" "${API_ROOT}/dist"
mv "${RELEASE_STAGE}/drizzle" "${API_ROOT}/drizzle"
# The API reads this from the app's folder (/health reports it).
build_record > "${APP_ROOT}/.healthfield-build.json"
STOREFRONT_REPLACED=0

# ---------------------------------------------------------------- persistent files
mkdir -p "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions" "${APP_ROOT}/tmp"
chmod 750 "${STORAGE_ROOT}" "${STORAGE_ROOT}/uploads" "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions"
if [[ -d "${APP_ROOT}/public/uploads/products" ]]; then
  cp -an "${APP_ROOT}/public/uploads/products/." "${STORAGE_ROOT}/uploads/products/"
fi

# ---------------------------------------------------------------- ask Passenger to start it again
# Touching tmp/restart.txt is the supported way to make a cPanel Node app restart; it is harmless
# if the app is not registered yet.
touch "${APP_ROOT}/tmp/restart.txt"

echo "Deployed ${DEPLOY_SHORT_COMMIT} at ${COMPLETED_AT}."
echo "  App: ${APP_ROOT} (previous API release in ${RELEASE_PREVIOUS}, previous storefront build in ${STOREFRONT_PREVIOUS})"
echo "If the app does not come back by itself, start it from cPanel > Setup Node.js App, then check /health."
