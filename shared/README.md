# @mifplace/shared

What every workspace agrees on:

- the types of the HTTP API (the request and response shapes described in [docs/api.md](../docs/api.md)), in `src/index.ts`;
- the canvas geometry, in `src/position.ts`: a cell (x, y) is sent and stored as one number, `position = y * width + x`. `toPosition` (throws for a cell outside the canvas), `fromPosition` and `cellError` (why a cell is outside the canvas) are the only places that know the formula.

```ts
import { toPosition, type CanvasSize } from '@mifplace/shared';
```

The package is exported the same way as `@mifplace/db` (see [db/README.md](../db/README.md)): from its TypeScript sources under the `@mifplace/source` condition (dev scripts, Vitest, Vite) and from the built `dist/` for plain `node` in production. Only the code that runs on the server needs `npm run build -w shared`; Vite compiles the sources into the frontend bundle itself.

Rules about who may do what (palette, cooldown) do not belong here, they live in the backend (ADR-0005).
