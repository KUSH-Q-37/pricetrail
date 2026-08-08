# Phase 14 — Deployment status

Honest record of what is done, what is not, and exactly where the remaining
blocker sits.

## Done and verified

- **`.dockerignore`** — excludes `node_modules` (host-compiled binaries would
  break in a Linux image), `.env`, build output.
- **CI** (`.github/workflows/ci.yml`) — four staged jobs: typecheck + unit with
  coverage gates → integration against a real pgvector Postgres and Redis →
  Playwright E2E → image builds. The disposable service containers provide the
  throwaway test database that Phase 13 lacked. Pushed; not yet observed
  running.
- **Prisma client relocated** into `packages/database/generated/client` via the
  generator's `output`. This was a genuine prerequisite: the default target
  (`node_modules/.prisma`) belongs to no package, so `pnpm deploy` cannot carry
  it. Workspace typechecks and all 160 unit tests pass with the new path.
- **API image builds** — 365 MB (down from 2.35 GB after moving to
  `pnpm deploy`), non-root, correct exec-form `CMD` so SIGTERM reaches Node.

## NOT done — the blocker

**Neither image boots.** The API container fails at startup with:

```
Error: Cannot find module 'bullmq'
```

### Root cause

pnpm links workspace packages by **symlink**. `pnpm deploy` resolves
third-party dependencies correctly but emits `@pricetrail/*` entries that point
back at the source checkout, which does not exist in the runtime stage. Node
then reports "Cannot find module '@pricetrail/database'" for a path `ls` shows
is present.

### What was tried

1. **Hand-copying `node_modules`** — produced dangling symlinks and a 2.35 GB
   image. Abandoned.
2. **`pnpm deploy --legacy` + manually copying `packages/*/dist`** — fixed
   `@pricetrail/database`, but each workspace package's OWN dependencies
   (`bullmq` from `@pricetrail/queue`, `cheerio` from `@pricetrail/marketplace`)
   were still missing, because only `package.json` + `dist` were copied.
3. **`injectWorkspacePackages: true` + `pnpm deploy`** — the documented pnpm
   answer, and it **broke local development**: injected packages are copied at
   install time rather than symlinked, so edits to `packages/*` stop
   propagating and `apps/worker` cannot resolve `@pricetrail/queue` until a
   full reinstall. Reverted.

### Options for whoever picks this up

- **Bundle instead of deploy.** Run the API through `esbuild`/`tsup` with
  workspace packages bundled in, so the image needs no workspace resolution at
  all. Probably the cleanest answer, and standard for containerised Node.
- **Two lockfiles / a CI-only inject.** Enable `injectWorkspacePackages` only
  in the Docker build (a separate `pnpm-workspace.yaml` copied in at build
  time), leaving local development on symlinks.
- **Publish workspace packages** to a private registry and depend on versions
  rather than `workspace:*`. Heaviest, but removes the problem entirely.

The worker image has the same shape and was never built; it will hit the same
wall plus Playwright and ONNX weight.

## Also not done

- Production env template and deployment runbook
- Sentry wiring
- Database backup policy

## Unaffected

Local development is fully working — `pnpm -r typecheck` clean, 160 unit tests
and 11 E2E passing, dev stack healthy. Nothing in this phase changed runtime
behaviour; the only production-code change was the Prisma output path, which is
verified by the existing suites.
