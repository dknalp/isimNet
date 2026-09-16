# Backend Engineering Report: Bugs, Critical Issues & Test Gaps

## Context

Deep analysis of the IsimNet backend: `src/lib/github.ts`, `src/app/api/sync/route.ts`, `src/context/DataContext.tsx`, `src/lib/customers.ts`, `src/lib/products.ts`, and all four test files. The goal is to surface real bugs, data integrity risks, and missing test coverage before they hit production.

---

## CRITICAL BUGS

### 1. Silent Write Failure — No Error Propagation to UI
**File:** `src/context/DataContext.tsx:203-218` (`syncToDrive`)  
**Bug:** When `POST /api/sync` returns `ok: true` but with `sha: null` (GitHub write returned null due to 409 double-conflict or 500), `shaRef.current` is set to `null`. The next write attempt goes out with no SHA. GitHub will reject it with 422 (Unprocessable) if the file already exists — because a PUT without SHA on an existing file is invalid. The user sees no error; data silently fails to sync.  
**Impact:** Data loss. User thinks they saved; they didn't.

### 2. deleteCustomer Mutates Multiple State Slices Non-Atomically
**File:** `src/context/DataContext.tsx:300-305`  
**Bug:** `deleteCustomer` calls `setC`, `setS`, `setPay`, `setD` — four separate React state updates. Between renders, `stateRef.current` is updated on each render, but `mutationSeq` is incremented 4 times. If `syncToDrive` fires (via the 3-min timer or visibility change) between any two of these updates, it sends a partially-cleaned dataset: the customer is deleted but some of their sales/payments/debts still exist. This partial state gets persisted to GitHub.  
**Impact:** Orphan records in GitHub's copy; data corruption.

### 3. ID Generation: `Date.now()` Is Not Unique Under Rapid Creation
**File:** `DataContext.tsx:290, 310, 326, 368, 381`  
**Bug:** All IDs use `` `c_${Date.now()}` ``. `Date.now()` has millisecond resolution. Rapid additions (e.g., bulk import, fast double-tap) within the same millisecond produce duplicate IDs.  
**Impact:** Silent record collision — one record silently overwrites another in array lookups.

### 4. `readDataFile` Swallows JSON Parse Errors
**File:** `src/lib/github.ts:43-47`  
**Bug:** If GitHub returns 200 but `json.content` is malformed base64 or the decoded content is invalid JSON, the `JSON.parse` on line 45 throws. This exception propagates up uncaught to the `GET /api/sync` handler's try/catch, which returns `{ error: "Read failed", status: 500 }`. The client then falls back to localStorage silently — but the user's GitHub data is corrupt and they have no idea.  
**Impact:** Corrupt remote data goes undetected; user continues making changes against stale local data that will overwrite GitHub on next sync.

### 5. `buildActivityFeed` Sort Is Unstable for Same-Millisecond Events
**File:** `src/lib/customers.ts:68`  
**Bug:** Sort uses `a.date.localeCompare(b.date)`. Dates are stored as ISO strings (full timestamp). Two events added in rapid succession get the same timestamp. The sort is not stable across all JS engines (V8 is stable since Node 11, but the sort comparator returns 0 → arbitrary order). Running balance depends on order, so the displayed `runningBalance` for same-timestamp events is non-deterministic.  
**Impact:** Wrong balance displayed in customer feed.

### 6. `deleteCustomer` Does NOT Restore Stock for Deleted Sales
**File:** `DataContext.tsx:300-305`  
**Bug:** When a customer is deleted, their sales are deleted (`setS` filter), but the product stock is never restored. `deleteSale` restores stock correctly, but `deleteCustomer` bypasses it and directly filters sales.  
**Impact:** Stock counts are permanently wrong after a customer deletion that had sales.

### 7. `attemptWrite` Uses `json.content?.sha` — Wrong Field for New Files
**File:** `src/lib/github.ts:101`  
**Bug:** GitHub's Contents API PUT response for a **create** (new file) returns `{ content: { sha: "..." }, commit: {...} }` — `content.sha` is the blob SHA, **not** the file SHA needed for future updates. The file SHA needed for subsequent updates is in `json.content.sha` on an update, but the path when creating is also `json.content.sha`. These are actually the same field; however the code returns `json.content?.sha` which would be null if the GitHub response structure changes. More critically: on the write-on-404 path in `writeDataFile` lines 115-117, the code casts to `Promise<string | null>` — `attemptWrite` returns `string | "CONFLICT" | null`, and the cast hides that "CONFLICT" is still possible in that branch.  
**Impact:** Type unsafety; CONFLICT from the null-SHA write path returns `"CONFLICT"` as the sha string, which gets stored in `shaRef.current` and sent to GitHub as a literal SHA — causing 422.

---

## HIGH-SEVERITY MISSING BEHAVIORS

### 8. No Input Validation in POST `/api/sync`
**File:** `src/app/api/sync/route.ts:37-48`  
**Missing:** Body is accepted as-is. An array element with `id: null`, `amount: -99999`, `customerId: ""`, or `vatRate: 15` passes straight through to GitHub. There is no schema validation anywhere in the API layer.  
**Risk:** Corrupt data stored in GitHub; financial calculations silently wrong.

