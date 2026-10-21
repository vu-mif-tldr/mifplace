# Load test reports

Raw JSON reports of the load tool (`npm run load`, `scripts/load-matrix.sh`), used as evidence in
[ADR-0003](https://tldr-mif.atlassian.net/wiki/spaces/MP/pages/17727489/ADR-0003+Real-time+transport+draft).
File names: `<start time, UTC>-<scenario>-<transport>-<viewers>v-<placements per second>r.json`.
The T1 and T2 reports have no scenario in the name and an older report format.

All runs had the same setup:

- Server container: 1 CPU (`cpus: 1`), 1 GB, Node 24.22.1 (`node:24-alpine`), batches every 100 ms,
  `maxBufferedBytes` 262,144. Every transport ran against a freshly started container.
- Load tool: in the same Docker VM, without a CPU limit, one worker thread per 100 viewers (at most
  11), one writer.
- Host: MacBook Pro with an M2 Pro (12 cores), macOS 15.1.1, Docker Desktop with engine 29.8.0;
  the Docker VM had 12 CPUs and 12.5 GB.
- A browser tab on the prototype's page was probably open during the runs: the servers saw a
  WebSocket the load tool did not open (visible in the short polling T3 run, where the load tool
  opens none). One extra connection does not change the numbers.

## 2026-10-21: T1 (500 viewers) and T2 (2,000 viewers)

- Commands: `scripts/load-matrix.sh --viewers 500 --warmup 10 --duration 60`, then the same with
  `--viewers 2000`. 30 placements per second.
- Load tool at commit `b356a85`. After the runs only the wording of one warning changed.
- `2026-10-21T21-09-05-lp-2000v-30r.json` is **not a valid latency measurement**. The load tool
  itself was overloaded (event loop p99 828 ms, see `warnings`). The server-side numbers in it
  (CPU, event loop, batches per second) are still valid and show the server saturated.

## 2026-10-21: T3, T4 and T5 (500 viewers)

| Reports           | Command                                                                                                    | Commit    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| `*-t3-*`          | `scripts/load-matrix.sh --viewers 500 --warmup 10 --duration 60 --drop-per-second 10`                      | `64dd2d9` |
| `*-t4-file-*`     | `LOG_FILE=data/events.jsonl scripts/load-matrix.sh --viewers 500 --warmup 10 --duration 60 --restart-at 20` | `7073396` |
| `*-t4-memory-*`   | the same without `LOG_FILE`                                                                                | `28d5b48` |
| `*-t5-*-30r`      | `scripts/load-matrix.sh --viewers 500 --warmup 20 --duration 120 --slow 10 --slow-read-bps 200`            | `91a7838` |
| `*-t5-*-300r`     | `TRANSPORTS="ws sse"`, the same with `--rate 300`                                                           | `91a7838` |

Runs that were thrown away, and why:

- **T4 with a kept log, first run (`28d5b48`).** After the restart the hub's first batch was the
  whole log, sent to every client that had reconnected (27,838 duplicates for WebSocket). Fixed in
  `7073396`, then run again. The in-memory T4 runs are not affected: there the log starts empty.
- **T3, first run.** A viewer dropped in the last second that already had every event counted as
  not connected (WebSocket "failed" with 491 of 500). Fixed in `64dd2d9`.
- **T5, first two runs.** The throttling proxy first threw away bytes not yet delivered when the
  server closed its side (`64dd2d9`), then held back large chunks whole, headers included
  (`91a7838`). Slow polling viewers looked as if they never connected.
- The long polling runs warn that the load tool was busy (viewer event loop p99 of 29-88 ms). Their
  delivery latencies are slightly too high; the server-side numbers are not affected.

## 2026-10-21: T6, through Caddy with TLS

Caddy 2.11.7 (`caddy:2.11.7-alpine`) in its own container with 1 CPU, in front of the same server
container. The load tool talks HTTP/1.1 over TLS to Caddy, one connection per viewer.

| Reports                    | Command                                                                                     | Commit    |
| -------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `*-t6-http2-check.json`    | `src/load/http2-check.ts https://caddy:8443 10` in the load container (see the README)      | `3e8f474` |
| `*-t6-*-500v-30r`          | `PROXY=caddy scripts/load-matrix.sh --viewers 500 --warmup 10 --duration 60`                | `3e8f474` |
| `*-t6-encode-sse-*`        | `PROXY=caddy TRANSPORTS=sse CADDY_ENCODE="encode zstd gzip" ...` with `--label encode`      | `3e8f474` |
| `*-t6-*-2000v-30r`         | `PROXY=caddy TRANSPORTS="ws sse" scripts/load-matrix.sh --viewers 2000 --warmup 10 --duration 60` | `3e8f474` |

- The 500-viewer runs ran just before `3e8f474` was committed, with Caddy limited to 512 MB and a
  10 s connect timeout for the writer; nothing else differed. Caddy stayed under 170 MB there.
- **Long polling with `encode` has no report.** Caddy held back the headers of every parked long
  poll until its body (to decide whether to compress), so the 500 viewers counted as connected only
  after 30 s, when the server's long-poll timeout answered, and the writer gave up after 10 s. The
  writer now waits as long as the viewers.
- The SSE run with `encode` saw a stall of about 1 s in all three processes at the same moment (the
  server, Caddy and the load tool), most likely in the Docker VM itself. It shows in the worst
  event loop delays and the maximum latency, not in p95.
