# Plan: Dokploy Deployment Optimisation

## Context

The project already has `output: "standalone"` in `next.config.ts` and a basic `Dockerfile`. However, several issues make it non-production-ready on Dokploy:

1. **Dockerfile is incomplete** — no `.dockerignore`, no non-root user, no `HOSTNAME` env var (required by Next.js standalone for binding), and `public/` isn't copied correctly for the standalone runner.
2. **`docker-compose.yml` has a placeholder `DATA_DIR=/data`** but the `localdb.ts` layer (filesystem-based JSON persistence) uses `process.env.DATA_DIR ?? "./data"` — the volume mount and env var must be wired together consistently.
3. **Environment variables are undocumented** — Dokploy needs a single reference file to fill in the "Environment Variables" panel. There is currently no `.env.example`.
4. **Health check is missing** — Dokploy's zero-downtime deploy and auto-restart depend on a `/api/health` endpoint (or at minimum a TCP check); neither exists.
5. **`next.config.ts` missing `HOSTNAME` handling** — standalone server binds to `127.0.0.1` by default, which is unreachable from Dokploy's reverse proxy. Must set `HOSTNAME=0.0.0.0` in the container.
6. **`AUTH_SECRET` / `NEXTAUTH_URL`** are mandatory at build time for NextAuth v5 — the Dockerfile doesn't declare build-arg placeholders, so `npm run build` may fail in CI if they aren't set.

## Recommended Approach

### 1. Fix the Dockerfile

**File:** `Dockerfile`

- Add `ARG` declarations for build-time env vars needed by NextAuth (`AUTH_SECRET`, `NEXTAUTH_URL`) with empty defaults so the build doesn't hard-fail.
- Add `COPY --from=builder /app/public ./public` — the current file has this but must ensure ordering is correct.
- Add `ENV HOSTNAME=0.0.0.0` — binds Next.js standalone server to all interfaces.
- Add a non-root user (`addgroup`/`adduser` pattern, Alpine-compatible) and `USER nextjs`.
- Add `HEALTHCHECK` instruction pointing at `/api/health`.

### 2. Add `.dockerignore`

**File:** `.dockerignore` (new)

Exclude: `node_modules`, `.next`, `.git`, `data/`, `*.local`, `.env*` (except `.env.example`), test files, `coverage/`. Keeps image lean and prevents secrets leaking into the build context.

### 3. Add `/api/health` route

**File:** `src/app/api/health/route.ts` (new)

Simple `GET` handler returning `{ status: "ok", ts: Date.now() }` with `200`. No auth required. Used by Dokploy health checks and the Dockerfile `HEALTHCHECK`.

### 4. Fix `docker-compose.yml`

**File:** `docker-compose.yml`

- Add `DATA_DIR=/data` env var (already there but missing in some versions — confirm present).
- Add `HOSTNAME=0.0.0.0`.
- Move secrets out of compose into `env_file: .env.local` reference.
- Add `healthcheck` block pointing to `http://localhost:3000/api/health`.
- Keep the `/data` volume mount as-is.

### 5. Add `.env.example`

**File:** `.env.example` (new)

Document all required env vars with comments:

```
# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# NextAuth
AUTH_SECRET=          # openssl rand -base64 32
NEXTAUTH_URL=         # https://your-dokploy-domain.com

# GitHub storage backend
GITHUB_TOKEN=         # PAT with contents:read+write
GITHUB_REPO_OWNER=
GITHUB_REPO_NAME=
GITHUB_BRANCH=main

# Local filesystem backend (set by docker-compose / Dokploy volume)
DATA_DIR=/data
```

### 6. Dokploy-specific notes in README (optional, low-priority)

Add a `## Deployment` section to `README.md` (if it exists) or a new `docs/deployment.md` covering:
- Which env vars to set in Dokploy's "Environment" panel
- Volume mount: `/data` persistent volume
- Health check path: `/api/health`

## Critical Files

| File | Action |
|---|---|
| `Dockerfile` | Fix HOSTNAME, non-root user, HEALTHCHECK, ARG declarations |
| `.dockerignore` | Create new |
| `src/app/api/health/route.ts` | Create new |
| `docker-compose.yml` | Add HOSTNAME env, healthcheck block |
| `.env.example` | Create new with all vars documented |

## Existing code to reuse

- `src/lib/localdb.ts` — already reads `DATA_DIR` from env; no changes needed.
- `src/app/api/sync/route.ts` — already handles GitHub read/write; no changes needed.
- `next.config.ts` — `output: "standalone"` already set; no changes needed.

## Verification

1. `docker build -t isimnet .` — must complete without errors.
2. `docker run --env-file .env.local -p 3000:3000 isimnet` — app must be reachable at `localhost:3000`.
3. `curl localhost:3000/api/health` — must return `{"status":"ok",...}` with HTTP 200.
4. `docker compose up` — full stack must start; health check must pass within 30s.
5. In Dokploy: set env vars from `.env.example`, point to the repo, set health check path to `/api/health`, deploy — zero-downtime redeploy must work.