### 9. Token Refresh Error Is Not Propagated — Sync Proceeds with Stale Session
**File:** `src/lib/auth.ts:61-65`  
**Bug:** When `refreshAccessToken` fails, `token.error = "RefreshTokenError"` is set. The session callback at line 70 propagates this to `session.error`. But the sync route only checks `session?.userId` — it never checks `session.error`. A user with an expired, unrefreshable token still gets `userId` in the session and their sync requests go out with a stale `accessToken` (which isn't used in sync — GitHub token is server-side). This is actually fine for GitHub sync itself, but the `session.error` is never surfaced to the user, so they silently use an invalid Google session.

### 10. `restoreFromDrive` Does Not Restore Stock Consistency
**File:** `DataContext.tsx:221-247`  
**Missing:** After restoring from GitHub, product stock values reflect whatever was in the remote file. If the local state had stock modifications (unsaved), the restore correctly overwrites them. But if the remote data itself has inconsistent stock (e.g., stock was manually edited in GitHub JSON), there is no recomputation from sales history. Stock is accepted as-is, which may be wrong.

### 11. `clearAllData` Is Not Atomic — Race With Periodic Sync
**File:** `DataContext.tsx:393-415`  
**Bug:** `clearAllData` sets all state to empty (incrementing `mutationSeq`), then calls POST. The 3-minute interval timer could fire `syncToDrive` concurrently. If the timer fires between the clear and the POST, `syncToDrive` sees `mutationSeq !== syncedSeq` and sends the empty state to GitHub — which is fine. But if the POST in `clearAllData` then also fires, two concurrent POSTs go out with the same SHA. One will get 409; the conflict handler will re-fetch (now empty) and retry with fresh SHA. Net result: correct, but wasteful and log-noisy.

---

## TEST GAPS (Not Covered)

### Currently covered:
- `readDataFile`: 200, 404, 500, correct URL, auth header
- `writeDataFile`: success, sha included/excluded, base64, 409 retry, double-conflict, non-409 failure
- `readOrMigrateDataFile`: existing data.json, all files 404
- `GET /api/sync`: auth, data present, data absent
- `POST /api/sync`: auth, write success, data passing, sha passing, null sha default, write failure

### Missing tests:

| # | What | File to create/extend |
|---|------|-----------------------|
| T1 | `readDataFile` — malformed base64 in `content` throws → should return `null/null` not throw | `github.test.ts` |
| T2 | `readDataFile` — valid base64 but invalid JSON content | `github.test.ts` |
| T3 | `writeDataFile` — 404 during retry-read (file deleted between conflict and retry) uses null SHA | `github.test.ts` |
| T4 | `readOrMigrateDataFile` — legacy files exist, data.json absent → migrates and returns legacy data | `github.test.ts` |
| T5 | `readOrMigrateDataFile` — legacy files exist but migration write fails (returns null sha) | `github.test.ts` |
| T6 | `buildActivityFeed` — empty inputs | new `customers.test.ts` |
| T7 | `buildActivityFeed` — running balance: sale then payment then debt | new `customers.test.ts` |
| T8 | `buildActivityFeed` — same-date events (order stability) | new `customers.test.ts` |
| T9 | `buildActivityFeed` — result is sorted newest-first (reversed) | new `customers.test.ts` |
| T10 | `POST /api/sync` — body with missing fields defaults to `[]` (null safety) | `sync-route.test.ts` |
| T11 | `POST /api/sync` — malformed JSON body (req.json() throws) returns 500 | `sync-route.test.ts` |
| T12 | `GET /api/sync` — GitHub returns corrupt base64 → API returns 500, not 200 with garbage | `sync-route.test.ts` |
| T13 | `formatCurrencyDisplay` — empty string, integer, decimal, already-formatted input | new `format.test.ts` |
| T14 | `parseCurrencyDisplay` — round-trips with `formatCurrencyDisplay` | new `format.test.ts` |
| T15 | ID uniqueness: two rapid `addSale` calls don't collide (currently untestable without crypto.randomUUID — this test should drive the fix) | new `dataContext.test.ts` |

---

## RECOMMENDED FIXES (priority order)

1. **Bug #1 + #7** — In `syncToDrive`, treat `sha: null` response as a sync failure, set `isSyncError` state, surface to user.
2. **Bug #6** — In `deleteCustomer`, iterate over the customer's sales and restore stock before filtering them out (reuse the stock-restore logic from `deleteSale`).
3. **Bug #3** — Replace `Date.now()` IDs with `crypto.randomUUID()` (available in all modern browsers and Node 16+).
4. **Bug #4** — Wrap the `JSON.parse` in `readDataFile` in try/catch; return `{ data: null, sha: null }` on parse error and log a warning.
5. **Bug #2** — Batch the four state updates in `deleteCustomer` into a single logical mutation (use `useReducer` or a single state object), or use a write-lock flag.
6. **Gaps T4/T5** — Add migration tests (the happy path migration is completely untested).
7. **Gap T11** — Add malformed-body test to `sync-route.test.ts`.

---

## Verification

```bash
npm run test              # all unit tests pass
npm run test:coverage     # check coverage on github.ts + route.ts
npx vitest run src/__tests__/customers.test.ts   # new file
npx vitest run src/__tests__/format.test.ts      # new file
```
