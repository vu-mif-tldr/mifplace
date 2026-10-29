# @mifplace/shared

What every workspace agrees on:

- **The HTTP API** ([docs/api.md](../docs/api.md)) as [zod](https://zod.dev) schemas, in `src/api.ts`. Each type is inferred from its schema (`type CanvasSize = z.infer<typeof CanvasSizeSchema>`), so the type and the run-time check are one definition. The backend checks requests with them, the frontend checks responses.
- **The canvas geometry**, in `src/position.ts`: a cell (x, y) is sent and stored as one number, `position = y * width + x`.
  - `cellSchema(size).safeParse({ x, y })` checks a cell and gives `{ success: true, data: position }` or `{ success: false, error }`, it never throws;
  - `toPosition` is the same check that throws, for code that must only see cells on the canvas;
  - `fromPosition` is the reverse.

```ts
import {
  PlacePixelRequestSchema,
  cellSchema,
  formatError,
  type CanvasSize,
} from '@mifplace/shared';

const body = PlacePixelRequestSchema.safeParse(req.body);
if (!body.success) return res.status(400).json({ success: false, error: formatError(body.error) });
```

`formatError` turns a failed check into one line, `field: message`, problems joined with `; `; the backend and the MCP server use it for their error texts.

## Adding a message

1. Write the schema in `src/api.ts` and infer its type with `z.infer`, next to the others.
2. Describe it in `docs/api.md` in the same pull request.
3. Check it with `safeParse` where it arrives: the backend for requests, the frontend for responses and live messages.

## How the package is loaded

The package is exported the same way as `@mifplace/db` (see [db/README.md](../db/README.md)): from its TypeScript sources under the `@mifplace/source` condition (dev scripts, Vitest, Vite) and from the built `dist/` for plain `node` in production. Only the code that runs on the server needs `npm run build -w shared`; Vite compiles the sources into the frontend bundle itself.

Rules about who may do what (palette, cooldown) do not belong here, they live in the backend (ADR-0005).
