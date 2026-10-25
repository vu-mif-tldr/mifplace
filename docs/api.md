# Mifplace API Contract

**Purpose:** Agree on HTTP and WebSocket formats so frontend and backend can be developed independently.

## 1. HTTP endpoints

### `GET /api/palette`

**200 OK** — available colors:

```json
[
  { "id": 0, "color": "#000000" },
  { "id": 5, "color": "#FFFFFF" },
  { "id": 12, "color": "#FF0000" }
]
```

`id` is the color identifier, and `color` is a `#RRGGBB` string. IDs may be non-consecutive and need not start at zero. Clients must not use array indexes as color IDs.

**Error:** If the server cannot retrieve the palette, it returns `500 Internal Server Error`:

```json
{
  "success": false,
  "error": "Internal server error"
}
```

### `GET /api/canvas`

**200 OK** — current canvas snapshot:

```json
{
  "width": 3,
  "height": 2,
  "pixels": [[0, 5], [4, 12]],
  "cursor": "102:1760000000000"
}
```

- `width`, `height`: canvas dimensions.
- `pixels`: `[position, colorId]` pairs, matching the current canvas-state representation. Only the latest color for each painted position appears.
- `position = y * width + x`, starting from zero at the top-left.
- `cursor`: `<id>:<ts>` of the **last event included in this snapshot**. `ts` is a Unix timestamp in milliseconds; use `"0:0"` for an empty event log.

The snapshot and cursor must represent the **same event-history point**, so updates cannot be missed when connecting to WebSocket.

**Error:** If the canvas snapshot cannot be loaded, the server returns `500 Internal Server Error`:

```json
{
  "success": false,
  "error": "Internal server error"
}
```

The server must not return a partial snapshot with status `200 OK`.

**Unpainted pixels:** Positions omitted from the `pixels` array represent unpainted cells. The frontend renders them using the canvas background color. They must not be interpreted as palette color ID `0`.

### `POST /api/pixels`

The existing endpoint remains the way to place pixels. `colorIndex` means **palette `id`**, not the index in the palette array.

**Request:** `Content-Type: application/json`

```json
{ "x": 1, "y": 1, "colorIndex": 12 }
```

`x` and `y` must be integers within the canvas bounds (`0 <= x < width`, `0 <= y < height`); `colorIndex` must identify an existing palette color.

**201 Created:**

```json
{ "success": true, "eventId": 103 }
```

**Existing error responses:**

| Status | Case | JSON response 
|  ---   | ---  | --- 
| `400`  | Non-integer coordinates | `{"success":false,"error":"Coordinates are not a number"}` 
| `400`  | Outside canvas | `{"success":false,"error":" Position not in canvas"}` 
| `400`  | Invalid color | `{"success":false,"error":"Color not in palette"}` 
| `500`  | Database insert failure | `{"success":false,"error":"Insert failed"}` 

**Implementation note:** Current backend validation checks `colorIndex` against `paletteSize`, which does not support non-consecutive IDs. The backend will need to validate actual palette IDs; the POST request/response shape stays unchanged.

## 2. WebSocket — `/api/ws?after=<id>:<ts>`

WebSocket sends **server → client JSON text messages only**. Pixel placement still uses HTTP POST.

The `after` cursor is optional:
- **Provided:** validate `id` and `ts`, replay events **after** that cursor, then send new events.
- **Omitted:** send **only new events**; do not replay history.

The timestamp is required because restoring a database backup may reuse an event ID for a different event (ADR-0003, risk R2).

### `pixels` — updates

```json
{
  "type": "pixels",
  "pixels": [[103, 4, 12], [104, 5, 5]],
  "cursor": "104:1760000000100"
}
```

Each entry is `[eventId, position, colorId]`. The server batches changes every **100 ms**, sending a message **only when changes exist**. Events are applied in the order received; the message cursor identifies the last event in the batch. The client saves the new cursor only after applying the batch.

### `reset` — cannot resume

```json
{ "type": "reset" }
```

Sent when `after` is malformed, unknown, has a mismatched timestamp, or is too far behind. The client reloads `GET /api/canvas` and reconnects using the new snapshot cursor.

### `hb` — heartbeat

```json
{ "type": "hb" }
```

Sent after **15 seconds without other messages**. It does not change pixels or the cursor.

**Connection recovery:** On disconnect, reconnect using the last **successfully applied** cursor. Duplicate events should not be applied twice. If the client cannot safely reconcile the stream, it should reload the snapshot.

## 3. Frontend/backend flow

1. **Initial load:** frontend requests palette and canvas; backend returns colors and a consistent snapshot with cursor.
2. **Subscribe:** frontend opens `/api/ws?after=<snapshot cursor>`; backend replays missed changes and starts live updates.
3. **Place pixel:** frontend sends `POST /api/pixels`; backend stores the event and broadcasts it through a WS `pixels` batch (including to the placing client).
4. **Recover:** on disconnection, frontend reconnects from its last applied cursor; on `reset`, it fetches a fresh canvas snapshot.

**Current implementation vs. contract:** `backend/src/canvas-state.ts` does not yet return `cursor`.

