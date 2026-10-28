# mifplace

r/place klonas benda pikselių drobė, kurioje kiekvienas gali idėti po vieną pikselį kas kelias minutes.

## Vietinis paleidimas

```bash
npm install
npm run setup   # sukuria backend/.env ir vietinę duomenų bazę
npm run dev     # backend (3000) ir frontend (5173) kartu
```

Reikia Node 24 (`nvm use`). Kitos komandos: `npm run check`, `npm run test:coverage`, `npm run clean`.

MCP serveris (Claude Code): `npm run setup:mcp` sukuria `.mcp.json` iš `.mcp.json.example` su šio katalogo keliais.

Diegimas į serverį: [deploy/README.md](deploy/README.md).

## Komandos nariai

- Dmitrij Kosmakov
- Rokas Petronis
- Lukas Vielius
- Renatas Podberiozko
- Lukas Petkevicius
- Titas Mockevicius
