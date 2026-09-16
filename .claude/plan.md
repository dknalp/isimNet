# Plan: Local JSON DB (lowdb) as Primary + GitHub as Cloud Backup

## Decision: NOT lowdb. Use atomic file writes directly.

Research shows lowdb v7 is:
- Last published 3 years ago (abandoned)
- Pure ESM — causes Webpack issues with Next.js
- No transactions, no ACID guarantees
- Just a thin wrapper over JSON.parse/fs.writeFile anyway

**Better choice: raw `node:fs/promises` with atomic write (write-to-tmp → rename).** This is what lowdb does internally, but without the baggage. We already wrote a version of this in the plan last time. Zero deps, zero ESM issues, total control.

For schema-level queries we don't need SQL — our data model is flat arrays with ID lookups, exactly what the existing in-memory operations already do.

---

## Architecture After Migration

```
User browser
  └── localStorage (instant UI)
  └── DataContext (state, CRUD, dirty tracking)
        └── POST /api/sync  ──→  localdb.ts  ──→  data/{userId}.json   ← PRIMARY
        └── POST /api/backup ──→ github.ts   ──→  GitHub repo           ← CLOUD BACKUP (on demand + daily)
        └── GET  /api/sync  ──→  localdb.ts  ──→  reads local file
        └── GET  /api/backup ──→ github.ts   ──→  reads GitHub (restore only)
```

Key principle: **local file is always the source of truth. GitHub is a backup only** — user can push to it manually or schedule a daily export. Restore from GitHub is an explicit user action.

---

## Files Changed

### New
| File | What |
|---|---|
| `src/lib/localdb.ts` | Atomic read/write using `node:fs/promises`. Replaces `github.ts` as primary. |
| `src/app/api/backup/route.ts` | New route — GET reads GitHub (restore), POST pushes to GitHub (manual/scheduled backup). |
| `Dockerfile` | Node 20 Alpine, exposes 3000, volume `/app/data` |
| `docker-compose.yml` | Single-service compose with DATA_DIR volume |

### Modified
| File | What changes |
|---|---|
| `src/app/api/sync/route.ts` | Import `localdb` instead of `github`. Remove `sha` from response — local files don't need it. |
| `src/context/DataContext.tsx` | Remove `shaRef`, remove `sha` from POST body. Add `backupToGitHub()` and `restoreFromGitHub()` in place of current `syncToDrive`/`restoreFromDrive`. |
| `src/app/dashboard/senkronizasyon/page.tsx` | Rename UI labels: "Senkronizasyon" → "Yedekleme". Add "GitHub'a Yedekle" + "GitHub'dan Geri Yükle" buttons. |
| `next.config.ts` | Add `serverExternalPackages: []` (nothing needed since we use raw fs, not lowdb) |
| `.env.example` | Replace GITHUB_* sync vars with `DATA_DIR`. Keep GITHUB_* for backup feature. |

### Deleted
| File | Reason |
|---|---|
| `src/lib/github.ts` | Responsibilities split: localdb.ts (primary) + backup route (cloud backup). |

---

## `src/lib/localdb.ts` — Core design

```ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

// Prevent path traversal — hash userId into a safe filename
function safeFilename(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex") + ".json";
}

function userPath(userId: string) {
  return path.join(DATA_DIR, safeFilename(userId));
}

export async function readDataFile(userId: string): Promise<AppData | null> {
  try {
    const raw = await fs.readFile(userPath(userId), "utf-8");
    return JSON.parse(raw) as AppData;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;  // unexpected error — let caller handle
  }
}

export async function writeDataFile(userId: string, data: AppData): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = userPath(userId);
  const tmp    = target + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, target);  // atomic on Linux/macOS
}
```

No SHA. No retry logic. No base64. No network. Atomic by OS guarantee.

---

## `src/app/api/sync/route.ts` — After

GET and POST stay the same shape — DataContext doesn't need to change its call pattern.
Only change: remove `sha` from GET response and POST body. No sha validation needed.

```ts
// GET: return data, no sha
return NextResponse.json({ ...data });  // no sha field

// POST: write and return ok
await writeDataFile(session.userId, data);
return NextResponse.json({ ok: true });  // no sha field
```

---

## `src/app/api/backup/route.ts` — New

```ts
// GET  → read from GitHub (for restore)
// POST → write to GitHub (manual backup)
```

This is exactly what `src/lib/github.ts` does today — moved to a dedicated backup route. The existing `readOrMigrateDataFile` / `writeDataFile` from github.ts become the backup layer. Migration logic (legacy files → data.json) can be kept or dropped — up to you.

---

## DataContext changes (minimal)

Remove:
- `shaRef` (no more SHA)
- `sha: currentSha` from POST body
- `json.sha` check in sync response handler

Rename/repurpose:
- `syncToDrive()` → stays but calls `/api/sync` (local) — already done
- `restoreFromDrive()` → calls `/api/backup` GET — just URL change
- Add `backupToGitHub()` → calls `/api/backup` POST

Total lines changed in DataContext: ~15.

---

## Migration for existing users

Users already have data in GitHub. On first boot of the new version:
1. Local file doesn't exist → GET /api/sync returns empty
2. User goes to Senkronizasyon page → clicks "GitHub'dan Geri Yükle"
3. App calls GET /api/backup → reads GitHub → writes to local file → loads into DataContext
4. Done. Local file is now the source of truth.

No automatic migration needed. The restore flow already exists — we just retarget it.

---

## Docker deployment

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - isimnet_data:/data
    env_file: .env
volumes:
  isimnet_data:
```

---

## Env vars after migration

```
# Keep (auth)
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
AUTH_SECRET
NEXTAUTH_URL

# New (primary storage)
DATA_DIR=/data

# Keep (cloud backup only — optional, can be left unset to disable backup)
GITHUB_TOKEN
GITHUB_REPO_OWNER
GITHUB_REPO_NAME
GITHUB_BRANCH
```

If GITHUB_* vars are not set, backup buttons are disabled in the UI with a tooltip.

---

## Implementation order

1. `src/lib/localdb.ts` — new file, ~50 lines
2. `src/app/api/sync/route.ts` — swap import, remove sha (~10 line change)
3. `src/app/api/backup/route.ts` — new file, moves github logic here (~60 lines)
4. `src/context/DataContext.tsx` — remove shaRef + sha from POST, add backupToGitHub (~15 line change)
5. `src/app/dashboard/senkronizasyon/page.tsx` — UI update for backup vs sync labels
6. `Dockerfile` + `docker-compose.yml` — new files
7. Tests — update sync-route.test.ts (remove sha assertions), add localdb.test.ts
8. Delete `src/lib/github.ts` — move to backup route

**Total estimated effort: 1.5–2 days**

---

## Risk: nothing

- DataContext call pattern unchanged (same /api/sync GET/POST)
- Auth unchanged
- UI unchanged except Senkronizasyon page labels
- GitHub integration preserved as backup — users don't lose existing cloud data

