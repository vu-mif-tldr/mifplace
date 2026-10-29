# tools

Development only scripts, they are not built and do not go into the Docker image. They read the
same root `.env` (`DB_PATH`) as the backend, see [`db/README.md`](../db/README.md).

- `npm run db:palette:export -w tools -- [palette.hex]` — Write the palette as a `.hex` file (one `rrggbb` per line) for an online pixel art editor, or to stdout if file name is not provided
- `npm run db:seed:dev -w tools -- <picture.png>` — Fill the `events` table with a PNG in the palette colors, see the header of `src/seed-png.ts` and the root README

A relative file name is taken from the directory the command was typed in (`INIT_CWD`), not from
`tools/`.
