# Production image: the backend serves the API and the built frontend on one port.
# Docker is used for deployment only, local development runs without it (see docs/development.md).
# How the image gets to the server: deploy/README.md.

# Must match .nvmrc, CI passes the value from there.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
# Manifests first, so the npm ci layer is reused while the dependencies do not change.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY db/package.json db/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# --ignore-scripts: better-sqlite3 ships prebuilt binaries for Linux, but npm still
# tries to compile it with node-gyp because of its binding.gyp, which needs Python and a compiler.
# The only other install script is esbuild's optional binary check.
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY shared shared
COPY db db
COPY backend backend
COPY frontend frontend
RUN npm run build

# Production dependencies of the backend only (with @mifplace/db and @mifplace/shared): no frontend
# packages, no dev tools.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY db/package.json db/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace=backend --ignore-scripts

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
# @mifplace/db finds its migrations next to dist/ (db/migrations).
COPY db/migrations db/migrations
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/db/dist db/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
# The database lives in a volume mounted here. The directory belongs to node in the image,
# so a new named volume gets the same owner and the app can write to it.
RUN mkdir /data && chown node:node /data
USER node
# app.ts looks for the frontend in ../frontend/dist relative to the working directory.
WORKDIR /app/backend
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/mifplace.db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Creates the database on the first start and applies pending migrations. exec replaces the shell
# with Node, so the SIGTERM from docker stop reaches server.ts and the database is closed cleanly.
CMD ["sh", "-c", "node ../db/dist/setup-db.js && exec node dist/server.js"]
