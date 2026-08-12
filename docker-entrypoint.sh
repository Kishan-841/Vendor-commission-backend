#!/bin/sh
set -e

echo "→ Applying database migrations…"
npx prisma migrate deploy

echo "→ Seeding admin + settings (idempotent)…"
npx tsx prisma/seed.ts || echo "  seed skipped (continuing)"

echo "→ Starting VCMS API…"
exec node dist/server.js
