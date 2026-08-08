# syntax=docker/dockerfile:1

##############################################################################
# PriceTrail Worker
#
# Deliberately NOT Alpine, unlike the API. Two dependencies force it:
#
#   Playwright  ships a Chromium build linked against glibc, plus ~40 system
#               libraries. Making it run on musl means fighting the toolchain
#               for no gain.
#   ONNX / sharp both distribute prebuilt glibc binaries; on Alpine they
#               either fall back to a slow path or fail to load outright.
#
# The Playwright base image already carries Chromium and its dependencies at
# a version matched to the npm package. Installing the browser separately is
# how you get "browser was not found at path" after a routine dependency bump.
##############################################################################

ARG PLAYWRIGHT_VERSION=v1.62.1-noble

# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION} AS base
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json              apps/worker/
COPY packages/database/package.json        packages/database/
COPY packages/marketplace/package.json     packages/marketplace/
COPY packages/matching/package.json        packages/matching/
COPY packages/embeddings/package.json      packages/embeddings/
COPY packages/queue/package.json           packages/queue/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @pricetrail/database generate \
 && pnpm --filter @pricetrail/database build \
 && pnpm --filter @pricetrail/queue build \
 && pnpm --filter @pricetrail/marketplace build \
 && pnpm --filter @pricetrail/matching build \
 && pnpm --filter @pricetrail/embeddings build \
 && pnpm --filter @pricetrail/worker build

# CI=true: pnpm will not purge a modules directory without an interactive
# confirmation, and a build has no TTY to give one.
RUN CI=true pnpm prune --prod

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV TZ=UTC

# Bake the embedding model into the image.
#
# Without this the FIRST job of every fresh container downloads ~30 MB from
# HuggingFace before it can do any work — so a scale-up event during the daily
# sweep stalls, and an outage at HuggingFace becomes an outage here. Baked in,
# the container is self-contained and starts cold in milliseconds.
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

COPY --from=build /app/node_modules              ./node_modules
COPY --from=build /app/package.json              ./package.json
COPY --from=build /app/apps/worker/dist          ./apps/worker/dist
COPY --from=build /app/apps/worker/node_modules  ./apps/worker/node_modules
COPY --from=build /app/packages                  ./packages

# Warm the model cache at build time, not at first job.
RUN node -e "\
const { pipeline } = require('@huggingface/transformers');\
pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' })\
  .then(() => console.log('model cached'))\
  .catch((e) => { console.error('model prefetch failed:', e.message); process.exit(1); })" \
 && chown -R pwuser:pwuser /app/.cache

# The Playwright image ships a non-root `pwuser` already configured for
# Chromium's sandbox.
USER pwuser

# No port: the worker consumes queues and serves no HTTP. Liveness is inferred
# from queue progress, not from a probe — a worker that answers a health check
# while its BullMQ connection is dead is worse than no check at all.

# Exec form so SIGTERM reaches Node directly. The shutdown handler closes each
# Worker, which lets in-flight jobs finish rather than being killed mid-fetch
# and left locked until BullMQ's stall timeout.
CMD ["node", "apps/worker/dist/main.js"]
