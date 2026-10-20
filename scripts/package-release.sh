#!/usr/bin/env bash
# Builds the project and packs release/mifplace-<version>.tar.gz: the compiled backend with the
# packages it uses (shared, server-lib, db with its migrations) and the built frontend.
# The archive is a small npm workspace of its own (package.json and package-lock.json at the
# root, made here). node_modules is not included: better-sqlite3 is a native module, so
# dependencies are installed on the machine that runs the release.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
name="mifplace-${version}"
stage="release/${name}"

# Old build output must not end up in the archive.
rm -rf shared/dist server-lib/dist db/dist backend/dist frontend/dist "$stage" "release/${name}.tar.gz"
npm run build

# The packages that run on the server, in the order of their dependencies.
server_packages=(shared server-lib db backend)
for p in "${server_packages[@]}"; do
  mkdir -p "$stage/$p"
  cp "$p/package.json" "$stage/$p/"
  cp -R "$p/dist" "$stage/$p/"
done
cp -R db/migrations "$stage/db/"
cp backend/.env.example "$stage/backend/"
mkdir -p "$stage/frontend"
cp -R frontend/dist "$stage/frontend/"
cp scripts/release-README.md "$stage/README.md"
find "$stage" -name .tsbuildinfo -delete

# The workspace root of the archive: only the server packages. The lock file starts from the
# one of the repository, so the versions stay the same; npm drops what is not needed.
node -e '
const root = require("./package.json");
const workspaces = process.argv.slice(2);
const pkg = { name: root.name, private: true, version: root.version, workspaces, engines: root.engines };
process.stdout.write(JSON.stringify(pkg, null, 2) + "\n");
' "${server_packages[@]}" > "$stage/package.json"
cp package-lock.json "$stage/"
(cd "$stage" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund)

# COPYFILE_DISABLE keeps macOS from adding ._ files to the archive.
COPYFILE_DISABLE=1 tar -czf "release/${name}.tar.gz" -C release "$name"
rm -rf "$stage"
echo "Created release/${name}.tar.gz"
