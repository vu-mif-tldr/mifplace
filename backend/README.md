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
cd frontend
npm install
npm run build

cd ../backend
npm install
cp .env.example .env
npm run db:setup:dev
npm run build
npm start
```

`.env` holds `DB_PATH` and `MIGRATIONS_DIR` (required for the database scripts), see `.env.example`.

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

- `npm run db:setup:dev` — Create the SQLite file (if missing) and apply pending migrations, runs from TypeScript via `tsx`
- `npm run db:setup:prod` — Same, but runs the compiled `dist/scripts/setup-db.js` (run `npm run build` first)
- `npm run db:palette:export -- [palette.hex]` — Write the palette as a `.hex` file (one `rrggbb` per line) for an online pixel art editor, or to stdout if file name is not provided
- `npm run db:seed:dev -- <picture.png>` — Dev only: fill the `events` table with a PNG in the palette colors, see the header of `src/scripts/seed-png.ts` and the root README

Migrations are described in [`migrations/README.md`](migrations/README.md).

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
