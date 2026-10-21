#!/bin/sh
# Runs the same load against every transport, each against a freshly started server container,
# so that memory left over from one run does not count for the next.
#
#   scripts/load-matrix.sh --viewers 500 --duration 60
#   TRANSPORTS="ws sse" MAX_BUFFERED_BYTES=65536 scripts/load-matrix.sh --slow 10
#
# The flags go to the load tool as they are; reports land in results/. The server settings
# (BATCH_MS, MAX_BUFFERED_BYTES, LOG_FILE) are read from the environment, see compose.yaml.
set -eu
cd "$(dirname "$0")/.."

docker compose build
for transport in ${TRANSPORTS:-ws sse lp poll}; do
  docker compose up -d --force-recreate --wait server
  docker compose run --rm --no-deps load --transport "$transport" "$@"
done
docker compose stop server
