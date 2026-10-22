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
- a client reloads the snapshot after a server restart that lost the log;
- a client reloads the snapshot even when the new log has already issued its ids again (see
  "Cursors" below).

Further tests run miniature versions of every load scenario (T1, T3, T4, T5).

## How it works

The rules are the same for every transport. Only the delivery channel differs.

1. The client loads the canvas over HTTP: `GET /api/canvas` returns the cells, `lastEventId` and
   `lastEventTs` (see ADR-0001: the event log is the source of truth).
2. It opens the transport with `after=<cursor>`, where the cursor is `<id>:<ts>` of its last
   event. The server sends what the client missed and then every new batch. For SSE the cursor is
   the `id:` field, so the browser sends it back as `Last-Event-ID` on its own reconnects.
3. The server collects new events for `batchMs` and serialises each batch **once** for all clients
   ([src/server/hub.ts](src/server/hub.ts)).
4. The client applies events strictly in id order: it skips ids it already has (after a snapshot
   or a reconnect), and on a gap or a `reset` from the server it reloads the snapshot
   ([src/client/live-canvas.ts](src/client/live-canvas.ts)). `reset` happens when the cursor does
   not match the server's log (see below) or when the client missed more than `maxBacklog`
   events.
5. Push transports get a heartbeat every 15 s. A client that hears nothing for 40 s reconnects,
   with exponential backoff and jitter.
6. A client that reads too slowly (over `maxBufferedBytes` of unsent data) is disconnected instead
   of being buffered without limit. It reconnects and catches up like after any other drop.

### Cursors: why the id alone is not enough

T4 found a silent failure. The server restarted and lost its log (here: kept in memory), so it
issued ids from 1 again. An SSE client waited up to 5 s (`retry:`) before reconnecting, and by
then the new log was longer than the old one. Its old id existed again, the server took it for a
valid position and sent the continuation of the new log. The client got no gap and no reset, and
showed old pixels mixed with part of the new log.

The same happens in production whenever ids are issued twice: after restoring SQLite from a backup,
or after losing the database. So the client sends the time of its last event too, and the server
answers `reset` when its event with that id has another time. One test reproduces the failure
for every transport; it fails without the check.

The page shows the client's counters (applied, duplicates, gaps, resyncs, reconnects), delivery
latency (client receive time minus server event time, so only meaningful on one machine) and the
server's `/api/stats`. The **Drop my connection** and **Server: drop all connections** buttons
simulate network failures.

### Endpoints

| Route                  | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `GET /api/canvas`      | Snapshot: cells, `lastEventId`, `lastEventTs`             |
| `POST /api/place`      | `{x, y, color}`, validated; returns `{ok, id}`            |
| `GET /ws?after=`       | WebSocket                                                 |
| `GET /api/sse?after=`  | Server-Sent Events                                        |
| `GET /api/lp?after=`   | Long poll: answers on the next batch or after 25 s        |
| `GET /api/poll?after=` | Short poll: answers at once                               |
| `GET /api/stats`       | Connections per transport, request counters, server RSS   |
| `GET /api/metrics`     | For the load tool: CPU and event loop since the last call |
| `POST /api/debug/drop` | Drops every connection, or `?count=N` random ones (T3)    |
| `POST /api/debug/exit` | Ends the process (T4); only with `--allow-exit 1`         |

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

- **No SQLite.** The event log is in memory, so a restart also exercises the `reset` path. With
  `--log-file` it is kept in a file (one JSON line per event), to restart the way production will.
- **No login, no cooldown, no per-user connection limit.** Every transport starts with an ordinary
  HTTP request (the WebSocket handshake too), so cookies and limits work the same way for all of
  them. This still has to be confirmed when the real login exists.
- **JSON only**, no binary frames and no compression, so that all transports carry the same bytes.
- **No TLS in Node.** The server speaks plain HTTP/1.1, as it will behind the proxy in
  production. TLS, HTTP/2 and HTTP/3 come from Caddy in T6. HTTP/2 matters for SSE: browsers allow
  about 6 HTTP/1.1 connections per host, and every SSE tab holds one of them (risk R1 in the ADR).

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
  - Reconnects, resyncs, and outages: how long each viewer was without an open connection.
  - The server's CPU, event loop delay and memory, polled every second from `/api/metrics`.
  - The load tool's own CPU and event loop. When the tool itself is too busy (event loop p99 over
    50 ms), the report says so, because its latencies are then not trustworthy.

The report ends with a verdict against the pass conditions of the ADR for the scenario that ran,
and is saved as JSON in `results/`. The reports quoted in the ADR are committed there, with the
conditions of each run in [results/README.md](results/README.md).

### Scenarios

