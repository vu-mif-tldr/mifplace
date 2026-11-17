# Mifplace API Contract

**Purpose:** Agree on HTTP and WebSocket formats so frontend and backend can be developed independently.

## 1. HTTP endpoints

**Rate limits.** Every endpoint counts requests per client IP on its own; above the limit the answer is `429` with the usual body `{"success":false,"error":"..."}`. The limits are set in `.env` (`RATE_LIMIT_*`, see [`.env.example`](../.env.example)):

| Endpoint                          | Setting                                      | Default  |
| --------------------------------- | -------------------------------------------- | -------- |
| `GET /api/palette`                | `RATE_LIMIT_PALETTE_PER_MINUTE`              | 120/min  |
| `GET /api/canvas/size`            | `RATE_LIMIT_CANVAS_SIZE_PER_MINUTE`          | 120/min  |
| `GET /api/canvas`                 | `RATE_LIMIT_CANVAS_PER_MINUTE`               | 20/min   |
| `POST /api/pixels`                | `RATE_LIMIT_PIXELS_PER_MINUTE`               | 10/min   |
| `POST /api/waitlist`              | `RATE_LIMIT_WAITLIST_SIGNUP_PER_HOUR`        | 30/hour  |
| `POST /api/waitlist/confirm`      | `RATE_LIMIT_WAITLIST_CONFIRM_PER_MINUTE`     | 120/min  |
| `POST /api/waitlist/unsubscribe`  | `RATE_LIMIT_WAITLIST_UNSUBSCRIBE_PER_MINUTE` | 120/min  |
| `POST /api/auth/register`         | `RATE_LIMIT_AUTH_REGISTER_PER_HOUR`          | 100/hour |
| `POST /api/auth/login`            | `RATE_LIMIT_AUTH_LOGIN_PER_MINUTE`           | 60/min   |
| `POST /api/auth/password/*`       | `RATE_LIMIT_AUTH_PASSWORD_PER_HOUR`          | 30/hour  |
| Other `/api/auth/*`               | `RATE_LIMIT_AUTH_PER_MINUTE`                 | 120/min  |
| The page, its files, the 404 page | `RATE_LIMIT_OTHER_PER_MINUTE`                | 120/min  |

`GET /health` has no limit. The WebSocket `/api/ws` is limited by `WS_MAX_CONNECTIONS` instead.

