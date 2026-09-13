#!/bin/sh
# Runs the app as the unprivileged "node" user. When the container starts as root (the default,
# so that a data volume created by an older root-only image keeps working), fix ownership of the
# data directory and then drop privileges before starting Node.
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
