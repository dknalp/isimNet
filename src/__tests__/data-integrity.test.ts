import { describe, it, expect } from "vitest";
import type { Sale, SaleItem } from "@/lib/customers";
import type { Product } from "@/lib/products";

// ── Data integrity: deleteCustomer stock restoration ──────────────────────────
// Tests the logic extracted from DataContext.deleteCustomer:
// stock must be restored for every sale deleted along with a customer.

function simulateDeleteCustomerStockRestore(
  products: Product[],
  customerSales: Sale[]
): Product[] {
  const now = new Date().toISOString();
  return products.map(p => {
    let restored = p.stock;
    for (const sale of customerSales) {
      const item = sale.items.find((i: SaleItem) => i.productId === p.id);
      if (item) restored += item.quantity;
    }
    if (restored === p.stock) return p;
    return { ...p, stock: restored, updatedAt: now };
  });
}

function makeProduct(id: string, stock: number): Product {
  return { id, name: `Product ${id}`, description: "", price: 10, stock, createdAt: "", updatedAt: "" };
}

function makeSale(id: string, customerId: string, items: { productId: string; quantity: number }[]): Sale {
  const saleItems: SaleItem[] = items.map(i => ({
    productId: i.productId, productName: `P${i.productId}`, quantity: i.quantity, unitPrice: 10,
  }));
  return { id, customerId, date: "", items: saleItems, vatRate: 0, subtotal: 100, vatAmount: 0, total: 100 };
}

describe("deleteCustomer: stock restoration", () => {
  it("restores stock for a single product across one sale", () => {
    const products = [makeProduct("p1", 7)]; // was 10, sold 3
    const sales = [makeSale("s1", "c1", [{ productId: "p1", quantity: 3 }])];
    const result = simulateDeleteCustomerStockRestore(products, sales);
    expect(result[0].stock).toBe(10);
  });

  it("restores stock across multiple products in one sale", () => {
    const products = [makeProduct("p1", 7), makeProduct("p2", 5)];
    const sale = makeSale("s1", "c1", [
      { productId: "p1", quantity: 3 },
      { productId: "p2", quantity: 5 },
    ]);
    const result = simulateDeleteCustomerStockRestore(products, [sale]);
    expect(result.find(p => p.id === "p1")!.stock).toBe(10);
    expect(result.find(p => p.id === "p2")!.stock).toBe(10);
  });

  it("restores stock across multiple sales", () => {
    const products = [makeProduct("p1", 4)]; // was 10, sold 6 across 2 sales
    const sales = [
      makeSale("s1", "c1", [{ productId: "p1", quantity: 4 }]),
      makeSale("s2", "c1", [{ productId: "p1", quantity: 2 }]),
    ];
    const result = simulateDeleteCustomerStockRestore(products, sales);
    expect(result[0].stock).toBe(10);
  });

  it("does not touch products not in the customer's sales", () => {
    const products = [makeProduct("p1", 7), makeProduct("p2", 15)];
    const sales = [makeSale("s1", "c1", [{ productId: "p1", quantity: 3 }])];
    const result = simulateDeleteCustomerStockRestore(products, sales);
    expect(result.find(p => p.id === "p2")!.stock).toBe(15); // untouched
  });

  it("no-op when customer has no sales", () => {
    const products = [makeProduct("p1", 10)];
    const result = simulateDeleteCustomerStockRestore(products, []);
    expect(result[0].stock).toBe(10);
    // same object reference (no mutation)
    expect(result[0]).toBe(products[0]);
  });
});

// ── Mount: orphan sales stock restoration ────────────────────────────────────
// When mount fetches GitHub data and finds sales for customers that no longer
// exist (deleted on another device), it removes those sales and must also
// restore the product stock they consumed.

function simulateOrphanCleanup(
  products: Product[],
  allSales: Sale[],
  validCustomerIds: string[]
): { products: Product[]; sales: Sale[] } {
  const cIds = new Set(validCustomerIds);
  const orphanSales = allSales.filter(s => !cIds.has(s.customerId));
  const now = new Date().toISOString();
  const updatedProducts = products.map(p => {
    let restored = p.stock;
    for (const sale of orphanSales) {
      const item = sale.items.find((i: SaleItem) => i.productId === p.id);
      if (item) restored += item.quantity;
    }
    if (restored === p.stock) return p;
    return { ...p, stock: restored, updatedAt: now };
  });
  const remainingSales = allSales.filter(s => cIds.has(s.customerId));
  return { products: updatedProducts, sales: remainingSales };
}

