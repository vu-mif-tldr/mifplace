# Development

Everything needed to work on mifplace locally. Production: [deploy/README.md](../deploy/README.md). API contract: [api.md](api.md).

## Setup

Node 24 (`.nvmrc`) and npm 11+. Run everything from the repository root.

```bash
nvm use
npm install
npm run setup   # .env from .env.example, creates data/mifplace.db
npm run dev     # backend on :3000, frontend on :5173
```

`npm run setup` is safe to repeat: it keeps an existing `.env` and only applies new migrations.

**Without a local install:** GitHub → Code → Codespaces → Create codespace on main. The dev container runs `npm ci` and `npm run setup` itself, then `npm run dev` is enough. Codespaces hours are per person, so stop a codespace you do not use.

### Updating an older checkout

Before the move to npm workspaces (pull requests #26 and #52), each package had its own `node_modules`, the settings were in `backend/.env` and the database was in `backend/data/`. After pulling:

```bash
nvm use
rm -rf node_modules backend/node_modules frontend/node_modules backend/package-lock.json frontend/package-lock.json
npm install
mv backend/.env .env && mv backend/data data   # or skip this to start with a new database
npm run setup
npm run setup:mcp -- --force                   # only if you use the MCP server
```

Then delete the `MIGRATIONS_DIR` line from `.env`. If you have a feature branch, rebase it onto `main`; the [layout](#repository-layout) shows where the files went.

## Repository layout

| Workspace  | What                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| `shared`   | API schemas and types (zod), canvas geometry, see [shared/README.md](../shared/README.md) |
| `db`       | SQLite access (`MifDb`), migrations, `db:setup`, see [db/README.md](../db/README.md)      |
| `backend`  | Express server: HTTP API, serves the built frontend in production                         |
| `frontend` | Vue app                                                                                   |
| `mcp`      | Read-only MCP server for Claude Code                                                      |
| `tools`    | Development-only scripts (seed, palette export), not in the Docker image                  |

`scripts/` has the Node scripts behind `setup`, `setup:mcp` and `clean`; `prototypes/` holds earlier research (MP-34).

## Commands

From the root. Commands with `-w <workspace>` can also be run for one workspace, for example `npm test -w backend`.

| Command                                         | What it does                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`                                   | Backend and frontend with reload (`dev:backend`, `dev:frontend` for one)           |
| `npm run check`                                 | Typecheck, lint, format check, tests: what CI runs                                 |
| `npm test` / `npm run test:coverage`            | Tests of all workspaces / with coverage in `<workspace>/coverage/`                 |
| `npm run format`                                | Prettier on the whole repository                                                   |
| `npm run build`                                 | Builds `shared`, `db`, `backend`, `frontend` to `dist/`                            |
| `npm start -w backend`                          | Runs the built server (`npm run build` first)                                      |
| `npm run clean` / `npm run clean:all`           | Removes build output / and `node_modules` (`npm install` again afterwards)         |
| `npm run setup`                                 | Creates `.env` and the database, applies migrations                                |
| `npm run db:setup:dev -w db`                    | Creates the database and applies pending migrations (`db:setup:prod` runs `dist/`) |
| `npm run db:palette:export -w tools -- [file]`  | Writes the palette as a `.hex` file, or to stdout                                  |
| `npm run db:seed:dev -w tools -- <picture.png>` | Fills the canvas with a PNG, see [Seed a picture](#seed-a-picture)                 |
| `npm run setup:mcp`                             | Creates `.mcp.json` for this checkout (`-- --force` overwrites it)                 |

## Settings (`.env`)

There is one `.env` in the root (copy of `.env.example`). The backend, `db:setup`, the tools and the MCP server all read it. Variables from the shell, Docker or `.mcp.json` win over the file.

| Variable  | Default     | Meaning                                                                  |
| --------- | ----------- | ------------------------------------------------------------------------ |
| `DB_PATH` | none        | SQLite file, required. A relative path is taken from the repository root |
| `PORT`    | `3000`      | Backend port                                                             |
| `HOST`    | `127.0.0.1` | Backend address; `0.0.0.0` in Docker                                     |

## Database

- **Migrations:** `db/migrations/NNN_name.sql`, rules in [db/migrations/README.md](../db/migrations/README.md). `npm run setup` applies new ones.
- **Writers:** while the backend runs, it is the only process that writes to the database (ADR-0005). Run `db:seed:dev` with the backend stopped; reading (export, MCP) is fine at any time.
- **Inspect it:** through the MCP server (below), or `sqlite3 data/mifplace.db`.

### Another canvas size

The size is stored in the `canvas` table (default 128×128) and read at start, so restart the backend and reload the page after a change. Change it only on a new database: a position is `y * width + x`, so old pixels would move.

```bash
export DB_PATH=./data/canvas-200x100.db
npm run db:setup:dev -w db
node -e "require('better-sqlite3')(process.env.DB_PATH).prepare('UPDATE canvas SET width = ?, height = ?').run(200, 100)"
npm run dev
```

`DB_PATH` from the shell wins over `.env`, so only this terminal uses the new database.

### Seed a picture

Every pixel of a PNG becomes an event of user 0. The picture is not converted, so prepare it in the palette colors:

1. `npm run db:palette:export -w tools -- palette.hex`
2. In a pixel art editor such as [Image-to-Pixel](https://tezumie.github.io/Image-to-Pixel/editor/), import `palette.hex`, set the canvas size, export a PNG at scale 1.
3. `npm run db:seed:dev -w tools -- picture.png` (backend stopped).

The picture starts at the top left corner; the part outside the canvas is skipped. A color outside the palette stops the script before anything is written. Relative file names are taken from the directory the command is typed in. Seeding again paints over; recreate the database for an empty canvas.

## MCP server

A read-only MCP server for Claude Code. It reads the database through `@mifplace/db` and does not need the backend to run.

- **Set up:** `npm run setup:mcp`, then restart Claude Code or reconnect the server with `/mcp`. It takes `DB_PATH` from `.env`.
- **Tools:** `canvas_size`, `palette`, `pixel_history` (events of one cell). **Resource:** `mifplace://schema` (the SQL schema).
- **Does not start:** an `.mcp.json` from before #52 points to `backend/data/`. Run `npm run setup:mcp -- --force`.

## Editor

VS Code with the Prettier (`esbenp.prettier-vscode`), ESLint (`dbaeumer.vscode-eslint`) and Vue (`Vue.volar`) extensions. `.vscode/` recommends them and turns on format on save with Prettier.

## Pull requests and CI

`main` is protected: work on a branch and open a pull request. CI runs `npm run check`, the build and the tests with coverage on every pull request, plus `npm audit`, CodeQL, the Docker image build and an automatic Claude code review.

- **Coverage** goes to [Codecov](https://codecov.io/gh/vu-mif-tldr/mifplace), one flag per workspace. Components and ignored entry points are in `codecov.yml`. The checks are informational and do not block merging.
- **Test results** (JUnit) go to Codecov Test Analytics, which shows failed, flaky and slow tests.
- **`package-lock.json` conflicts:** see [troubleshooting.md](troubleshooting.md).

## Further reading

- [api.md](api.md): the HTTP and WebSocket contract.
- [requirements.md](requirements.md): FR and NFR.
- Architecture decisions (ADRs): [Confluence](https://tldr-mif.atlassian.net/wiki/spaces/MP/pages/9076737).
