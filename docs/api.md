# Mifplace API Contract

**Purpose:** Agree on HTTP and WebSocket formats so frontend and backend can be developed independently.

## 1. HTTP endpoints

### `GET /api/palette`

The frontend requests the palette **once during initial page load**. It keeps the palette locally and does not fetch it again for ordinary pixel updates. A page reload or an explicit full reinitialization may fetch it again.

**200 OK** — available colors:

```json
[
  { "id": 1, "color": "#000000" },
  { "id": 5, "color": "#FFFFFF" },
  { "id": 12, "color": "#FF0000" }
]
```

`id` is the color identifier, and `color` is a `#RRGGBB` string. IDs may be non-consecutive. **Any negative color ID represents an unpainted pixel and must not be assigned to a palette color**. Clients must not use array indexes as color IDs.

**Error:** `500 Internal Server Error` if the palette cannot be retrieved:

```json
{ "success": false, "error": "Internal server error" }
```

### `GET /api/canvas`

The frontend requests the **full canvas snapshot once during initial page load**, after or alongside the palette. It does **not** poll this endpoint for routine updates. Later pixel changes arrive through WebSocket. A full snapshot is requested again after a `reset` or an explicit full reinitialization.

**200 OK** — current canvas snapshot:

```json
{
  "width": 3,
  "height": 2,
  "pixels": [5, 12, -1, -2, 5, -3],
  "eventId": 102,
  "timestamp": 1760000000000
}
```

- `width`, `height`: canvas dimensions. They are sent with the initial snapshot, not repeated in live pixel updates.
- `pixels`: **flat array of color IDs**. Array index is the pixel `position`; the array length is exactly `width * height`. `position = y * width + x`, starting at the top-left.
- Any negative value (`colorId < 0`) represents an unpainted pixel, rendered with the canvas background. Palette color IDs must be non-negative; `0` is a valid color ID.
- `eventId`, `timestamp`: identify the **last event included in this snapshot**. `timestamp` is a Unix timestamp in milliseconds. For an empty event log both are `0`.

The snapshot and its `eventId`/`timestamp` must represent the **same event-history point**. The frontend must not miss updates between the HTTP snapshot and WebSocket subscription.

**Error:** `500 Internal Server Error` if the canvas snapshot cannot be loaded:

```json
{ "success": false, "error": "Internal server error" }
```

The server must not return a partial snapshot with `200 OK`.

### `POST /api/pixels`

The frontend computes `position` using the canvas width obtained from `GET /api/canvas`. It sends **`position`, not `x` and `y`**. `colorIndex` is a palette `id`, not its index in the palette array.

**Request:** `Content-Type: application/json`

```json
{ "position": 4, "colorIndex": 12 }
```

The backend validates that `position` is an integer in `0 <= position < width * height`, and that `colorIndex` is an integer matching an existing palette ID. The server must not trust client-side calculations without validation.

**201 Created:**

```json
{ "success": true, "eventId": 103 }
```

**Error responses (target contract):**

| Status | Case                                 | JSON response                                             |
| ------ | ------------------------------------ | --------------------------------------------------------- |
| `400`  | Non-integer position                 | `{"success":false,"error":"Position must be an integer"}` |
| `400`  | Position outside canvas              | `{"success":false,"error":"Position not in canvas"}`      |
| `400`  | Invalid palette ID                   | `{"success":false,"error":"Color not in palette"}`        |
| `400`  | Malformed or missing required fields | `{"success":false,"error":"Invalid pixel request"}`       |
| `500`  | Database insert failure              | `{"success":false,"error":"Insert failed"}`               |

**Implementation change:** The current backend accepts `{x, y, colorIndex}` and validates `colorIndex` against `paletteSize`. It must be updated to accept `{position, colorIndex}` and validate actual palette IDs. The error strings above are **proposed** for review, not claims about current behavior.

## 2. WebSocket — `/api/ws`

WebSocket delivers **pixel updates from server to client**. Clients place pixels through HTTP `POST /api/pixels`. The connection also uses standard WebSocket **ping/pong control frames** for connection health; those are not application JSON pixel messages.

