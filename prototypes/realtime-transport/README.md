# Real-time transport prototypes (MP-34)

Step 2 of [ADR-0003: Real-time transport](https://tldr-mif.atlassian.net/wiki/spaces/MP/pages/17727489/ADR-0003+Real-time+transport+draft):
four ways to deliver new pixels to browsers, built on **one shared protocol and one server core**
so that only the transport differs.

| `?t=`  | Transport                | Server → client             | Client → server   |
| ------ | ------------------------ | --------------------------- | ----------------- |
| `ws`   | WebSocket (`ws` package) | batches over the socket     | over the socket   |
| `sse`  | Server-Sent Events       | `text/event-stream`         | `POST /api/place` |
| `lp`   | Long polling             | a held `GET`, one per batch | `POST /api/place` |
| `poll` | Short polling            | `GET` every second          | `POST /api/place` |

This folder is a separate npm project on purpose. It is not a workspace of the root
`package.json`, has its own lockfile and `node_modules`, and imports nothing from `backend/` or
`frontend/`. Delete the folder and nothing else changes.

## Quick start

Node 24 runs the TypeScript server directly (type stripping). Only the browser client is compiled,
with `tsc`, into `dist/web`; there is no bundler.

```sh
nvm use            # Node 24, from .nvmrc
npm install
npm start          # builds the client, starts http://127.0.0.1:3100
```

Then open two tabs, for example `http://127.0.0.1:3100/?t=ws` and `http://127.0.0.1:3100/?t=sse`,
and click the canvas in one of them: the pixel appears in both. Your own pixel is not drawn on
click; it appears when it comes back through the transport, the same as everyone else's. Any
transport can talk to any other, because they all share one event log.

Every server option is a flag:

```sh
npm start -- --bot-rate 30          # the server places 30 random pixels per second itself
npm start -- --batch-ms 200         # batch interval (default 100 ms)
npm start -- --host 0.0.0.0         # reachable from a phone on the same Wi-Fi
```

See `DEFAULT_OPTIONS` in [src/server/app.ts](src/server/app.ts) for the full list.

Checks: `npm run check` runs typecheck, Prettier and the tests. `npm test` starts a real server
for each transport and drives it with the real client code from `src/client` (Node 24 has
`WebSocket`, `fetch` and, behind `--experimental-eventsource`, `EventSource`). For each transport
the tests check:

- two clients exchange one pixel (the acceptance criterion of MP-34);
- a client catches up after a lost connection, with no gaps;
- a client reloads the snapshot after a server restart that lost the log.

## How it works

The rules are the same for every transport. Only the delivery channel differs.

1. The client loads the canvas over HTTP: `GET /api/canvas` returns the cells and `lastEventId`
   (see ADR-0001: the event log is the source of truth).
2. It opens the transport with `after=<lastEventId>`. The server sends what the client missed and
   then every new batch. For SSE the browser itself sends `Last-Event-ID` on its own reconnects.
3. The server collects new events for `batchMs` and serialises each batch **once** for all clients
   ([src/server/hub.ts](src/server/hub.ts)).
4. The client applies events strictly in id order: it skips ids it already has (after a snapshot
   or a reconnect), and on a gap or a `reset` from the server it reloads the snapshot
   ([src/client/live-canvas.ts](src/client/live-canvas.ts)). `reset` happens when the client's id
   is unknown to the server (the server restarted; the log here is in memory) or when the client
   missed more than `maxBacklog` events.
5. Push transports get a heartbeat every 15 s. A client that hears nothing for 40 s reconnects,
   with exponential backoff and jitter.
6. A client that reads too slowly (over `maxBufferedBytes` of unsent data) is disconnected instead
   of being buffered without limit. It reconnects and catches up like after any other drop.

The page shows the client's counters (applied, duplicates, gaps, resyncs, reconnects), delivery
latency (client receive time minus server event time, so only meaningful on one machine) and the
server's `/api/stats`. The **Drop my connection** and **Server: drop all connections** buttons
simulate network failures.

### Endpoints

| Route                  | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `GET /api/canvas`      | Snapshot: cells and `lastEventId`                       |
| `POST /api/place`      | `{x, y, color}`, validated; returns `{ok, id}`          |
| `GET /ws?after=`       | WebSocket                                               |
| `GET /api/sse?after=`  | Server-Sent Events                                      |
| `GET /api/lp?after=`   | Long poll: answers on the next batch or after 25 s      |
| `GET /api/poll?after=` | Short poll: answers at once                             |
| `GET /api/stats`       | Connections per transport, request counters, server RSS |
| `POST /api/debug/drop` | Drops every connection                                  |

## What building them showed

These are observations from writing the code, not measurements. The measurements are step 3.
Line counts exclude blank lines and comments.

**WebSocket.** Server 105 lines (with the Origin check and pings), client 43 lines on top of
the 50-line reconnect base it shares with SSE. Everything around the socket is ours to write:
reconnecting, continuing from `after`, a heartbeat the client can see (browsers do not expose
protocol pings to JavaScript), and request ids to match placement replies to requests. Browsers
apply neither the same-origin policy nor CORS to WebSockets, so the server must check `Origin`
itself, or any website could open a socket with our users' cookies. It is the only transport here
that needs a dependency (`ws`) and the only one that can send binary frames.

**SSE.** Server 44 lines, client 28. The browser reconnects by itself and sends `Last-Event-ID`,
so catch-up is almost free. Three catches came up:

- `EventSource` waits exactly the `retry:` delay and adds no jitter, so the server sends a random
  value per connection.
- On an HTTP error status, for example a 502 from a proxy during a restart, `EventSource` gives up
  for good and the client has to start over itself.
- It is text only, so a binary format would need base64.

The server notices a dead client only when a write fails.

**Long polling.** Server 29 lines, client shares 75 with short polling. Every batch is a new HTTP
request per client: at 500 clients and a 100 ms batch that is up to 5,000 requests per second
under load. A held request gives the client no sign of life, so the server sends the response
headers at once and the body later; without that, a client on an idle canvas looks "connecting"
for 25 s.

**Short polling.** Server 4 lines. The simplest by far, but latency is the poll interval on top of
the batch, and 500 clients polling every second make 500 requests per second even when nothing
happens.

## Not in the prototypes, on purpose

- **No SQLite**: the event log is in memory, so a restart also exercises the `reset` path.
- **No login, no cooldown, no per-user connection limit.** Every transport starts with an ordinary
  HTTP request (the WebSocket handshake too), so cookies and limits work the same way for all of
  them. This still has to be confirmed when the real login exists.
- **JSON only**, no binary frames and no compression, so that all transports carry the same bytes.
- **HTTP/1.1 without TLS.** HTTP/2 matters for SSE: browsers allow about 6 HTTP/1.1 connections
  per host, and every SSE tab holds one of them. HTTP/2 and the reverse proxy are test T6 (behind
  Caddy) in step 3.

## Next: step 3

Measurements T1–T7 from the ADR. The load generator can reuse `src/client/transports.ts` as it
is, because it already runs in Node.

## Layout

```text
public/index.html           the page
src/shared/protocol.ts      messages shared by server and client
src/server/main.ts          CLI entry point (flags -> AppOptions)
src/server/app.ts           HTTP routes, static files, bot, shutdown
src/server/event-log.ts     in-memory append-only log and canvas
src/server/hub.ts           batching, catch-up and fan-out, the same for all transports
src/server/transports/      websocket.ts, sse.ts, polling.ts (long and short)
src/client/transports.ts    client side of the four transports, no DOM
src/client/live-canvas.ts   ordering, de-duplication and resync, no DOM
src/client/main.ts          the page's UI
test/                       hub unit tests and end-to-end tests for every transport
```
