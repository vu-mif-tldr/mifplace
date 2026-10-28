---
name: codecov-entry-points
description: Find entry points and dev-only scripts that unit tests never load and add them to the `ignore` list in codecov.yml, so they do not show 0% and pull the coverage totals down. Use when asked to check or update Codecov exclusions, when a new script, server or CLI file appears, or when Codecov shows a file at 0% that is only a launcher.
---

# Codecov: ignore entry points

Coverage is uploaded by `.github/workflows/ci.yml` (one `codecov/codecov-action` step per workspace) and configured in
`codecov.yml`. Files that only start something (a server, a CLI, the Vite app) are never imported by unit tests, so
they show 0%. This skill finds such files and keeps the `ignore` list in `codecov.yml` up to date.

The goal is an honest number, not a high one. Excluding a file hides every future line in it from Codecov, so only
files that contain wiring and no logic of their own may be ignored.

## 1. Collect candidates

Only workspaces whose report CI uploads count: read the `files:` inputs of the Codecov steps in `ci.yml`. Note the
other workspaces (for example `mcp`) in the report as "not uploaded, skipped".

A file is a candidate if something runs it directly instead of importing it:

- `package.json` of each workspace: `main`, and paths in `scripts` (`tsx src/...`, `node dist/...` mapped back to
  `src/*.ts`, `tsx watch src/...`).
- `Dockerfile`: `CMD` / `ENTRYPOINT` (`dist/...js` maps to `src/...ts`).
- `frontend/index.html`: `<script type="module" src="...">`.
- `.mcp.json.example`, `deploy/`, `scripts/*.mjs`: any `.ts` path they start.

## 2. Keep only real launchers

For every candidate check both, and record the evidence:

1. **Nobody imports it.** Search the workspace for imports of the file (`from './server.js'`, `'../scripts/migrate.js'`
   and so on), test files included. If any module or test imports it, it is a library, not an entry point: keep it.
2. **It has no logic worth testing.** Read it. Acceptable: reading env and config, opening the database, creating
   and mounting the app, `listen`, signal handlers, parsing `process.argv` and calling a function from another module,
   dev-only seeding. Not acceptable: validation, calculations, protocol handling, SQL beyond a single call. If it has
   such logic, do not ignore it; suggest moving the logic into a tested module instead.

Also look at the current coverage: run `npm run test:coverage` (Node 24) and read `*/coverage/lcov.info`. A real launcher
is at or near 0%. A candidate with noticeable coverage is imported by tests after all; recheck step 1.

Never use globs such as `backend/src/scripts/*.ts`: they silently drop tested modules (`scripts/migrate.ts` is tested)
and every future file in the directory. List files one by one.

## 3. Compare with codecov.yml

- New launchers not in `ignore`: add them, keeping the list grouped by workspace and sorted.
- Entries in `ignore` whose file no longer exists, or that is now imported or has gained logic: propose removing them.
- Keep the comment above `ignore` that says why these files are excluded.

## 4. Validate and report

```bash
npx prettier --write codecov.yml
curl -s --data-binary @codecov.yml https://codecov.io/validate
```

The second command must print `Valid!`. Then show the user:

- a table: file, how it is started, imported by (none), why it is a launcher, coverage before;
- files that were candidates but kept, with the reason (imported by X, contains logic Y);
- workspaces skipped because CI does not upload them;
- `git diff codecov.yml`.

Do not commit: the user reviews the change first. `ignore` affects Codecov only; mention that the local
`npm run test:coverage` still lists these files unless the same paths are added to `coverage.exclude` in the
workspace's `vitest.config.ts`.
