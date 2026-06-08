#!/usr/bin/env bash
set -euo pipefail

cd /app

echo "[entrypoint] waiting for database..."
# Simple wait loop using node + Prisma DATABASE_URL
node -e "
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing'); process.exit(1); }
(async () => {
  for (let i = 0; i < 40; i++) {
    const c = new Client({ connectionString: url });
    try { await c.connect(); await c.end(); process.exit(0); }
    catch (e) { console.log('  postgres not ready (' + (i+1) + '/40)…'); await new Promise(r=>setTimeout(r, 1500)); }
  }
  console.error('postgres never became ready'); process.exit(1);
})();
"

echo "[entrypoint] applying prisma migrations..."
npx prisma migrate deploy

if [ "${SEED_ON_BOOT:-true}" = "true" ]; then
  user_count="$(node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.user.count().then(n => { console.log(n); return p.\$disconnect(); }).catch(() => { console.log(0); process.exit(0); });
  ")"
  if [ "${user_count:-0}" = "0" ]; then
    echo "[entrypoint] empty database — running seed..."
    node prisma/seed.js || echo "[entrypoint] seed exited non-zero (continuing)"
  else
    echo "[entrypoint] database already has ${user_count} user(s) — skipping seed."
  fi
fi

echo "[entrypoint] starting: $*"
exec "$@"
