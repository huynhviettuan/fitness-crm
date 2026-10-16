# The API and the worker (doc 15, A-312, A-319): one image, two start commands.
#   API:     node dist/main.js     (RUN_JOBS=false)
#   worker:  node dist/worker.js   (runs the jobs, including the daily backup, which needs pg_dump)
#   release: ./node_modules/.bin/prisma migrate deploy     (migrations, before the new API takes traffic)
#   trial:   sh scripts/start-trial.sh   (keys checked, migrations, first admin, the API; docs/34)
# Built from the repository root:  docker build -f apps/api/Dockerfile -t gymcrm-api .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "api..."
# prisma's config reads DATABASE_URL even to generate the client; nothing connects at build time.
RUN pnpm --filter @gymcrm/shared build \
  && DATABASE_URL=postgresql://build@localhost/build pnpm --filter api generate \
  && pnpm --filter api build
# Only what runs (A-319): the API with its production dependencies (prisma's CLI and tsx among them, for the
# migrations and the first admin) and the built shared package; no compilers, test tools or the web app's packages.
# better-auth lists Next.js as an optional peer and pnpm links the web app's; the API never imports better-auth's Next.js
# helpers, so Next.js (about 300 MB with its compiler) and the test browser package it brings are removed. The CI image
# job proves the image still starts, migrates, seeds and signs in.
RUN pnpm --filter api deploy --prod --legacy /prod/api \
  && cd /prod/api \
  && rm -rf Dockerfile test eslint.config.mjs vitest.config.mts tsconfig*.json nest-cli.json \
  && find src -name "*.test.ts" -delete \
  && rm -rf node_modules/.pnpm/next@* node_modules/.pnpm/@next+* node_modules/.pnpm/@playwright+* node_modules/.pnpm/playwright*

FROM node:22-alpine
# pg_dump and pg_restore of the server's major version (PostgreSQL 17).
RUN apk add --no-cache postgresql17-client
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/api /app
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
