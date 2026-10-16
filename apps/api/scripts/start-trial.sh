#!/bin/sh
# The free trial's start (A-314, docs/34): the keys are checked, then, as the free plan has no release step, the migrations run here, then the first
# admin is made when SEED_ADMIN_EMAIL is set (safe to repeat: an existing admin is left alone), then the API starts.
set -e
cd "$(dirname "$0")/.."
# prisma runs the seed command ("tsx prisma/seed.ts") through the shell: the package binaries must be on the PATH.
export PATH="$PWD/node_modules/.bin:$PATH"
node scripts/check-keys.mjs
./node_modules/.bin/prisma migrate deploy
if [ -n "$SEED_ADMIN_EMAIL" ]; then
  ./node_modules/.bin/prisma db seed
fi
exec node dist/main.js