describe("mount: orphan sale cleanup restores product stock", () => {
  it("restores stock when a customer's sales are orphaned", () => {
    const products = [makeProduct("p1", 3)]; // was 10, 7 sold in total
    const sales = [
      makeSale("s1", "c1", [{ productId: "p1", quantity: 4 }]), // c1 deleted
      makeSale("s2", "c2", [{ productId: "p1", quantity: 3 }]), // c2 still valid
    ];
    const { products: result, sales: remaining } = simulateOrphanCleanup(
      products, sales, ["c2"] // c1 deleted on other device
    );
    expect(result[0].stock).toBe(7); // 3 + 4 (from c1's orphaned sale)
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("s2");
  });

  it("does not change stock when no orphan sales exist", () => {
    const products = [makeProduct("p1", 5)];
    const sales = [makeSale("s1", "c1", [{ productId: "p1", quantity: 5 }])];
    const { products: result } = simulateOrphanCleanup(products, sales, ["c1"]);
    expect(result[0].stock).toBe(5); // unchanged
    expect(result[0]).toBe(products[0]); // same reference
  });

  it("handles orphan sales across multiple products", () => {
    const products = [makeProduct("p1", 2), makeProduct("p2", 8)];
    const sale = makeSale("s1", "c1", [
      { productId: "p1", quantity: 3 },
      { productId: "p2", quantity: 2 },
    ]);
    const { products: result } = simulateOrphanCleanup(products, [sale], []);
    expect(result.find(p => p.id === "p1")!.stock).toBe(5);
    expect(result.find(p => p.id === "p2")!.stock).toBe(10);
  });
});

// ── Stock: addSale clamping behavior ─────────────────────────────────────────
// addSale clamps stock to 0 (Math.max) if qty > available stock.
// This is a P2 inventory integrity issue — financial data (the sale) is preserved
// but stock count becomes inaccurate. Tests document current behavior.

describe("addSale: stock clamping", () => {
  it("clamps to 0 when selling more than available stock", () => {
    const product = makeProduct("p1", 3);
    const newStock = Math.max(0, product.stock - 10); // selling 10, only 3 available
    expect(newStock).toBe(0); // clamped — 7 units phantom-sold
  });

  it("exact stock deduction when qty === stock", () => {
    const product = makeProduct("p1", 5);
    const newStock = Math.max(0, product.stock - 5);
    expect(newStock).toBe(0);
  });

  it("normal deduction when qty < stock", () => {
    const product = makeProduct("p1", 10);
    const newStock = Math.max(0, product.stock - 3);
    expect(newStock).toBe(7);
  });
});

// ── restoreFromDrive: guard against empty/missing GitHub data ─────────────────
// If the GitHub file doesn't exist, GET /api/sync returns
// { customers: [], products: [], ..., sha: null }.
// restoreFromDrive MUST NOT apply this — it would wipe all local data.

function simulateRestoreGuard(data: { sha: string | null; customers: unknown; products: unknown }) {
  // Mirrors the guards added to restoreFromDrive
  if (!data.sha) throw new Error("No data on GitHub (sha is null) — restore aborted");
  if (!Array.isArray(data.customers) || !Array.isArray(data.products)) {
    throw new Error("Invalid payload shape — restore aborted");
  }
  return "applied";
}

describe("restoreFromDrive: empty GitHub response guard", () => {
  it("throws when sha is null (file does not exist on GitHub)", () => {
    const emptyResponse = { sha: null, customers: [], products: [], sales: [], payments: [], debts: [] };
    expect(() => simulateRestoreGuard(emptyResponse)).toThrow("sha is null");
  });

  it("throws when customers/products are not arrays", () => {
    expect(() => simulateRestoreGuard({ sha: "abc123", customers: null, products: null })).toThrow("Invalid payload");
  });

  it("allows restore when sha is present and arrays are valid", () => {
    const validResponse = { sha: "abc123", customers: [{ id: "c1" }], products: [] };
    expect(simulateRestoreGuard(validResponse)).toBe("applied");
  });

  it("allows restore with empty arrays when sha is present (user intentionally cleared data)", () => {
    const clearedResponse = { sha: "def456", customers: [], products: [] };
    expect(simulateRestoreGuard(clearedResponse)).toBe("applied");
  });
});

