# syntax=docker/dockerfile:1

##############################################################################
# PriceTrail API
#
# Multi-stage: a full toolchain builds, a minimal runtime ships. The final
# image carries no compiler, no dev dependencies and no source — only the
# emitted JS and the production module tree.
##############################################################################

ARG NODE_VERSION=24-alpine

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
# Prisma's query engine is built against glibc; Alpine ships musl. Without
# this the engine loads but segfaults on first query, with an error that
# points nowhere near the real cause.
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS deps
# Manifests only, before any source. This layer is keyed on dependency files
# alone, so editing a .ts file does not invalidate a multi-minute install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json                 apps/api/
COPY packages/database/package.json        packages/database/
COPY packages/marketplace/package.json     packages/marketplace/
COPY packages/matching/package.json        packages/matching/
COPY packages/embeddings/package.json      packages/embeddings/
COPY packages/queue/package.json           packages/queue/

# --frozen-lockfile fails the build if the lockfile disagrees with the
# manifests, rather than silently resolving different versions than CI tested.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# Prisma Client is generated code — it does not exist until this runs, and the
# API will not compile without it.
RUN pnpm --filter @pricetrail/database generate \
 && pnpm --filter @pricetrail/database build \
 && pnpm --filter @pricetrail/queue build \
 && pnpm --filter @pricetrail/marketplace build \
 && pnpm --filter @pricetrail/matching build \
 && pnpm --filter @pricetrail/api build

# `pnpm deploy` — NOT a hand-rolled copy of node_modules.
#
# pnpm's node_modules is a symlink graph pointing into a shared .pnpm virtual
# store. Copying selected directories out of it produces a tree whose symlinks
# dangle, and the container dies at startup with MODULE_NOT_FOUND on a package
# that is visibly present in the image. (Learned the hard way: the first cut of
# this file did exactly that, and also weighed 2.35 GB.)
#
# `deploy` resolves the graph into a real, self-contained directory holding
# only this app and its PRODUCTION dependencies.
# No --legacy: with injectWorkspacePackages set in pnpm-workspace.yaml, deploy
# materialises workspace packages as real directories carrying their own
# resolved dependencies, so nothing needs hand-copying afterwards.
RUN CI=true pnpm --filter @pricetrail/api deploy --prod /deploy

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# Storage is UTC everywhere; APP_TIMEZONE decides what "today" means for the
# daily window. Pinning TZ here keeps container logs comparable across regions.
ENV TZ=UTC

# Never run as root. A container compromise should not also be a root
# compromise of the container filesystem.
RUN addgroup -S app && adduser -S app -G app

# One self-contained tree: dist, package.json and a real node_modules.
COPY --from=build --chown=app:app /deploy ./

# No separate Prisma copy needed: schema.prisma emits the client into
# packages/database/generated, which is part of the package and therefore
# carried by `pnpm deploy` above.

USER app
EXPOSE 3001

# Hits the LIVENESS endpoint, not readiness. Readiness fails when Postgres is
# briefly unreachable — and an orchestrator that restarts on a readiness
# failure turns a 30-second database blip into every replica crash-looping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so the process is PID 1 and receives SIGTERM directly. Under the
# shell form, SIGTERM goes to /bin/sh and Nest's shutdown hooks never fire —
# in-flight requests are killed instead of drained.
CMD ["node", "dist/main.js"]
