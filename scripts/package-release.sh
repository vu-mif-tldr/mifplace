#!/usr/bin/env bash
# Builds the project and packs release/mifplace-<version>.tar.gz: the compiled backend, its
# migrations and the built frontend. node_modules is not included: better-sqlite3 is a native
# module, so dependencies are installed on the machine that runs the release.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
name="mifplace-${version}"
stage="release/${name}"

# Old build output must not end up in the archive.
rm -rf backend/dist frontend/dist "$stage" "release/${name}.tar.gz"
npm run build

mkdir -p "$stage/backend" "$stage/frontend"
cp -R backend/dist backend/migrations "$stage/backend/"
cp backend/package.json backend/package-lock.json backend/.env.example "$stage/backend/"
cp -R frontend/dist "$stage/frontend/"
cp scripts/release-README.md "$stage/README.md"

# COPYFILE_DISABLE keeps macOS from adding ._ files to the archive.
COPYFILE_DISABLE=1 tar -czf "release/${name}.tar.gz" -C release "$name"
rm -rf "$stage"
echo "Created release/${name}.tar.gz"
