#!/bin/bash
# Deploys the whole system (storefront + API) from this checkout, in one run.
#
#   cPanel "Deploy HEAD Commit" runs this through .cpanel.yml; it can also be run by hand:
#   bash scripts/deploy.sh            deploy what is checked out now
#   bash scripts/deploy.sh --pull     first fast-forward to origin/main, then deploy
#
# Where things live is worked out from where this script is, so the checkout can sit in any
# folder of the cPanel account (for example ~/apps/arctik) without editing the script:
#
#   <root>/                 the Next.js storefront   (startup file: server.cjs)
#   <root>/api-service/     the Express API          (startup file: server.cjs)
#
# Optional settings, all read from the environment:
#   NODE_VERSION        Node selector version used to find the nodevenv (default 24)
#   STOREFRONT_VENV     full path of a nodevenv "bin/activate" to use instead of the guessed one
#   API_VENV            same, for the API (used only if the storefront one is not found)
#   STORAGE_ROOT        persistent uploads/prescriptions (default ~/healthfield-storage)
#   BUILD_MEMORY_MB     heap limit for the storefront build (default 2048)
#   INSTALL_DEPS=1      force a dependency install even if pnpm-lock.yaml is unchanged
#   SKIP_STOREFRONT=1   deploy only the API
#   SKIP_API=1          deploy only the storefront
#
# The order is chosen so that a failure leaves the running site as it was: both apps are
# stopped, everything is built and checked, the database is migrated, and only then are the
# new builds swapped in. A failed build puts the previous storefront build back.
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/.." && pwd)"
STOREFRONT_ROOT="${REPOSITORY_ROOT}"
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
BUILD_MEMORY_MB="${BUILD_MEMORY_MB:-2048}"
SKIP_STOREFRONT="${SKIP_STOREFRONT:-0}"
SKIP_API="${SKIP_API:-0}"

RELEASE_STAGE="${API_ROOT}/.release.next"
RELEASE_PREVIOUS="${API_ROOT}/.release.previous"
STOREFRONT_BUILD="${STOREFRONT_ROOT}/.next"
STOREFRONT_PREVIOUS="${STOREFRONT_ROOT}/.next.previous"
DEPENDENCY_MARKER="${API_ROOT}/.pnpm-lock.sha256"

# cPanel keeps each Node app's tools in ~/nodevenv/<app root relative to the home folder>/<version>.
RELATIVE_ROOT="${REPOSITORY_ROOT#"${ACCOUNT_HOME}"/}"
STOREFRONT_VENV="${STOREFRONT_VENV:-${ACCOUNT_HOME}/nodevenv/${RELATIVE_ROOT}/${NODE_VERSION}/bin/activate}"
API_VENV="${API_VENV:-${ACCOUNT_HOME}/nodevenv/${RELATIVE_ROOT}/api-service/${NODE_VERSION}/bin/activate}"

fail() { echo "deploy: $*" >&2; exit 1; }

# ---------------------------------------------------------------- checks before touching anything
if [[ "${SKIP_STOREFRONT}" == "1" && "${SKIP_API}" == "1" ]]; then fail "nothing to deploy (both SKIP_ flags are set)."; fi
if [[ "${SKIP_API}" != "1" && ! -f "${API_ROOT}/.env" ]]; then
  fail "missing ${API_ROOT}/.env. The server-managed API environment file must stay in place."
fi
if [[ "${SKIP_STOREFRONT}" != "1" && ! -f "${STOREFRONT_ROOT}/.env" ]]; then
  fail "missing ${STOREFRONT_ROOT}/.env. The server-managed storefront environment file must stay in place."
fi

ACTIVATE=""
for candidate in "${STOREFRONT_VENV}" "${API_VENV}"; do
  if [[ -f "${candidate}" ]]; then ACTIVATE="${candidate}"; break; fi
done
[[ -n "${ACTIVATE}" ]] || fail "no Node.js environment found. Looked for ${STOREFRONT_VENV} and ${API_VENV}. Create the Node.js app in cPanel first, or set STOREFRONT_VENV."

set +u
# shellcheck disable=SC1090
source "${ACTIVATE}"
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

