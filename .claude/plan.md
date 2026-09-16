# Plan: Replace GitHub Storage with Local JSON DB

## The honest answer: does it make sense?

Yes, but only if you run this app on your own server (VPS, home server, or self-hosted). It does NOT make sense on Vercel, because Vercel is serverless — each function invocation is stateless and has no persistent local filesystem. Writing a file in a Vercel function and reading it back a second later will fail silently (files land in /tmp, are ephemeral, and not shared across instances).

So this plan has two branches. You need to pick one before any code is written.

---

## Branch A: Self-hosted (Node.js / Docker on VPS)

You run `next start` on a real server. Files persist. This is the right choice if you want simplicity, full control, and no GitHub dependency.

### What changes

| Layer | Before | After |
|---|---|---|
| Storage | GitHub Contents API (`users/{id}/data.json`) | Local FS (`data/{userId}.json`) |
| Conflict/SHA | SHA-based optimistic locking + 409 retry | File-level mutex (write lock per userId) |
| Auth | Same (Google OAuth via NextAuth) | Same — unchanged |
| DataContext | Same — unchanged | Same — unchanged |
| sync route | Calls `github.ts` | Calls new `localdb.ts` |
| Env vars | `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, etc. | `DATA_DIR` (path to JSON storage directory) |

### New file: `src/lib/localdb.ts`

```ts
import fs from "fs/promises";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

function userPath(userId: string) {
  // userId goes through a safe hash to prevent path traversal
  return path.join(DATA_DIR, `${safeId(userId)}.json`);
}

export async function readDataFile(userId): Promise<{ data: AppData | null }>
export async function writeDataFile(userId, data: AppData): Promise<void>
```

No SHA needed — the file mutex replaces optimistic locking. Write is atomic via write-to-temp + rename (avoids partial writes).

### Write atomicity (replaces SHA/409 dance)

```
1. Write to data/{userId}.tmp
2. fs.rename(tmp → data/{userId}.json)   ← atomic on Linux
```

`rename` is atomic at the OS level. Two concurrent writes: one wins, one gets ENOENT on the rename — retry. Much simpler than the current GitHub SHA conflict loop.

### Migration path for existing users

On first read: if `data/{userId}.json` doesn't exist, return empty. Users re-sync manually (Senkronizasyon page → "GitHub'dan geri yükle") or you write a one-time migration script that reads GitHub and writes local files.

### Deployment change

- Vercel → out. Use Railway, Fly.io, Render, or a plain VPS with Docker.
- `Dockerfile` needed (Next.js + volume mount for `/data`).
- No more `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_BRANCH`.
- Add: `DATA_DIR=/data` env var.

### Effort estimate

- `src/lib/localdb.ts` — new file, ~80 lines
- `src/app/api/sync/route.ts` — swap import from `github` → `localdb`, remove `sha` field
- `src/context/DataContext.tsx` — remove `sha` from sync calls (minor)
- `Dockerfile` + `docker-compose.yml` — new files
- Tests — update mocks to mock `fs` instead of `fetch`
- **Total: 2–3 days**

---

## Branch B: Stay on Vercel, swap GitHub for a real DB

Keep Vercel serverless. Replace GitHub with a proper cloud database. Best options for this app's scale:

| Option | Pros | Cons |
|---|---|---|
| **Vercel KV (Redis)** | Zero config, same dashboard, JSON native | Paid after free tier, Redis is KV not relational |
| **Turso (libSQL/SQLite)** | SQLite semantics, free tier generous, edge-native | Needs schema, migrations |
| **PlanetScale / Neon (Postgres)** | Full relational power | Overkill for this app size, schema complexity |
| **Vercel Blob** | Like GitHub but official, no SHA games | Still blob storage, same eventual-consistency issues |

**Recommended for Vercel: Turso.** SQLite edge DB. Your data model maps 1:1 to tables. No SHA conflict games — SQL transactions handle concurrency. Free tier covers thousands of users.

Schema:
```sql
CREATE TABLE app_data (
  user_id TEXT PRIMARY KEY,
  data    TEXT NOT NULL,         -- JSON blob (same AppData shape)
  updated_at INTEGER NOT NULL    -- unix ms
);
```

Single row per user, JSON column. Reads and writes are single SQL statements. Atomic by default. No migration complexity. Can add columns later.

Effort: 1–2 days (Turso client install, new `db.ts`, route update, drop `github.ts`).

---

## What DOESN'T change regardless of branch

- `DataContext.tsx` — localStorage + sync logic stays identical. The sync route is the only seam.
- Auth — unchanged.
- All UI components — unchanged.
- The `AppData` type interface — unchanged.
- Tests for business logic — unchanged.

The entire swap is isolated to:
1. `src/lib/github.ts` → replaced
2. `src/app/api/sync/route.ts` → minor update (remove sha field)
3. `src/context/DataContext.tsx` → remove sha from POST body (3 lines)
4. Env vars

---

## My recommendation

**If you have a VPS or are willing to run Docker → Branch A (local JSON).** Simplest possible backend. No external dependencies. Works offline. No rate limits. No tokens to manage.

**If you want to stay on Vercel → Branch B with Turso.** Solves the same problems GitHub caused (rate limits, SHA conflicts, base64 overhead) cleanly, stays serverless.

**Don't use Vercel + local JSON.** Serverless + local filesystem = data loss.

---

## Decision needed before implementation starts

Which hosting model are you on or planning for?
- [ ] Self-hosted (VPS / Docker / home server) → Branch A
- [ ] Vercel (or other serverless) → Branch B, pick DB

Answer this and I'll start the implementation immediately.
