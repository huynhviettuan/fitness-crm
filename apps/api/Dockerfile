# The API and the worker (doc 15, A-312): one image, two start commands.
#   API:     node dist/main.js     (RUN_JOBS=false)
#   worker:  node dist/worker.js   (runs the jobs, including the daily backup, which needs pg_dump)
#   release: pnpm --filter api db:deploy     (migrations, before the new API takes traffic)
# Built from the repository root:  docker build -f apps/api/Dockerfile -t flow-api .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
# The API and what it needs from the workspace; prisma's CLI stays (the release step), so devDependencies are kept.
RUN pnpm install --frozen-lockfile --filter "api..."
# prisma's config reads DATABASE_URL even to generate the client; nothing connects at build time.
RUN pnpm --filter @flow/shared build \
  && DATABASE_URL=postgresql://build@localhost/build pnpm --filter api generate \
  && pnpm --filter api build

FROM node:22-alpine
# pg_dump and pg_restore of the server's major version (PostgreSQL 17).
RUN apk add --no-cache postgresql17-client && corepack enable
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