# ---------------------------------------------------------------- stop the apps
# LiteSpeed sometimes leaves lsnode workers alive after an app is stopped. Only processes whose
# working directory is exactly an app's own folder and that are Node processes are touched, so a
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

[[ "${SKIP_API}" == "1" ]] || stop_app "API" "${API_ROOT}"
[[ "${SKIP_STOREFRONT}" == "1" ]] || stop_app "storefront" "${STOREFRONT_ROOT}"

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
if [[ "${SKIP_API}" != "1" ]]; then
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
fi

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

if [[ "${SKIP_STOREFRONT}" != "1" ]]; then
  echo "Building the storefront (heap limit ${BUILD_MEMORY_MB} MB)..."
  rm -rf "${STOREFRONT_PREVIOUS}"
  if [[ -d "${STOREFRONT_BUILD}" ]]; then mv "${STOREFRONT_BUILD}" "${STOREFRONT_PREVIOUS}"; fi
  STOREFRONT_REPLACED=1
  NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_MB}" "${PNPM_COMMAND[@]}" run build
  test -s "${STOREFRONT_BUILD}/BUILD_ID"
fi

# ---------------------------------------------------------------- database
if [[ "${SKIP_API}" != "1" ]]; then
  echo "Applying database migrations before the runtime swap..."
  node scripts/migrate-api.mjs
fi

# ---------------------------------------------------------------- swap in the new builds
COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
build_record() {
  printf '{"commit":"%s","builtAt":"%s","buildMode":"cpanel-source"}\n' "${DEPLOY_COMMIT}" "${COMPLETED_AT}"
}

if [[ "${SKIP_API}" != "1" ]]; then
  rm -rf "${RELEASE_PREVIOUS}"
  mkdir -p "${RELEASE_PREVIOUS}"
  if [[ -d "${API_ROOT}/dist" ]]; then mv "${API_ROOT}/dist" "${RELEASE_PREVIOUS}/dist"; fi
  if [[ -d "${API_ROOT}/drizzle" ]]; then mv "${API_ROOT}/drizzle" "${RELEASE_PREVIOUS}/drizzle"; fi
  mv "${RELEASE_STAGE}/dist" "${API_ROOT}/dist"
  mv "${RELEASE_STAGE}/drizzle" "${API_ROOT}/drizzle"
  build_record > "${API_ROOT}/.healthfield-build.json"
fi
if [[ "${SKIP_STOREFRONT}" != "1" ]]; then
  build_record > "${STOREFRONT_ROOT}/.healthfield-build.json"
  STOREFRONT_REPLACED=0
fi

# ---------------------------------------------------------------- persistent files
mkdir -p "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions" "${API_ROOT}/tmp" "${STOREFRONT_ROOT}/tmp"
chmod 750 "${STORAGE_ROOT}" "${STORAGE_ROOT}/uploads" "${STORAGE_ROOT}/uploads/products" "${STORAGE_ROOT}/prescriptions"
if [[ -d "${STOREFRONT_ROOT}/public/uploads/products" ]]; then
  cp -an "${STOREFRONT_ROOT}/public/uploads/products/." "${STORAGE_ROOT}/uploads/products/"
fi

# ---------------------------------------------------------------- ask Passenger to start them again
# Touching tmp/restart.txt is the supported way to make a cPanel Node app restart; it is harmless
# if the app is not registered yet.
[[ "${SKIP_API}" == "1" ]] || touch "${API_ROOT}/tmp/restart.txt"
[[ "${SKIP_STOREFRONT}" == "1" ]] || touch "${STOREFRONT_ROOT}/tmp/restart.txt"

echo "Deployed ${DEPLOY_SHORT_COMMIT} at ${COMPLETED_AT}."
[[ "${SKIP_API}" == "1" ]] || echo "  API:        ${API_ROOT} (previous release kept in ${RELEASE_PREVIOUS})"
[[ "${SKIP_STOREFRONT}" == "1" ]] || echo "  Storefront: ${STOREFRONT_ROOT} (previous build kept in ${STOREFRONT_PREVIOUS})"
echo "If either app does not come back by itself, start it from cPanel > Setup Node.js App, then check /health on the API."
