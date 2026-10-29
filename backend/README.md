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
npm install
npm run setup
npm run build
npm start -w backend
```

`npm run setup` creates `.env` in the repository root (it holds `DB_PATH`, see `.env.example`)
and the database. The data access code and the migrations are in [`db`](../db/README.md).
`npm run dev` runs `@mifplace/db` from its TypeScript sources, `npm start` from the built `db/dist`.

### 3. The server should now be running at:

http://127.0.0.1:3000

## Scripts

### Build and run

- `npm run build` — Compile TypeScript (`tsconfig.build.json`) to `dist/`
- `npm run watch` — Auto-compile on changes
- `npm start` — Start the compiled server (`dist/server.js`)

### Code quality

- `npm run typecheck` — Type-check without emitting files
- `npm run lint` — Check code with ESLint
- `npm run format` — Format code with Prettier
- `npm run format:check` — Check formatting without changing files
- `npm test` — Run unit tests (Vitest, same runner as the frontend)
- `npm run test:watch` — Re-run tests on changes
- `npm run test:coverage` — Run tests with a coverage report in `coverage/`
- `npm run check` — Run typecheck, lint, format:check and test in a row (same as CI)

### Database

The database scripts live in [`db`](../db/README.md) (`db:setup:dev`, `db:setup:prod`) and
[`tools`](../tools/README.md) (`db:seed:dev`, `db:palette:export`).

## API

### GET /api/canvas

Returns the current canvas state.

Example response:

```json
{
  "width": 128,
  "height": 128,
  "pixels": [
    [5, 7],
    [10, 4]
  ]
}
```

Each entry in `pixels` is a pair: `[position, color_id]`.

- `position` — the pixel's position in the canvas.
- `color_id` — the ID of the pixel's latest color.
- Only the latest color for each position is returned.
- Positions not included in `pixels` are considered blank (white).

To convert a pixel's `position` into canvas coordinates:

```ts
const x = position % width;
const y = Math.floor(position / width);
```

Coordinates start at `(0, 0)` in the top-left corner.

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