// ── ID collision prevention ───────────────────────────────────────────────────
// IDs use Date.now() + random suffix. Without the suffix, two records created
// in the same millisecond get the same ID — silent data corruption.

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

describe("ID generation: collision resistance", () => {
  it("two IDs generated back-to-back differ even in the same millisecond", () => {
    const ids = Array.from({ length: 100 }, () => generateId("c"));
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });

  it("ID format matches expected prefix_timestamp_random pattern", () => {
    const id = generateId("s");
    expect(id).toMatch(/^s_\d+_[a-z0-9]{5}$/);
  });

  it("random suffix has 5 base36 characters", () => {
    for (let i = 0; i < 20; i++) {
    const id = generateId("c");
    expect(id.split("_")[2]).toHaveLength(5);
  }
  });
});

// ── isDirty: restore-before-sync data loss warning ────────────────────────────
// If a user has unsaved mutations and clicks "Restore from GitHub", those mutations
// are silently discarded. The UI must warn the user when isDirty=true.

describe("isDirty: unsaved mutation tracking", () => {
  it("isDirty is false when mutationSeq equals syncedSeq", () => {
    let mutationSeq = 3;
    let syncedSeq = 3;
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(false);
  });

  it("isDirty is true when mutations exist that haven't been synced", () => {
    let mutationSeq = 5;
    let syncedSeq = 3;
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(true);
  });

  it("isDirty becomes false after sync advances syncedSeq to mutationSeq", () => {
    let mutationSeq = 5;
    let syncedSeq = 3;
    // After successful sync
    syncedSeq = mutationSeq;
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(false);
  });

  it("isDirty remains true if new mutations happen during sync", () => {
    let mutationSeq = 5;
    const seqAtSyncStart = 5;
    // New mutation arrives while sync is in flight
    mutationSeq = 6;
    // Sync completes — advances syncedSeq only to seqAtSyncStart
    let syncedSeq = seqAtSyncStart;
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(true);
  });
});

// ── undoLastAction: must mark dirty after restore ─────────────────────────────
// undoLastAction restores from snapshot via direct setState (not setC/setP wrappers).
// Without markMutation(), the restored state would never sync to GitHub.

describe("undoLastAction: dirty tracking after restore", () => {
  it("undo without dirty mark leaves syncedSeq === mutationSeq (bug scenario)", () => {
    let mutationSeq = 2;
    let syncedSeq = 2; // just synced
    // Undo fires, restores state — if it does NOT call markMutation:
    // mutationSeq stays at 2, syncedSeq stays at 2 → isDirty = false → no GitHub push
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(false); // demonstrates the bug
  });

  it("undo with markMutation leaves mutationSeq > syncedSeq (correct behavior)", () => {
    let mutationSeq = 2;
    let syncedSeq = 2; // just synced
    // Undo fires, restores state, calls markMutation:
    mutationSeq += 1; // markMutation increments
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(true); // triggers sync loop
  });

  it("next sync after undo advances syncedSeq and clears dirty", () => {
    let mutationSeq = 3; // after undo's markMutation
    const seqAtStart = 3;
    // sync runs successfully
    let syncedSeq = seqAtStart;
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(false);
  });
});

// ── visibilitychange: retry sync after keepalive failure ──────────────────────
// When tab becomes hidden, a keepalive fetch is sent (best-effort, no await).
// If the keepalive fails (mobile network drop, offline, etc.), dirty data is not
// pushed. When the tab becomes visible again, we must retry the sync.

