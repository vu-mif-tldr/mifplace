# mifplace

`mifplace` yra I kurso MIF VU studentų semestro projektas – `r/place` klonas su bendra pikselių drobe.

## Idėja

- Kiekvienas vartotojas gali padėti po vieną pikselį kas kelias minutes (cooldown).
- Drobės pokyčiai transliuojami realiu laiku per WebSocket.
- Visi pakeitimai saugomi SQLite bazėje, kad semestro pabaigoje būtų galima sugeneruoti timelapse.

## Paleidimas

```bash
npm install
npm run dev
```

Aplikacija paleidžiama `http://localhost:3000`.

## API

- `GET /api/canvas` – grąžina esamą drobės būseną.
- `POST /api/pixels` – uždeda pikselį (`userId`, `x`, `y`, `color`).
- `GET /api/timelapse` – grąžina visų pakeitimų chronologiją timelapse generavimui.
- `GET /health` – sveikatos patikra.

## Realaus laiko įvykiai

Prisijungus prie `ws://localhost:3000/ws`, siunčiamas `pixel_placed` įvykis su nauju pakeitimu.

## Konfigūracija

- `PORT` (numatytas `3000`)
- `CANVAS_WIDTH` (numatytas `128`)
- `CANVAS_HEIGHT` (numatytas `128`)
- `COOLDOWN_MS` (numatytas `300000`, t. y. 5 min)
- `DB_PATH` (numatytas `./mifplace.sqlite`)