| Test   | Flags                           | What happens                                                                                                                                          |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1, T2 | `--viewers 500` / `2000`        | Steady state                                                                                                                                          |
| T3     | `--drop-per-second 10`          | The server drops 10 random connections every second, as a network or proxy would. Each transport reconnects its own way (SSE: the browser's `retry:`) |
| T4     | `--restart-at 20`               | At second 20 the server process exits and Docker starts it again. With `LOG_FILE=data/events.jsonl` the log survives; without, it is lost             |
| T5     | `--slow 10 --slow-read-bps 200` | 10 extra viewers read through a proxy at 200 bytes per second. They load the snapshot directly: T5 is about how the server buffers the stream         |
| T6     | `PROXY=caddy` (matrix script)   | T1 through Caddy with TLS, as in production. The report adds Caddy's own CPU and memory                                                               |

T5 is slow to show anything at our traffic. A viewer gets about 1.2 KB per second, and the kernel
buffers a lot of it (over 1 MB per connection in our runs) before the server's own buffer
(`maxBufferedBytes`, 256 KB) grows at all. Run it also with `--rate 300`.

### T6: through Caddy

[Caddyfile](Caddyfile) puts Caddy 2.11 in front of the server: TLS from Caddy's local CA, HTTP/1.1,
HTTP/2 and HTTP/3 on port 8443, no compression unless `CADDY_ENCODE` is set. The load tool trusts
the local root certificate through `NODE_EXTRA_CA_CERTS`; the matrix script does that for you.

```sh
PROXY=caddy scripts/load-matrix.sh --viewers 500
PROXY=caddy TRANSPORTS="sse lp" CADDY_ENCODE="encode zstd gzip" \
  scripts/load-matrix.sh --viewers 500 --label encode    # does compression buffer the stream?
```

The load tool speaks HTTP/1.1 to Caddy, one connection per viewer, like many different users.
Whether HTTP/2 works the way risk R1 needs it is checked separately: one HTTP/2 connection, 10 SSE
streams on it, plus the `Alt-Svc` header that offers HTTP/3 to browsers.

```sh
docker compose --profile tls up -d server caddy
docker compose run --rm --no-deps \
  -e NODE_EXTRA_CA_CERTS=/caddy-data/caddy/pki/authorities/local/root.crt \
  --entrypoint node load src/load/http2-check.ts https://caddy:8443 10
```

A browser on the host can use `https://localhost:8443` once it trusts the root certificate:
`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .`

### In Docker, the way the numbers are meant to be taken

The server container gets **one CPU and 1 GB**, roughly a small VM. The load tool runs in the same
Docker VM with the remaining CPUs. This has two reasons:

- the traffic does not go through Docker Desktop's port forwarding, which would add its own cost;
- both containers read the same clock, which the latency calculation needs.

```sh
scripts/load-matrix.sh --viewers 500 --duration 60   # every transport, each on a fresh server
LOG_FILE=data/events.jsonl scripts/load-matrix.sh --restart-at 20    # T4 with a kept log
TRANSPORTS="ws sse" scripts/load-matrix.sh --slow 10 --rate 300      # only some transports

docker compose up -d --build server                   # or one run at a time
docker compose run --rm --no-deps load --transport sse --viewers 2000
BATCH_MS=200 docker compose up -d --force-recreate server   # another batch interval
```

Use `--no-deps` with `docker compose run`: otherwise Compose may recreate the server with
different settings first (it did, when `LOG_FILE` was set for `up` but not for `run`).

Flags: `--transport`, `--viewers` (500), `--rate` (30), `--ramp` (new connections per second,
100), `--warmup` (10 s), `--duration` (60 s), `--workers` (auto), `--drain-ms` (5000), `--url`,
`--drop-per-second`, `--restart-at`, `--slow`, `--slow-read-bps` (1000), `--proxy-metrics-url`,
`--label` (added to the report's file name).

Without Docker, against `npm start`: `npm run load -- --transport ws --viewers 200`. This is fine
for trying things out, but then the server has the whole Mac to itself, and the numbers are not
comparable with the Docker runs.

Not covered yet: T7 (real browsers).

## Layout

```text
public/index.html           the page
src/shared/protocol.ts      messages shared by server and client
src/server/main.ts          CLI entry point (flags -> AppOptions)
src/server/app.ts           HTTP routes, static files, bot, shutdown
src/server/event-log.ts     append-only log (in memory or in a file) and canvas
src/server/hub.ts           batching, catch-up and fan-out, the same for all transports
src/server/transports/      websocket.ts, sse.ts, polling.ts (long and short)
src/client/transports.ts    client side of the four transports, no DOM
src/client/live-canvas.ts   ordering, de-duplication and resync, no DOM
src/client/main.ts          the page's UI
src/load/                   the load tool: main.ts (CLI), run.ts, viewers.ts (worker thread),
                            throttle-proxy.ts (T5), proxy-metrics.ts and http2-check.ts (T6)
scripts/load-matrix.sh      the load test for every transport, each on a fresh server container
compose.yaml, Dockerfile    server with 1 CPU and 1 GB, Caddy (T6), load tool next to them
Caddyfile                   Caddy with TLS from its local CA, for T6
test/                       unit tests, end-to-end tests for every transport, load tool tests
```
