#!/bin/sh
# Runs the same load against every transport, each against a freshly started server container,
# so that memory left over from one run does not count for the next.
#
#   scripts/load-matrix.sh --viewers 500 --duration 60
#   TRANSPORTS="ws sse" MAX_BUFFERED_BYTES=65536 scripts/load-matrix.sh --slow 10
#   PROXY=caddy scripts/load-matrix.sh --viewers 500          # through Caddy with TLS (T6)
#
# The flags go to the load tool as they are; reports land in results/. The server settings
# (BATCH_MS, MAX_BUFFERED_BYTES, LOG_FILE, CADDY_ENCODE) are read from the environment, see
# compose.yaml.
set -eu
cd "$(dirname "$0")/.."

ca=/caddy-data/caddy/pki/authorities/local/root.crt
if [ "${PROXY:-}" = caddy ]; then
  profile='--profile tls'
  services='server caddy'
  set -- "$@" --url https://caddy:8443 --proxy-metrics-url http://caddy:9180/metrics
else
  profile=''
  services='server'
fi

docker compose build
for transport in ${TRANSPORTS:-ws sse lp poll}; do
  docker compose $profile up -d --force-recreate --wait $services
  if [ "${PROXY:-}" = caddy ]; then
    # Caddy creates its local CA on the first start; the load tool needs the root certificate.
    until docker compose exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt; do
      sleep 0.5
    done
    docker compose run --rm --no-deps -e NODE_EXTRA_CA_CERTS=$ca load --transport "$transport" "$@"
  else
    docker compose run --rm --no-deps load --transport "$transport" "$@"
  fi
done
docker compose $profile stop