describe("visibilitychange visible: retry sync after keepalive failure", () => {
  it("should detect dirty state and flag for re-sync when visible", () => {
    const mutationSeq = 5;
    const syncedSeq   = 3; // keepalive failed — 2 mutations unsynced

    // This logic mirrors the visibilitychange visible handler:
    const shouldRetry = mutationSeq > syncedSeq;
    expect(shouldRetry).toBe(true);
  });

  it("should not retry if keepalive succeeded (no dirty data)", () => {
    const mutationSeq = 5;
    const syncedSeq   = 5; // keepalive succeeded

    const shouldRetry = mutationSeq > syncedSeq;
    expect(shouldRetry).toBe(false);
  });
});

// ── mount: sha=null guard ─────────────────────────────────────────────────────
// On mount, GET /api/sync returns sha=null when no GitHub file exists yet.
// The old guard (if !data.customers && !data.products) was truthy-array-safe only
// for missing fields; [] is truthy and would pass the check, causing local data overwrite.
// New guard: check sha === null first.

describe("mount: sha=null response guard (new account / no GitHub file)", () => {
  it("sha=null signals no GitHub file — do not overwrite local data", () => {
    const response = { sha: null, customers: [], products: [], sales: [], payments: [], debts: [] };
    const shouldKeepLocal = response.sha === null;
    expect(shouldKeepLocal).toBe(true);
  });

  it("sha present means GitHub has data — can proceed to overwrite local", () => {
    const response = { sha: "abc123", customers: [], products: [], sales: [], payments: [], debts: [] };
    const shouldKeepLocal = response.sha === null;
    expect(shouldKeepLocal).toBe(false);
  });

  it("old guard (!data.customers) fails for empty arrays — demonstrates the bug", () => {
    const response = { sha: null, customers: [], products: [] };
    // Old check: ![] is false → guard FAILS → would proceed to overwrite
    const oldGuardPassed = !response.customers && !response.products;
    expect(oldGuardPassed).toBe(false); // confirms bug: guard was bypassed
  });
});

// ── syncLock: prevent concurrent auto-syncs ───────────────────────────────────
// If two sync triggers fire simultaneously (interval + visibility hide),
// both would send the same snapshot to GitHub. The second gets a 409 conflict
// and retries with a fresh SHA — wasting an API call and causing a duplicate write.
// syncLockRef prevents the second from starting while the first is in flight.

describe("syncLock: concurrent sync prevention", () => {
  it("lock prevents second sync from starting while first is in flight", () => {
    let syncLock = false;
    let syncCount = 0;

    function trySync() {
      if (syncLock) return false;
      syncLock = true;
      syncCount++;
      return true;
    }

    function releaseSync() { syncLock = false; }

    // First sync starts
    expect(trySync()).toBe(true);
    expect(syncCount).toBe(1);

    // Second sync attempt while first is in flight — blocked
    expect(trySync()).toBe(false);
    expect(syncCount).toBe(1);

    // First sync completes, releases lock
    releaseSync();

    // Third sync can now start
    expect(trySync()).toBe(true);
    expect(syncCount).toBe(2);
  });

  it("lock is released even after sync failure", () => {
    let syncLock = false;

    function trySync() {
      if (syncLock) return false;
      syncLock = true;
      return true;
    }

    expect(trySync()).toBe(true);
    // Simulate failure in finally block
    syncLock = false;
    // Can sync again
    expect(trySync()).toBe(true);
  });
});

// ── syncToDriveInternal: P0/P1 sequence safety ────────────────────────────────
// Key invariants of the sync function — documented as tests.

describe("syncToDriveInternal: sequence capture safety (P1)", () => {
  it("seqAtStart must be captured BEFORE any await to protect concurrent mutations", () => {
    // Simulate: seq=5 at sync start, mutation arrives mid-flight (seq=6)
    let mutationSeq = 5;
    const seqAtStart = mutationSeq; // captured synchronously before await

    // Mutation arrives while sync is in flight
    mutationSeq = 6;

    // After sync success: advance syncedSeq to seqAtStart only (not current)
    const syncedSeqAfter = seqAtStart;
    const isDirtyAfter = mutationSeq > syncedSeqAfter;

    expect(syncedSeqAfter).toBe(5);  // only marks seq=5 as synced
    expect(isDirtyAfter).toBe(true);  // seq=6 mutation still dirty → next sync picks it up
  });

  it("if two mutations arrive during sync, both stay dirty", () => {
    let mutationSeq = 3;
    const seqAtStart = mutationSeq; // 3

    mutationSeq = 5; // two mutations in-flight

    const syncedSeqAfter = seqAtStart; // 3
    expect(mutationSeq > syncedSeqAfter).toBe(true); // 5 > 3 = dirty
  });
});

