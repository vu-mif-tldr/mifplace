## Backend

using Node.js, typescript, package manager npm

## Requirements

- Node.js 24.x (justification: Stable LTS)
- npm 11+

## Setup

### 1. Check if you have node, npm and git

```
node --version
npm --version
git --version
```

### 2. Go to mifplace folder in Command Prompt and run these commands, scripts

```
npm install                 # all packages at once, also builds shared, server-lib and db
npm run build               # frontend and backend

cd backend
cp .env.example .env
npm run db:setup:dev
npm start
```

`.env` holds `DB_PATH` (required for the database scripts), see `.env.example`.

For development `npm run dev` in the repository root starts the backend and the frontend
(Vite) together and recompiles the shared packages on change.

### 3. The server should now be running at:

http://127.0.0.1:3000

## Scripts

Run them in the repository root, they go through all packages (see
[`../docs/repository.md`](../docs/repository.md)). The scripts below are the ones of `backend/`.

### Build and run

- `npm run build` — Compile TypeScript (`tsconfig.build.json`) to `dist/`
- `npm run dev` — Start the server with auto-reload (`tsx watch`)
- `npm start` — Start the compiled server (`dist/server.js`)

### Code quality

In the repository root, for all packages:

- `npm run typecheck` — Type-check without emitting files
- `npm run lint` — Check code with ESLint
- `npm run format` — Format code with Prettier
- `npm run format:check` — Check formatting without changing files
- `npm test` — Run unit tests (`node:test` via `tsx`, `vitest` in the frontend)
- `npm run check` — Run typecheck, lint, format:check and test in a row (same as CI)

### Database

The code is in the [`db`](../db) package, run these in `backend/` (`.env` is read from there):

- `npm run db:setup:dev` — Create the SQLite file (if missing) and apply pending migrations, runs from TypeScript via `tsx`
- `npm run db:setup:prod` — Same, but runs the compiled `mifplace-db-setup` (run `npm run build` first)
- `npm run db:seed:dev -- <sprite.c> [offsetX] [offsetY]` — Dev only: fill the `events` table with a sprite exported as a C array, see the header of `tools/src/seed-events.ts`

Migrations are described in [`db/migrations/README.md`](../db/migrations/README.md).

## Editor Setup

### Recommended VS Code Extensions

- **ESLint** (`dbaeumer.vscode-eslint`) — for error checking
- **Prettier** (`esbenp.prettier-vscode`) — for formatting

### How to install

1. Open VS Code
2. Press `Ctrl + Shift + X`
3. Search for "dbaeumer.vscode-eslint" then Install
4. Search for "esbenp.prettier-vscode" then Install

### VS Code Settings after installing

1. Press `Ctrl + Shift + P`
2. Search for Preferences: Open Settings (UI)
3. then search format
4. Checkmark on Editor: Format on save
5. Change Editor: Default formatter on dropdown to Prettier - Code formatter
