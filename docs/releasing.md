# Releasing

A release is a `tar.gz` archive with the compiled backend, its migrations and the built frontend
(no `node_modules`: `better-sqlite3` is native and is installed on the target machine). The run
instructions for the user are in `scripts/release-README.md`, they end up as `README.md` in the
archive.

## Cutting a release

1. In a PR set the new version in the root, `backend` and `frontend` `package.json` and in their
   lock files (`npm pkg set version=X.Y.Z` in each folder, then `npm install --package-lock-only`).
2. Merge the PR into `main`.
3. Tag the merge commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `Release` workflow checks that the tag matches the version, runs `npm run check`, builds
   the archive and publishes a GitHub release with it (versions `0.x` are marked as pre-release).
   Edit the generated release notes if needed.

## Building the archive locally

`npm run package` creates `release/mifplace-<version>.tar.gz`. The folder is git-ignored.
