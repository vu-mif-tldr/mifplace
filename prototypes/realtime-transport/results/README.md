# Load test reports

Raw JSON reports of the load tool (`npm run load`, `scripts/load-matrix.sh`), used as evidence in
[ADR-0003](https://tldr-mif.atlassian.net/wiki/spaces/MP/pages/17727489/ADR-0003+Real-time+transport+draft).
File names: `<start time, UTC>-<transport>-<viewers>v-<placements per second>r.json`.

## 2026-10-21: T1 (500 viewers) and T2 (2,000 viewers)

- Commands: `scripts/load-matrix.sh --viewers 500 --warmup 10 --duration 60`, then the same with
  `--viewers 2000`. Every transport ran against a freshly started server container.
- Load tool at commit `b356a85`. After the runs only the wording of one warning changed.
- Server container: 1 CPU (`cpus: 1`), 1 GB, Node 24.22.1 (`node:24-alpine`), batches every 100 ms,
  30 placements per second from one writer.
- Load tool: in the same Docker VM, without a CPU limit, one worker thread per 100 viewers (at most
  11).
- Host: MacBook Pro with an M2 Pro (12 cores), macOS 15.1.1, Docker Desktop with engine 29.8.0;
  the Docker VM had 12 CPUs and 12.5 GB.
- `2026-10-21T21-09-05-lp-2000v-30r.json` is **not a valid latency measurement**. The load tool
  itself was overloaded (event loop p99 828 ms, see `warnings`). The server-side numbers in it
  (CPU, event loop, batches per second) are still valid and show the server saturated.
