#!/usr/bin/env bash
#
# Installs the package the way a user would and runs `a2a-db --help`.
#
# Builds, packs the tarball `npm publish` would upload, and installs it into throwaway
# projects outside the repo, so only what ships is available: a file missing from
# `files`, a wrong `bin` path or an import that only resolves inside the repo fails here.
# Needs network access for the installs.
#
# KYSELY_VERSION picks the Kysely installed next to it (default: the version in
# package-lock.json). On Node 20, pass 0.28.17: Kysely 0.28 is the last line that
# supports it.
#
# Usage:
#   scripts/package_smoke_test.sh
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# Creates an empty project named $1 under $WORK, cds into it, and installs the tarball
# along with any further arguments.
new_project() {
  mkdir "${WORK}/$1"
  cd "${WORK}/$1"
  shift
  echo '{ "name": "a2a-package-smoke", "private": true }' >package.json
  npm install --no-audit --no-fund "${TARBALL}" "$@"
}

cd "${ROOT}"
# There is no prepack script, so packing alone would ship whatever dist/ holds.
npm run build
TARBALL="${WORK}/$(npm pack --silent --pack-destination "${WORK}")"
# The lockfile's version rather than the latest, so a new Kysely release can't fail this
# check on changes that have nothing to do with it.
if [[ -z "${KYSELY_VERSION:-}" ]]; then
  KYSELY_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/kysely'].version")"
fi

# The CLI loads kysely before it reads its arguments, so even --help needs it.
new_project app "kysely@${KYSELY_VERSION}"
# The installed bin, as npx would find it. A bare `npx a2a-db` falls back to fetching a
# package of that name from the registry when the local one is missing.
./node_modules/.bin/a2a-db --help

# kysely is an optional peer. Without it the bin should say so, not crash on an import.
new_project bare
output="$(./node_modules/.bin/a2a-db --help 2>&1 || true)"
if ! grep -q 'a2a-db needs the "kysely" package' <<<"${output}"; then
  echo "a2a-db --help without kysely did not print the missing-kysely message:" >&2
  echo "${output}" >&2
  exit 1
fi

echo "Package smoke test passed."
