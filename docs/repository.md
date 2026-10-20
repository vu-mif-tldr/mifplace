# Repository layout

One npm workspace: a single `npm install` in the root installs everything, there is one
`package-lock.json`. Shared configs (`tsconfig.base.json`, `tsconfig.node.json`,
`eslint.config.js`, `.prettierrc`) are in the root.

| Folder        | Package                | What it is                                                                 |
| ------------- | ---------------------- | -------------------------------------------------------------------------- |
| `shared/`     | `@mifplace/shared`     | Types and wire formats used by the server and the browser: `Color`, the `GET /api/canvas` body, the `/api/ws` messages, log level names. No Node and no DOM APIs. |
| `server-lib/` | `@mifplace/server-lib` | Node helpers: `.env` loading and `envInt`, the server logger.              |
| `db/`         | `@mifplace/db`         | SQLite access (`MifDb`), the migrations and the `mifplace-db-setup` command. |
| `backend/`    | `backend`              | The HTTP server and WebSocket updates.                                     |
| `frontend/`   | `frontend`             | The Vue app (Vite).                                                        |
| `tools/`      | `@mifplace/tools`      | Dev-only TypeScript utilities, not in the release.                         |
| `scripts/`    | —                      | Shell scripts (the release archive).                                       |

## Dependencies between packages

```
shared  <-  server-lib  <-  db  <-  backend, tools
shared  <-  frontend, backend
```

`shared` depends on nothing, nothing in it may use Node or browser APIs (its build config has
`"types": []`). Authentication has no package yet; it should not go into `db` before it is
decided where it lives.

## Libraries are built

`shared`, `server-lib` and `db` are compiled with `tsc -b` to `dist/` and used from there, like
any library; `backend` runs as `node dist/server.js` and needs the compiled code anyway.
`npm install` builds them (the `prepare` script), `npm run dev` rebuilds them on change.
If a typecheck or a test complains about a missing `dist/` or an old type, run
`npm run build:libs`.

## Adding a package

1. Add the folder to `workspaces` in the root `package.json`, in dependency order.
2. `tsconfig.json` extends `../tsconfig.node.json` (Node) or `../tsconfig.base.json` (browser);
   for a library add `tsconfig.build.json` with `references` and add it to `build:libs`.
3. Add the globals of its environment in the root `eslint.config.js` if it is not Node or browser.
