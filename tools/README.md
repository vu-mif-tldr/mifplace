# Tools

Dev-only TypeScript utilities. They are not part of the application and are not in the release
archive. Shell scripts live in [`../scripts`](../scripts).

- `src/seed-events.ts` — fills the `events` table with a sprite, run it from `backend/` (where
  `.env` is) with `npm run db:seed:dev -- <sprite.c> [offsetX] [offsetY]`
- `src/bench-canvas-format.ts` — compares sizes of canvas formats, `npm run bench-canvas-format -w tools -- <sprite.c>`
