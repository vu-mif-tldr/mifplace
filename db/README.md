# @mifplace/db

The SQLite database: the data access layer (`MifDb`, `openDb`, `configureDb`, `resolveDbPath`), the migrations and `setup-db.ts`, which creates the database. Used by `backend`, `mcp` and `tools`. Commands and `.env`: [docs/development.md](../docs/development.md). Migration rules: [migrations/README.md](migrations/README.md).

## Paths

- `loadDotEnv()` reads `<repo>/.env`, whatever the working directory is.
- `resolveDbPath()` resolves a relative `DB_PATH` against the repository root (`REPO_ROOT`), so every workspace opens the same file.
- `REPO_ROOT` is two levels above the code (`db/src/` or `db/dist/`), in Docker `/app`.
- The migrations ship with the package (`MIGRATIONS_DIR`, next to `src/` and `dist/`), so there is no setting for them.

## Sources or `dist/`

`package.json` exports the package under three conditions:

| Condition          | Target          | Used by                                                                           |
| ------------------ | --------------- | --------------------------------------------------------------------------------- |
| `types`            | `src/index.ts`  | TypeScript checks of the other workspaces                                         |
| `@mifplace/source` | `src/index.ts`  | Development: `tsx --conditions=@mifplace/source`, Vitest `ssr.resolve.conditions` |
| `default`          | `dist/index.js` | Plain `node` in production                                                        |

With the source condition `npm run dev`, the tests and the MCP server need no build and see edits at once. A new consumer that runs the package from TypeScript needs the same condition. `@mifplace/shared` is exported the same way; the frontend sets the condition in `vite.config.ts`.