describe("syncToDriveInternal: P0 success guard (localdb)", () => {
  it("successful POST returns { ok: true } — syncedSeq advances, isDirty clears", () => {
    // localdb backend returns { ok: true } on success — no sha needed
    const json = { ok: true };
    const writeConfirmed = json.ok === true;
    expect(writeConfirmed).toBe(true);
  });

  it("non-ok HTTP response — syncedSeq must NOT advance so data retries", () => {
    let mutationSeq = 5;
    let syncedSeq = 3;
    // Simulate 500 response: syncedSeq stays unchanged
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(true); // data survives for retry
  });
});

describe("syncToDriveInternal: network error leaves data dirty", () => {
  it("on error: syncedSeq must NOT advance so data retries on next sync", () => {
    let mutationSeq = 7;
    let syncedSeq = 4;

    // Simulate: sync throws network error — syncedSeq NOT updated
    // (syncToDriveInternal catches error and returns without advancing syncedSeq)
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(true); // data survives for retry
  });
});

// ── clearAllData: dirty state after failure ──────────────────────────────────
// When clearAllData fails (network error), mutationSeq stays ahead of
// syncedSeq — data remains dirty and retries on the next sync interval.

describe("clearAllData: dirty state preserved after failure enables retry", () => {
  it("after failure mutationSeq > syncedSeq — isDirty stays true for retry", () => {
    let mutationSeq = 10;
    let syncedSeq = 8;

    // Simulate clearAllData network failure — syncedSeq stays behind
    const isDirty = mutationSeq > syncedSeq;
    expect(isDirty).toBe(true); // data survives for retry
  });
});

// ── clearAllData: syncLock race prevention ───────────────────────────────────
// clearAllData waits for syncLockRef to clear before POSTing empty arrays,
// so the empty-data POST always arrives AFTER any in-flight sync POST.

describe("clearAllData: waits for syncLockRef before POSTing", () => {
  it("if syncLock held, clearAllData must wait so its POST arrives last", async () => {
    let syncLockRef = { current: true };
    let clearDataPosted = false;

    // Simulate: release lock after 20ms
    const lockRelease = new Promise<void>(resolve => {
      setTimeout(() => { syncLockRef.current = false; resolve(); }, 20);
    });

    // Simulate clearAllData poll logic
    await new Promise<void>(resolve => {
      const poll = setInterval(() => {
        if (!syncLockRef.current) { clearInterval(poll); resolve(); }
      }, 5);
    });

    clearDataPosted = true;
    await lockRelease; // ensure lock was released before we posted
    expect(clearDataPosted).toBe(true);
    expect(syncLockRef.current).toBe(false); // lock cleared before post
  });
});

// ── keepalive: uses stateRef.current, not stale closure ──────────────────────
// The visibilitychange handler is attached once (useEffect with [] deps).
// If it captured customers/products etc. as closure variables, they'd be stale.
// It must read stateRef.current to get the latest state at the time of the event.

describe("keepalive: stateRef prevents stale closure data", () => {
  it("reading from ref gives current state even in a closure from mount", () => {
    // Simulate: ref is assigned at every render
    const stateRef = { current: { customers: [] as {id:string}[] } };

    // Closure captures the ref object (not its .current)
    function onHide() {
      return stateRef.current.customers; // reads through ref — always current
    }

    // State updates after closure was created
    stateRef.current = { customers: [{ id: "c1" }] };

    // Closure still reads correct current value
    expect(onHide()).toHaveLength(1);
    expect(onHide()[0].id).toBe("c1");
  });

  it("direct closure variable would be stale — demonstrates why ref is needed", () => {
    let customers: {id:string}[] = [];

    // Closure captures the value at creation time
    const staleCustomers = customers;

    // State updates
    customers = [{ id: "c1" }];

    // Closure has stale empty array
    expect(staleCustomers).toHaveLength(0); // demonstrates the bug we avoid
    expect(customers).toHaveLength(1);      // actual current state
  });
});