**Sessions.** Every `/api` route needs a session, the cookie a visitor gets by signing in ([Accounts](#accounts-apiauth)). The exceptions are `/api/auth/*` and `/api/waitlist/*`; `GET /health` is public too. A route added later is closed without saying so.

| Status | Body                                                                         | Case                                                          |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `401`  | `{"success":false,"code":"unauthenticated","error":"Not signed in."}`        | No session: none was sent, it expired, or the user is blocked |
| `403`  | `{"success":false,"code":"forbidden_origin","error":"This request must..."}` | A request other than `GET` from a page of another site        |

The `401` is answered before the per-IP limit of the route is counted. The page shows the sign-in screens when it gets one. `POST /api/pixels` stores the pixel with the user of the session (FR-19).

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

### `GET /api/canvas/size`

The canvas size does not change while the server runs. The backend reads it from the database once at start and serves it from memory. The frontend requests it **once during initial page load**, alongside the palette, and keeps it locally. It is not fetched again after a `reset`; a page reload or an explicit full reinitialization may fetch it again.

**200 OK** — canvas dimensions:

```json
{ "width": 3, "height": 2 }
```

A cell is addressed by its position `pos = y * width + x`, starting at the top-left; valid positions are `0 <= pos < width * height`.

**Error:** `500 Internal Server Error` if the size cannot be retrieved:

```json
{ "success": false, "error": "Internal server error" }
```

### `GET /api/canvas`

The frontend requests the **full canvas snapshot once during initial page load**, alongside the palette and the canvas size. It does **not** poll this endpoint for routine updates. Later pixel changes arrive through WebSocket. A full snapshot is requested again after a `reset` or an explicit full reinitialization.

**200 OK** — current canvas snapshot:

```json
{
  "pixels": [5, 12, -1, -2, 5, -3],
  "eventId": 102,
  "timestamp": 1760000000000
}
```

- The snapshot does **not** contain the canvas dimensions: the frontend already has them from `GET /api/canvas/size`.
- `pixels`: **flat array of color IDs**. Array index is the pixel `pos`; the array length is exactly `width * height` (dimensions from `GET /api/canvas/size`).
- Any negative value (`colorId < 0`) represents an unpainted pixel, rendered with the canvas background. Palette color IDs must be non-negative; `0` is a valid color ID.
- `eventId`, `timestamp`: identify the **last event included in this snapshot**. `timestamp` is a Unix timestamp in milliseconds. For an empty event log both are `0`.

The snapshot and its `eventId`/`timestamp` must represent the **same event-history point**. The frontend must not miss updates between the HTTP snapshot and WebSocket subscription.

**Error:** `500 Internal Server Error` if the canvas snapshot cannot be loaded:

```json
{ "success": false, "error": "Internal server error" }
```

The server must not return a partial snapshot with `200 OK`.

### `POST /api/pixels`

The frontend computes `pos` using the canvas width obtained from `GET /api/canvas/size`. It sends **`pos`, not `x` and `y`**. `colorIndex` is a palette `id`, not its index in the palette array.

**Request:** `Content-Type: application/json`

```json
{ "pos": 4, "colorIndex": 12 }
```

The backend validates that `pos` is an integer in `0 <= pos < width * height`, and that `colorIndex` is an integer matching an existing palette ID. The server must not trust client-side calculations without validation.

**201 Created:**

```json
{ "success": true, "eventId": 103 }
```

**Error responses:**

| Status | Case                                             | JSON response                                                                             |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `400`  | Malformed body, a field missing or of wrong type | `{"success":false,"error":"colorIndex: Invalid input: expected number, received string"}` |
| `400`  | Position outside the canvas                      | `{"success":false,"error":"pos: pos must be less than 16384 (canvas 128x128)"}`           |
| `400`  | Integer that is not a palette ID                 | `{"success":false,"error":"Color not in palette"}`                                        |
| `500`  | Database insert failure                          | `{"success":false,"error":"Insert failed"}`                                               |

The body is checked with the request schema from `@mifplace/shared` (`PlacePixelRequestSchema`, then the position check `positionSchema`). A `400` from that check carries the schema's message as one line, `field: message`, several problems joined with `; ` (`zodErrorMessage`). The exact wording comes from the schema and may change with it; clients show it, they do not parse it. `Color not in palette` and `Insert failed` are fixed strings of the backend.

### Waitlist: `POST /api/waitlist`, `/confirm`, `/unsubscribe`

Collects addresses of people who want to play, before launch, with double opt-in. The routes exist where `WAITLIST_ENABLED` is `true` (production on vu.place) and in development unless it is `false`. The landing pages that call them are in [`deploy/landing/`](../deploy/landing/).

1. `POST /api/waitlist` with `{ "email": "jonas@mif.stud.vu.lt" }` stores the address and emails a link `PUBLIC_URL/confirm.html?t=<token>`. Only `vu.lt` and `*.vu.lt` addresses (`VuEmailSchema` in `@mifplace/shared`); the address is trimmed and lower-cased.
2. The confirm page has a button that sends `POST /api/waitlist/confirm` with `{ "token": "..." }`. A button and not the link itself, because mail scanners (Outlook Safe Links) open every link in an email. The link expires after 7 days; unconfirmed addresses are deleted then.
3. Every email also has `PUBLIC_URL/unsubscribe.html?t=<token>`; its button sends `POST /api/waitlist/unsubscribe` with the same token, which deletes the address.

**Signup answers `202 {"success":true}`** for a new, a pending and an already confirmed address alike, so the form does not tell who is on the list. A confirmed address gets no email. One address gets at most one email per 10 minutes and 3 per day; above that the answer is still `202`, without an email.

| Route          | Status | Case                                                    |
| -------------- | ------ | ------------------------------------------------------- |
| `/`            | `400`  | Not an email or not a VU address (schema message)       |
| `/`            | `429`  | Signup limit per IP reached (see rate limits above)     |
| `/`            | `503`  | All emails together reached 40 per hour, or SMTP failed |
| `/confirm`     | `200`  | Confirmed (again is fine)                               |
| `/confirm`     | `404`  | Unknown token or the link has expired                   |
| `/unsubscribe` | `200`  | Deleted, or there was nothing to delete                 |
| both           | `400`  | Malformed token                                         |

Errors have the usual body `{"success":false,"error":"..."}`.

### Accounts: `/api/auth/*`

People register with an email address and a password; a session cookie keeps the browser signed in. Every other `/api` route and the WebSocket need that session (see "Sessions" above). `PUBLIC_URL` says where the page is: the links in the emails point there; production does not start without it.

| Route                            | Body                                   | Success                      |
| -------------------------------- | -------------------------------------- | ---------------------------- |
| `POST /api/auth/register`        | `{ "email", "password" }`              | `202`, an email is sent      |
| `POST /api/auth/verify`          | `{ "token" }`                          | `200`, the address counts    |
| `POST /api/auth/login`           | `{ "email", "password" }`              | `200` with `user`, cookie    |
| `POST /api/auth/logout`          | none                                   | `200`, cookie deleted        |
| `GET /api/auth/me`               | none                                   | `200` with `user`            |
| `POST /api/auth/password/forgot` | `{ "email" }`                          | `202`, an email is sent      |
| `POST /api/auth/password/reset`  | `{ "token", "password" }`              | `200`, all sessions closed   |
| `POST /api/auth/password/change` | `{ "currentPassword", "newPassword" }` | `200`, other sessions closed |

Success bodies are `{"success":true}`; `login` and `me` add the user:

```json
{ "success": true, "user": { "email": "jonas@mif.stud.vu.lt", "role": "user" } }
```

`role` is `user` or `admin`. The schemas are in `@mifplace/shared` (`auth.ts`).

**Rules**

- **Address:** trimmed and lower-cased. Only the domains of `ALLOWED_EMAIL_DOMAINS` and their subdomains may register (`vu.lt` by default), and not addresses with `+` before the `@` (they reach the same mailbox, so one person could have many accounts).
- **Password:** 10 to 128 characters, no other rules. Stored only as an Argon2id hash.
- **Verification:** the email links to `PUBLIC_URL/#/verify/<token>`; the page there has a button that sends `POST /api/auth/verify` (a button, because mail scanners open every link). The link works once, for 24 hours; an account not verified by then is deleted. Verifying does not sign in. Registering again before verifying replaces the password and makes earlier links invalid.
- **Reset:** the email links to `PUBLIC_URL/#/reset/<token>`, valid once, for 1 hour. A reset also verifies the address.
- **Session:** the cookie `session` (`__Host-session` over HTTPS) is `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, and lasts 90 days. The server keeps only a hash of it. A blocked user has no session.
- **Who is registered stays private:** `register` and `forgot` answer `202` whether the address has an account or not (its owner gets an email saying so); `login` answers the same `401` for an unknown address and a wrong password.
- **Same site only:** a request other than `GET` with an `Origin` header of another site is refused (`403`). The page's own host is allowed, `WS_ALLOWED_ORIGINS` adds others.
- **Limits besides the per-IP ones:** 5 wrong passwords for one account from one IP in 15 minutes, or 30 from anywhere in an hour, then `429`. One address gets at most one email a minute and 5 a day (above that still `202`, without an email, and a repeated registration changes nothing). All emails of the server together: `MAIL_PER_HOUR` (40).

**Errors** have the usual body plus a `code` the page can pick its text by:

```json
{ "success": false, "code": "invalid_credentials", "error": "Wrong email or password." }
```

| Status | `code`                | Case                                                                  |
| ------ | --------------------- | --------------------------------------------------------------------- |
| `400`  | `invalid_request`     | The body does not match the schema (schema message in `error`)        |
| `400`  | `email_not_allowed`   | `register`: domain not allowed, or an address with `+`                |
| `401`  | `invalid_credentials` | `login`: unknown address or wrong password                            |
| `401`  | `unauthenticated`     | `me`, `password/change`: no session, or it expired                    |
| `403`  | `invalid_credentials` | `password/change`: the current password is wrong                      |
| `403`  | `email_not_verified`  | `login`: right password, address not verified; the link is sent again |
| `403`  | `banned`              | `login`: the account is blocked                                       |
| `403`  | `forbidden_origin`    | The request comes from another site                                   |
| `404`  | `invalid_token`       | `verify`, `password/reset`: unknown, used or expired link             |
| `429`  | `too_many_attempts`   | Too many wrong passwords for this account                             |
| `429`  | none                  | Per-IP limit reached (see rate limits above)                          |
| `503`  | `mail_unavailable`    | The email could not be sent, or `MAIL_PER_HOUR` is used up            |
| `503`  | `busy`                | Too many passwords are being checked at once, try again               |
| `500`  | `internal`            | Anything else                                                         |

## 2. WebSocket — `/api/ws`

WebSocket delivers **pixel updates from server to client**. Clients place pixels through HTTP `POST /api/pixels`. The connection also uses standard WebSocket **ping/pong control frames** for connection health; those are not application JSON pixel messages.

**Only for signed-in visitors.** The upgrade request needs the session cookie, which the browser sends by itself; without a session the server answers `401` instead of upgrading. When a session ends other than by expiring (sign-out, a new password, a block), the server closes its connections with code `4401`. A browser cannot see why an upgrade was refused, so when a connection is closed with `4401` or a new one is not accepted, the page asks `GET /api/auth/me` and shows the sign-in screens if nobody is signed in; otherwise it keeps reconnecting as described below. A plain drop, such as a restart of the server, does not make the pages ask.

### Connecting and resuming

**Initial connection after the snapshot:**

```text
/api/ws?afterEventId=102&afterTimestamp=1760000000000
```

The two optional resume parameters form one logical checkpoint:

- **Both provided:** the server validates the event ID and timestamp, sends events strictly **after** that checkpoint (catch-up), then continues with new live events.
- **Neither provided:** the server sends **only new events** after connection; it does not replay history.
- **Only one provided, invalid values, unknown ID, mismatched timestamp, or checkpoint too old** (more than `WS_MAX_BACKLOG` events behind, 10,000 by default)**:** the server sends `reset`.

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

Each entry is `[eventId, pos, colorId]`. The client applies events in order and saves `eventId` and `timestamp` **only after successfully applying** the batch. The server must not create a gap between catch-up and live delivery. The client must not apply the same event twice: a live batch is one message for every client and may repeat events up to the client's checkpoint (stored before it connected, sent after), so the client skips every event whose `eventId` is not greater than its checkpoint.

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

Sent when the resume checkpoint is malformed, unknown, mismatched, or too far behind; the server then closes the connection (code 1000). The client requests a fresh `GET /api/canvas` snapshot and reconnects using the new `eventId` and `timestamp`. The palette and the canvas size need not be reloaded.

### `online` — how many pages are connected

```json
{ "type": "online", "count": 7 }
```

`count` is the number of open live connections, the receiving page included: open pages, not people (one person with two tabs counts twice; people cannot be told apart before sign-in). A page gets it right after it connects (after the catch-up `pixels`, if any; not with a `reset`), and every page gets it again when the number changes, at most once every `WS_ONLINE_MS` (2 seconds by default) and only if it differs from the last one sent. It does not touch the checkpoint. The page shows it while it is connected.

### Ping/pong — connection heartbeat

The **backend starts a heartbeat timer for each WebSocket connection**. When no other activity has occurred for **15 seconds**, it sends a standard WebSocket **ping control frame**. The client replies with a **pong control frame**; browser WebSocket implementations normally handle this automatically, without application JavaScript.

- **Server → client:** WebSocket `ping` control frame (not JSON).
- **Client → server:** WebSocket `pong` control frame (not JSON). The client sends no application messages; the server closes a connection that sends one (code 1003).
- **If no pong arrives:** the server marks the connection as unresponsive, closes it, and releases its connection resources. (suggested: 10 seconds after ping).
- The client can detect a closed connection and reconnect with increasing delay and jitter. Neither ping nor pong changes pixel data or the saved event checkpoint.

**Connection recovery:** On disconnect, reconnect using the last **successfully applied** `eventId` and `timestamp`. If the client cannot safely reconcile events, it reloads the snapshot.

## 3. Frontend/backend flow

1. **Initial page load:** frontend requests `GET /api/palette`, `GET /api/canvas/size` and `GET /api/canvas` once, stores the palette, dimensions, full flat color array, `eventId`, and `timestamp`.
2. **Subscribe:** frontend opens `/api/ws?afterEventId=<eventId>&afterTimestamp=<timestamp>`; backend sends any events missed since the snapshot, then streams live updates.
3. **Place pixel:** frontend calculates `pos = y * width + x` and sends `POST /api/pixels` with `pos` and `colorIndex`; backend validates, saves, and broadcasts the event to all connected clients.
4. **Apply updates:** frontend changes only the positions specified by incoming `pixels` events; it does not fetch the full canvas again after each update.
5. **Recover:** after a disconnect, frontend reconnects using its last applied checkpoint. If it receives `reset`, it fetches a new full canvas snapshot and subscribes again. It keeps the existing palette and canvas size unless it needs a full reinitialization.
6. **Connection health:** backend sends WebSocket ping frames after 15 seconds of inactivity; clients respond with pong; dead connections are closed to free server resources.
