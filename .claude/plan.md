# Major Development Ideas — İşimNet

This is a prioritized list of high-impact improvements, evaluated from a backend/data-integrity lens but covering the full product. Each idea is scoped by effort and business value.

---

## TIER 1 — High impact, achievable now (architecture fits, no new infra)

### 1. Offline-First PWA with Service Worker + Background Sync
**What:** Convert the app to a full PWA. Cache the shell and API responses with a service worker. Queue writes (new sales, payments) in IndexedDB when offline, replay them to GitHub when connectivity returns via Background Sync API.
**Why it matters:** The current architecture assumes connectivity for every write. A shopkeeper in a basement or rural area loses all their in-progress work on network drop. This is the #1 reliability gap.
**Effort:** Large. Service worker, workbox or manual cache strategy, IndexedDB write queue, conflict resolution on replay.
**Backend impact:** Sync route needs an idempotency key per operation so replayed writes don't double-record.

### 2. Granular Operation Log (Event Sourcing lite)
**What:** Instead of syncing the entire state snapshot on every flush, append individual operations to a log: `{ op: "addSale", payload: {...}, ts: "...", clientId: "..." }`. GitHub stores `log.json` alongside `data.json`. On load, replay the log to reconstruct state.
**Why it matters:** Eliminates the SHA race condition class entirely (append-only never conflicts), enables undo/redo, enables audit trail ("who added this sale and when"), and makes multi-device sync correct instead of last-writer-wins.
**Effort:** Large. Requires log compaction strategy, replay engine, schema migration.
**Backend impact:** Replaces `writeDataFile` with `appendToLog`; read path replays log to derive current state.

### 3. Multi-User / Shared Business Account
**What:** Allow multiple Google accounts to share one data set (e.g., owner + employee). One user is "owner", others are "members" with role-based access (member cannot delete customers, cannot see reports).
**Why it matters:** Almost every SMB has more than one person touching the register. Currently each Google account gets its own isolated data silo — there's no way to collaborate.
**Effort:** Large. Requires an invitation flow, a shared userId namespace, role middleware in the sync route.
**Backend impact:** `users/{ownerId}/data.json` becomes the canonical path; member sessions resolve to the owner's path via an `invitations.json` lookup.

---

## TIER 2 — High value, moderate effort

### 4. Invoice / Receipt Generation (PDF)
**What:** Generate a printable/shareable PDF receipt for each sale: customer name, items, quantities, unit prices, VAT breakdown, total, date. Share via WhatsApp or download.
**Why it matters:** This is the feature most likely to make a shopkeeper switch from paper to the app. The data is already all there — `Sale.items`, `vatRate`, `total`.
**Effort:** Medium. Use `@react-pdf/renderer` or a server-side route that builds HTML → PDF via Puppeteer. No new data model needed.

### 5. Customer Debt Aging & Overdue Alerts
**What:** Tag debts and unpaid balances as "overdue" once they pass a configurable threshold (e.g., 30/60/90 days). Surface on the dashboard as a priority list. Optionally send a push notification reminder.
**Why it matters:** The core use case is receivables management. Right now the app shows the balance but gives no signal about which customers need to be called today.
**Effort:** Medium. Pure computation on top of existing data: `balance > 0 && oldestUnpaidSale.date < now - threshold`. Push requires a VAPID key + service worker.

### 6. Bulk Import via CSV/Excel
**What:** Let the user upload a CSV of customers (name, phone, opening balance) or products (name, price, stock) to seed the app instead of entering records one by one.
**Why it matters:** The biggest adoption barrier for an existing business is migration. Nobody will manually re-enter 200 customers.
**Effort:** Medium. Client-side CSV parse (`papaparse`), preview/confirm step, map columns to types, batch-write to DataContext.

### 7. Return / Refund Flow
**What:** Allow recording a return against an existing sale: select items and quantities to return, automatically restock the product and credit the customer's balance.
**Why it matters:** Returns are a real business event that currently has no first-class representation. Users work around it by creating negative debts or manual adjustments — both produce wrong running balances.
**Effort:** Medium. New `Return` type linked to `saleId`, stock restore logic (mirrors `deleteSale` but partial), activityFeed entry type.

---

## TIER 3 — Strategic, higher effort

### 8. WhatsApp / SMS Statement Sharing
**What:** Generate a customer statement (list of sales, payments, current balance) as a formatted text message and open WhatsApp with it pre-filled via `wa.me/?text=...`.
**Why it matters:** Turkish SMB owners actively collect via WhatsApp. Sending a statement is a daily workflow. This turns the app into a communication tool, not just a ledger.
**Effort:** Low-medium. Text formatting from existing data, `encodeURIComponent`, `window.open`. No backend needed.

### 9. Analytics Dashboard (per product, per customer, per period)
**What:** A richer reports page: top 5 customers by revenue, best-selling products, monthly revenue trend chart, days-sales-outstanding metric.
**Why it matters:** The current reports page shows three aggregate numbers. Business owners want trends and rankings to make decisions.
**Effort:** Medium. All data is local — it's a pure computation and charting problem (`recharts` or `chart.js`).

### 10. Backup to Google Drive / Export JSON
**What:** Let the user download a full `data.json` backup or export to Google Drive as an additional backup layer beyond GitHub.
**Why it matters:** GitHub is not a user-facing concept. If the user loses access to their GitHub account (or PAT expires), they lose all data with no recovery path. A user-owned backup closes this gap.
**Effort:** Small-medium. Google Drive API with the existing OAuth token, or simple JSON download via `Blob` + `URL.createObjectURL`.

---

## Quick Wins (< 1 day each)

- **Installable PWA manifest** — add `manifest.json` + icons so the app can be installed to home screen. Zero backend work.
- **WhatsApp statement share** — see #8 above, essentially free to build.
- **Customer notes on payments** — `Payment.description` is already in the schema but the UI may not surface it prominently in the feed.
- **Stock low-warning badge** — highlight products with `stock < threshold` (user-configurable) in red on the product list.
- **Undo last action** — keep a single-entry undo buffer in DataContext; surfaces as a toast "Satış silindi. Geri al?" for 5 seconds.
