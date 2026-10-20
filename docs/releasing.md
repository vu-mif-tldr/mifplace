# Releasing

A release is a `tar.gz` archive with the compiled backend and the packages it uses (shared,
server-lib, db with its migrations) and the built frontend. The archive is a small npm workspace
with its own `package.json` and `package-lock.json`, made by the packaging script (no
`node_modules`: `better-sqlite3` is native and is installed on the target machine). The run
instructions for the user are in `scripts/release-README.md`, they end up as `README.md` in the
archive.

## Cutting a release

1. In a PR set the new version in the root `package.json` and in `package-lock.json`
   (`npm version X.Y.Z --no-git-tag-version`). Only the root version counts, the versions of the
   workspace packages are not used.
2. Merge the PR into `main`.
3. Tag the merge commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `Release` workflow checks that the tag matches the version, runs `npm run check`, builds
   the archive and publishes a GitHub release with it (versions `0.x` are marked as pre-release).
   Edit the generated release notes if needed.

## Building the archive locally

`npm run package` creates `release/mifplace-<version>.tar.gz`. The folder is git-ignored.
