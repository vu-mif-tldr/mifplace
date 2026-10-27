# @mifplace/shared

Types shared by `backend` and `frontend`: the request and response shapes of the HTTP API described in [docs/api.md](../docs/api.md).

The package has no runtime code and no build step. `package.json` points `types` straight at `src/index.ts`, so import it only with `import type`:

```ts
import type { CanvasState } from '@mifplace/shared';
```

The import is erased at compile time, so neither the backend `dist/` nor the frontend bundle depends on this package at runtime. If the package ever gets runtime code (for example validators), it needs a build step and a `default` export condition.