### Connecting and resuming

**Initial connection after the snapshot:**

```text
/api/ws?afterEventId=102&afterTimestamp=1760000000000
```

The two optional resume parameters form one logical checkpoint:

- **Both provided:** the server validates the event ID and timestamp, sends events strictly **after** that checkpoint (catch-up), then continues with new live events.
- **Neither provided:** the server sends **only new events** after connection; it does not replay history.
- **Only one provided, invalid values, unknown ID, mismatched timestamp, or checkpoint too old:** the server sends `reset`.

Keeping `eventId` and `timestamp` separate replaces the previous combined `cursor` field. The timestamp remains necessary to detect reused IDs after a database restore (ADR-0003, R2).

### `pixels` — catch-up after disconnection

When a client reconnects after being offline, the server replays events it missed, in order. Example:

```json
{
  "type": "pixels",
  "pixels": [
    [103, 4, 12],
    [104, 5, 5]
  ],
  "eventId": 104,
  "timestamp": 1760000000100
}
```

Each entry is `[eventId, position, colorId]`. The client applies events in order and saves `eventId` and `timestamp` **only after successfully applying** the batch. The server must not create a gap between catch-up and live delivery. The client must not apply the same event twice.

### `pixels` — live updates for all connected clients

When any user successfully places a pixel via `POST /api/pixels`, the backend records the event and sends it to **all connected clients, including the sender**, as part of a live update batch:

```json
{
  "type": "pixels",
  "pixels": [[105, 1, 5]],
  "eventId": 105,
  "timestamp": 1760000000200
}
```

The server batches live changes every **100 ms**, sending a JSON text message **only when at least one pixel changed**. It sends changed events, **not the entire canvas, palette, or dimensions**. The same message shape is used for catch-up and live updates so the frontend can use one handler; the distinction is _when_ the events are sent.

### `reset` — cannot resume

```json
{ "type": "reset" }
```

Sent when the resume checkpoint is malformed, unknown, mismatched, or too far behind. The client requests a fresh `GET /api/canvas` snapshot and reconnects using the new `eventId` and `timestamp`. The palette need not be reloaded if it has not changed.

### Ping/pong — connection heartbeat

The **backend starts a heartbeat timer for each WebSocket connection**. When no other activity has occurred for **15 seconds**, it sends a standard WebSocket **ping control frame**. The client replies with a **pong control frame**; browser WebSocket implementations normally handle this automatically, without application JavaScript.

- **Server → client:** WebSocket `ping` control frame (not JSON).
- **Client → server:** WebSocket `pong` control frame (not JSON).
- **If no pong arrives:** the server marks the connection as unresponsive, closes it, and releases its connection resources. (suggested: 10 seconds after ping).
- The client can detect a closed connection and reconnect with increasing delay and jitter. Neither ping nor pong changes pixel data or the saved event checkpoint.

**Connection recovery:** On disconnect, reconnect using the last **successfully applied** `eventId` and `timestamp`. If the client cannot safely reconcile events, it reloads the snapshot.

## 3. Frontend/backend flow

1. **Initial page load:** frontend requests `GET /api/palette` and `GET /api/canvas` once, stores the palette, dimensions, full flat color array, `eventId`, and `timestamp`.
2. **Subscribe:** frontend opens `/api/ws?afterEventId=<eventId>&afterTimestamp=<timestamp>`; backend sends any events missed since the snapshot, then streams live updates.
3. **Place pixel:** frontend calculates `position = y * width + x` and sends `POST /api/pixels` with `position` and `colorIndex`; backend validates, saves, and broadcasts the event to all connected clients.
4. **Apply updates:** frontend changes only the positions specified by incoming `pixels` events; it does not fetch the full canvas again after each update.
5. **Recover:** after a disconnect, frontend reconnects using its last applied checkpoint. If it receives `reset`, it fetches a new full canvas snapshot and subscribes again. It keeps the existing palette unless it needs a full reinitialization.
6. **Connection health:** backend sends WebSocket ping frames after 15 seconds of inactivity; clients respond with pong; dead connections are closed to free server resources.
