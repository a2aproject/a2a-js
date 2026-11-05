#!/usr/bin/env bash
#
# Runs the database suites against real Postgres and MySQL in containers.
#
# `npm test` on its own covers SQLite only: the Postgres and MySQL cases skip unless
# POSTGRES_TEST_DSN / MYSQL_TEST_DSN are set. This starts the databases, sets those,
# runs the suites, and tears the containers down again.
#
# CI does not use this script — it declares the same images as GitHub Actions
# `services:` and exports the same variables.
#
# Usage:
#   scripts/run_db_tests.sh [--postgres] [--mysql] [--debug] [--stop] [vitest args...]
set -euo pipefail

# Podman is CLI-compatible with docker for everything used here.
CONTAINER="${CONTAINER:-$(command -v docker || command -v podman || true)}"
if [[ -z "${CONTAINER}" ]]; then
  echo "Neither docker nor podman is installed. Set CONTAINER to a container CLI." >&2
  exit 1
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

PG_NAME=a2a-test-postgres
MY_NAME=a2a-test-mysql
PG_IMAGE=docker.io/library/postgres:17-alpine
MY_IMAGE=docker.io/library/mysql:8.0

DB_NAME=a2a_test
DB_USER=a2a
DB_PASS=a2a_password

# Off the default ports, so an already-running local Postgres or MySQL does not collide.
PG_PORT="${PG_PORT:-55432}"
MY_PORT="${MY_PORT:-33306}"

SPECS=(
  test/cli/database_push_notification_migrations.spec.ts
  test/cli/database_task_migrations.spec.ts
  test/server/database_push_notification_store.spec.ts
  test/server/database_task_store.spec.ts
)

debug=false
stop=false
services=()
vitest_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug) debug=true ;;
    --stop) stop=true ;;
    --postgres) services+=(postgres) ;;
    --mysql) services+=(mysql) ;;
    *) vitest_args+=("$1") ;;
  esac
  shift
done

[[ ${#services[@]} -eq 0 ]] && services=(postgres mysql)

wants() { [[ " ${services[*]} " == *" $1 "* ]]; }

remove() { "${CONTAINER}" rm --force "$1" >/dev/null 2>&1 || true; }

teardown() {
  echo "Stopping test databases..."
  wants postgres && remove "${PG_NAME}"
  wants mysql && remove "${MY_NAME}"
  # Otherwise the last `wants` sets the status, and from an EXIT trap that becomes the
  # script's: asking for a single engine would fail an otherwise passing run.
  return 0
}

if [[ "${stop}" == true ]]; then
  teardown
  exit 0
fi

# Waits for the server to accept queries, not merely for the container to exist. The
# probes run inside the container, so no client tools are needed on the host, and both
# go over TCP as the application user: while initialising, each image runs a temporary
# server that answers on its socket only, and a socket probe passes against that one
# seconds before the real server accepts a connection.
await() {
  local name="$1" label="$2"
  shift 2
  for _ in $(seq 60); do
    if "${CONTAINER}" exec "${name}" "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "${label} did not become ready in 60s." >&2
  "${CONTAINER}" logs --tail 20 "${name}" >&2 || true
  return 1
}

# Armed before anything starts, so a failure to start or to become ready still cleans up.
trap teardown EXIT

if wants postgres; then
  remove "${PG_NAME}"
  echo "Starting ${PG_IMAGE}..."
  "${CONTAINER}" run --detach --name "${PG_NAME}" \
    --env "POSTGRES_USER=${DB_USER}" \
    --env "POSTGRES_PASSWORD=${DB_PASS}" \
    --env "POSTGRES_DB=${DB_NAME}" \
    --publish "${PG_PORT}:5432" "${PG_IMAGE}" >/dev/null
  export POSTGRES_TEST_DSN="postgresql://${DB_USER}:${DB_PASS}@localhost:${PG_PORT}/${DB_NAME}"
fi

if wants mysql; then
  remove "${MY_NAME}"
  echo "Starting ${MY_IMAGE}..."
  "${CONTAINER}" run --detach --name "${MY_NAME}" \
    --env "MYSQL_ROOT_PASSWORD=root" \
    --env "MYSQL_DATABASE=${DB_NAME}" \
    --env "MYSQL_USER=${DB_USER}" \
    --env "MYSQL_PASSWORD=${DB_PASS}" \
    --publish "${MY_PORT}:3306" "${MY_IMAGE}" >/dev/null
  export MYSQL_TEST_DSN="mysql://${DB_USER}:${DB_PASS}@localhost:${MY_PORT}/${DB_NAME}"
fi

wants postgres && await "${PG_NAME}" PostgreSQL \
  pg_isready --host 127.0.0.1 --username "${DB_USER}" --dbname "${DB_NAME}"
wants mysql && await "${MY_NAME}" MySQL \
  mysqladmin ping --protocol=TCP --host 127.0.0.1 --user "${DB_USER}" --password="${DB_PASS}"

if [[ "${debug}" == true ]]; then
  # Leaving them up is the point of --debug, so disarm the teardown.
  trap - EXIT
  echo
  echo "Databases are up. Export these, then run vitest yourself:"
  echo
  [[ -n "${POSTGRES_TEST_DSN:-}" ]] && echo "  export POSTGRES_TEST_DSN=\"${POSTGRES_TEST_DSN}\""
  [[ -n "${MYSQL_TEST_DSN:-}" ]] && echo "  export MYSQL_TEST_DSN=\"${MYSQL_TEST_DSN}\""
  echo
  echo "Run 'scripts/run_db_tests.sh --stop' to shut them down."
  exit 0
fi

cd "${ROOT}"

# Serially: both suites drop and recreate the same tables.
npx vitest run --no-file-parallelism "${SPECS[@]}" ${vitest_args[@]+"${vitest_args[@]}"}
