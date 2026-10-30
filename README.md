# mifplace

[![codecov](https://codecov.io/gh/vu-mif-tldr/mifplace/graph/badge.svg)](https://codecov.io/gh/vu-mif-tldr/mifplace)

An r/place clone: a shared pixel canvas where everyone can place one pixel every few minutes.

## Quick start

Node 24 (`nvm use`), then from the repository root:

```bash
npm install
npm run setup   # .env and the local database
npm run dev     # backend on :3000, frontend on :5173
```

Or open it in GitHub Codespaces without installing anything.

## Documentation

- [docs/development.md](docs/development.md): setup, commands, settings, database, MCP server, CI
- [docs/api.md](docs/api.md): HTTP and WebSocket API
- [docs/requirements.md](docs/requirements.md): requirements
- [deploy/README.md](deploy/README.md): the demo server
- [docs/troubleshooting.md](docs/troubleshooting.md): common problems
- Architecture decisions: [Confluence](https://tldr-mif.atlassian.net/wiki/spaces/MP/pages/9076737)

## Team

- Dmitrij Kosmakov
- Rokas Petronis
- Lukas Vielius
- Renatas Podberiozko
- Lukas Petkevicius
- Titas Mockevicius
- Klaudija Antropikienė
- Gėpėtė Openaitytė
