# mifplace

An r/place clone for VU MIF: a shared pixel canvas where every user can place one pixel
every few minutes. Requirements live in `docs/requirements.md` (Lithuanian, IDs `FR-n` / `NFR-n`).

## Layout

- `backend/`: Node.js 24 + TypeScript (ESM), Express 5, SQLite via `better-sqlite3`.
  - `src/server.ts`: HTTP server, also serves the built frontend from `../frontend/dist`.
  - `src/db.ts`: connection settings and `MifDb`, the only data access layer.
  - `src/scripts/`: `migrate.ts`, `setup-db.ts`, `seed-events.ts` (dev only).
  - `migrations/`: `NNN_name.sql`, rules in `migrations/README.md`.
- `frontend/`: Vue 3 + Vite + TypeScript (`<script setup lang="ts">`).
- `docs/`: requirements and other project documents.

There is no root `package.json`: run every npm command inside `backend/` or `frontend/`.

## Commands

Backend (`cd backend`):

- `npm run check`: typecheck + lint + format:check + test, the same as CI. Run it before every push.
- `npm test`: unit tests (`node:test` via `tsx`, files `src/**/*.test.ts`).
- `npm run format`: fix formatting with Prettier.
- `cp .env.example .env && npm run db:setup:dev`: create the local database and apply migrations.
- `npm run build && npm start`: run the server at http://127.0.0.1:3000 (start it from `backend/`,
  static paths are resolved against the cwd). Build the frontend first if you need the UI.

Frontend (`cd frontend`):

- `npm run dev`: Vite dev server.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.
  CI does not check the frontend yet, so run these by hand when you change it.

## Workflow

- Every task has a ticket key `MP-<n>`. Branch: `feature/MP-<n>-short-description`.
- Commit subject: `MP-<n>: Imperative summary` in English, e.g. `MP-24: Add SQLite database and canvas data model`.
- Never push to `main`; every change goes through a PR and needs green CI (`.github/workflows/ci.yml`).
- Keep PRs to one ticket. If a change implements a requirement, name its ID in the PR
  and update its status in `docs/requirements.md` (requirement IDs are never reused or renumbered).

## Code conventions

- Prettier is the source of truth for formatting (single quotes, semicolons, width 100).
  Do not hand-format, run `npm run format`.
- Backend imports use the `.js` extension (`import { openDb } from './db.js'`), ESM requires it.
- Code, comments, identifiers and commit messages are in English. Comments explain *why*,
  in the style already used in `db.ts` and `server.ts`.
- New backend logic gets a `*.test.ts` next to it using `node:test` and `node:assert/strict`.
  Tests that need a database create one in a temp dir with the real migrations, see `db.test.ts`.
- Prefer the standard library (`node:fs`, `process.loadEnvFile`, ...) over new dependencies.
  Adding a dependency is a team decision: say why in the PR. `npm audit --audit-level=high` runs in CI.

## Invariants: do not break these

- **`events` is an append-only log.** Never `UPDATE` or `DELETE` its rows; a rollback or an
  admin change is a new event. The canvas state is rebuilt from this log.
- **Never edit an applied migration.** Checksums are verified and `db:setup` fails. Add a new
  `NNN_name.sql` with the next number (no gaps). No `BEGIN`/`COMMIT`, `VACUUM` or
  `PRAGMA journal_mode` inside a migration; table rebuilds need the `-- migrate:no-foreign-keys`
  marker. Read `backend/migrations/README.md` before writing one.
- **`DB_PATH` and `MIGRATIONS_DIR` have no defaults** on purpose, and `openDb` never creates a
  file. Do not add fallbacks: a wrong path must fail loudly instead of creating a second database.
- Database access goes through `MifDb` with prepared statements. No SQL built by string concatenation.
- A placed pixel is written to the log before the server answers the client (NFR-4).
  Cooldown, bans and permissions are always checked on the server, not only in the UI (NFR-8).
- Pixel authorship is never exposed publicly (NFR-11). Watch for this in APIs and statistics.

## Never commit

`.env` files (only `.env.example`), database files (`backend/data/`), `dist/`, `node_modules/`.
