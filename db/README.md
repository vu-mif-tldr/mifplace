# @mifplace/db

The SQLite database of mifplace: the data access layer (`MifDb`, `openDb`, `configureDb`,
`resolveDbPath`), the migrations and the script that creates the database. Used by `backend`,
`mcp` and `tools`, which list it in their `package.json`.

## Scripts

- `npm run db:setup:dev -w db` — Create the SQLite file (if missing) and apply pending migrations, runs from TypeScript via `tsx`
- `npm run db:setup:prod -w db` — Same, but runs the compiled `dist/setup-db.js` (run `npm run build` first). The Docker image runs it on every start
- `npm run build -w db` — Compile to `dist/`, needed only for production (`node`)
- `npm test -w db`, `npm run typecheck -w db`, `npm run lint -w db`

Migrations are described in [`migrations/README.md`](migrations/README.md).

## Settings: `.env` and `DB_PATH`

- There is one `.env` for the whole repository, in its root (copy `.env.example`, `npm run setup`
  does it). `loadDotEnv()` reads it from there whatever the working directory is, so the backend,
  `db:setup`, the tools and the MCP server see the same settings. Variables that are already set
  (shell, Docker `ENV`, CI, `.mcp.json`) win over the file.
- `DB_PATH` is required, there is no default. A relative value is resolved against the repository
  root (`REPO_ROOT`), wherever it comes from: `DB_PATH=./data/mifplace.db` is `<repo>/data/mifplace.db`
  for every workspace. In Docker it is absolute (`/data/mifplace.db`).
- The migrations directory is not a setting: it ships with this package (`MIGRATIONS_DIR`).

`REPO_ROOT` is two levels above the code of this package (`db/src/` or `db/dist/`), in Docker `/app`.

## Sources or `dist/`

`package.json` exports the package under three conditions:

- `types` — `src/index.ts`, for the TypeScript checks of the other workspaces;
- `@mifplace/source` — `src/index.ts`, for development: the dev npm scripts run `tsx` with
  `--conditions=@mifplace/source` and the Vitest configs list it in `ssr.resolve.conditions`, so
  `npm run dev`, the tests and the MCP server do not need a build and see edits at once;
- `default` — `dist/index.js`, for plain `node` in production.

A new consumer that runs the package from TypeScript needs the same condition. `@mifplace/shared` is
exported the same way; the frontend lists the condition in `resolve.conditions` of `vite.config.ts`.
