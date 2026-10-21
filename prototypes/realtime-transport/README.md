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

| Route                  | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `GET /api/canvas`      | Snapshot: cells and `lastEventId`                         |
| `POST /api/place`      | `{x, y, color}`, validated; returns `{ok, id}`            |
| `GET /ws?after=`       | WebSocket                                                 |
| `GET /api/sse?after=`  | Server-Sent Events                                        |
| `GET /api/lp?after=`   | Long poll: answers on the next batch or after 25 s        |
| `GET /api/poll?after=` | Short poll: answers at once                               |
| `GET /api/stats`       | Connections per transport, request counters, server RSS   |
| `GET /api/metrics`     | For the load tool: CPU and event loop since the last call |
| `POST /api/debug/drop` | Drops every connection                                    |

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

## Load tests (step 3)

The load tool ([src/load](src/load)) models how the canvas is really used: hundreds of viewers and
only a few pixels per second.

- **Viewers** only receive. Each one is a `LiveCanvas` with the same client code the browser runs,
  so reconnecting, catch-up and de-duplication behave the same under load. They read and parse
  every message but draw nothing. A viewer that stopped reading would be a slow client and test
  T5 instead of T1. They run in worker threads, one per 100 viewers by default.
- **The writer** is one more client that places `--rate` pixels per second through the real write
  path: the socket for WebSocket, `POST /api/place` for the others.
- **Metrics.**
  - Delivery latency: viewer receive time minus the server's event time, collected in 1 ms
    histograms and added up across threads.
  - Lost events: gaps, and viewers that never got the last event.
  - Reconnects and resyncs.
  - The server's CPU, event loop delay and memory, polled every second from `/api/metrics`.
  - The load tool's own CPU and event loop. When the tool itself is too busy (event loop p99 over
    50 ms), the report says so, because its latencies are then not trustworthy.

The report ends with the verdict for T1 from the ADR (p95 at most 1 s, hard limit 5 s, no lost
events, everyone connected) and is saved as JSON in `results/`. The reports quoted in the ADR are
committed there, with the conditions of each run in [results/README.md](results/README.md).

### In Docker, the way the numbers are meant to be taken

The server container gets **one CPU and 1 GB**, roughly a small VM. The load tool runs in the same
Docker VM with the remaining CPUs. This has two reasons:

- the traffic does not go through Docker Desktop's port forwarding, which would add its own cost;
- both containers read the same clock, which the latency calculation needs.

```sh
scripts/load-matrix.sh --viewers 500 --duration 60   # every transport, each on a fresh server

docker compose up -d --build server                   # or one run at a time
docker compose run --rm load --transport sse --viewers 2000
BATCH_MS=200 docker compose up -d --force-recreate server   # another batch interval
```

Flags: `--transport`, `--viewers` (500), `--rate` (30), `--ramp` (new connections per second,
100), `--warmup` (10 s), `--duration` (60 s), `--workers` (auto), `--drain-ms` (5000), `--url`.

Without Docker, against `npm start`: `npm run load -- --transport ws --viewers 200`. This is fine
for trying things out, but then the server has the whole Mac to itself, and the numbers are not
comparable with the Docker runs.

Not covered yet: T3 (killing single connections), T4 (restarting the server under load), T5 (slow
clients), T6 (Caddy and TLS) and T7 (real browsers).

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
src/load/                   the load tool: main.ts (CLI), run.ts, viewers.ts (worker thread)
scripts/load-matrix.sh      the load test for every transport, each on a fresh server container
compose.yaml, Dockerfile    server with 1 CPU and 1 GB, load tool next to it
test/                       unit tests, end-to-end tests for every transport, load tool tests
```
