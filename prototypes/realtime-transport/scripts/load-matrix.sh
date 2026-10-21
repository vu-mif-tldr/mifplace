#!/bin/sh
# Runs the same load against every transport, each against a freshly started server container,
# so that memory left over from one run does not count for the next.
#
#   scripts/load-matrix.sh --viewers 500 --duration 60
#
# The flags go to the load tool as they are; reports land in results/.
set -eu
cd "$(dirname "$0")/.."

docker compose build
for transport in ws sse lp poll; do
  docker compose up -d --force-recreate --wait server
  docker compose run --rm load --transport "$transport" "$@"
done
docker compose stop server
