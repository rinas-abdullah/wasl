#!/bin/sh
set -e
node dist/db/migrate.js
if [ "${SEED_DEMO_ON_START:-false}" = "true" ]; then
  node dist/db/seed/run.js   # idempotent: skips if the demo organisation already exists
fi
exec node dist/server.js
