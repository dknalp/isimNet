"use client";

import {
  createContext, useCallback, useContext,
  useEffect, useMemo, useRef, useState,
} from "react";
import { useSession } from "next-auth/react";
import {
  Customer, NewCustomerFormData, Sale, Payment, Debt,
  ActivityItem, buildActivityFeed,
} from "@/lib/customers";
import { Product, NewProductFormData } from "@/lib/products";

// ── LocalStorage keys (namespaced per user to prevent cross-user data leakage) ──
function makeLS(uid: string) {
  const p = `isimnet_${uid}`;
  return {
    customers:    `${p}_customers`,
    products:     `${p}_products`,
    sales:        `${p}_sales`,
    payments:     `${p}_payments`,
    debts:        `${p}_debts`,
    lastSync:     `${p}_last_sync`,
    lastMutation: `${p}_last_mutation`,
  };
}
// Fallback for anonymous/pre-auth reads (returns keys that will have no data)
const LS_ANON = makeLS("anon");

// ── Structured logger ─────────────────────────────────────────────────────────
const LOG = {
  info:  (msg: string, data?: unknown) =>
    console.info(`[DataContext] ${msg}`, ...(data !== undefined ? [data] : [])),
  warn:  (msg: string, data?: unknown) =>
    console.warn(`[DataContext] ⚠️ ${msg}`, ...(data !== undefined ? [data] : [])),
  error: (msg: string, data?: unknown) =>
    console.error(`[DataContext] ❌ ${msg}`, ...(data !== undefined ? [data] : [])),
  sync:  (msg: string, data?: unknown) =>
    console.info(`[DataContext:sync] 🔄 ${msg}`, ...(data !== undefined ? [data] : [])),
};

// P0-FIX: lsRead validates that parsed value is an array; parse errors are logged
function lsRead<T>(key: string): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      LOG.warn(`lsRead: key="${key}" contained non-array, ignoring`, typeof parsed);
      return null;
    }
    return parsed as T[];
  } catch (e) {
    LOG.error(`lsRead: JSON parse failed for key="${key}"`, e);
    return null;
  }
}

// P0-FIX: lsWrite returns false on quota/write error instead of silently swallowing it
function lsWrite<T>(key: string, data: T[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    LOG.error(`lsWrite: write failed for key="${key}" (${(e as Error)?.name})`, e);
    return false;
  }
}

// ── Context type ──────────────────────────────────────────────────────────────
interface DataContextValue {
  customers:  Customer[];
  products:   Product[];
  sales:      Sale[];
  payments:   Payment[];
  isLoading:  boolean;
  isSyncing:    boolean;
  lastSyncTime: Date | null;
  syncError:    string | null;
  isDirty:      boolean;

  addCustomer:    (data: NewCustomerFormData) => void;
  updateCustomer: (id: string, data: Partial<NewCustomerFormData>) => void;
  deleteCustomer: (id: string) => void;

  addProduct:    (data: NewProductFormData) => void;
  updateProduct: (id: string, data: Partial<NewProductFormData>) => void;
  deleteProduct: (id: string) => void;

  addSale:    (sale: Omit<Sale, "id">) => void;
  updateSale: (id: string, data: Omit<Sale, "id" | "customerId">) => void;
  deleteSale: (id: string) => void;

  addPayment:    (payment: Omit<Payment, "id">) => void;
  updatePayment: (id: string, data: Pick<Payment, "amount" | "description">) => void;
  deletePayment: (id: string) => void;

  debts:      Debt[];
  addDebt:    (debt: Omit<Debt, "id">) => void;
  updateDebt: (id: string, data: Pick<Debt, "amount" | "description">) => void;
  deleteDebt: (id: string) => void;

  getCustomerTotals: (customerId: string) => {
    totalRevenue: number; totalCollected: number; currentDebt: number; myDebt: number;
  };
  getCustomerFeed: (customerId: string) => ActivityItem[];

  syncToDrive:      () => Promise<void>;
  restoreFromDrive: () => Promise<void>;
  clearAllData:     () => Promise<void>;

  backupToGitHub:    () => Promise<void>;
  restoreFromGitHub: () => Promise<void>;

  canUndo:        boolean;
  undoLastAction: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────
export function DataProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  // LS keys are user-scoped — only safe to use once session.userId is known
  const LS = session?.userId ? makeLS(session.userId) : LS_ANON;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products,  setProducts]  = useState<Product[]>([]);
  const [sales,     setSales]     = useState<Sale[]>([]);
  const [payments,  setPayments]  = useState<Payment[]>([]);
  const [debts,     setDebts]     = useState<Debt[]>([]);

  const [isLoading,    setIsLoading]    = useState(true);
  const [isSyncing,    setIsSyncing]    = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncError,    setSyncError]    = useState<string | null>(null);
  const [isDirty,      setIsDirty]      = useState(false);

  // ── Undo buffer ─────────────────────────────────────────────────────────
  type UndoSnapshot = {
    customers: Customer[];
    products:  Product[];
    sales:     Sale[];
    payments:  Payment[];
    debts:     Debt[];
  };
  const lastUndoRef  = useRef<UndoSnapshot | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const stateRef = useRef({ customers, products, sales, payments, debts });
  stateRef.current = { customers, products, sales, payments, debts };

  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Always-current LS — assigned at render so closures can call lsRef.current for the right user's keys
  const lsRef = useRef(LS);
  lsRef.current = LS;

  const syncLockRef   = useRef(false);

  // P1-FIX: dirty tracking — seq snapshot captured BEFORE async, so concurrent mutations aren't lost
  const mutationSeq = useRef(0);
  const syncedSeq   = useRef(0);

  // P1-FIX: track timestamp of last mutation to detect offline edits on remount
  // Initialized to 0; the real persisted value is loaded in mount useEffect once session.userId is known
  const lastMutationAt = useRef<number>(0);

  // ── Mutation helpers: write localStorage + increment dirty counter ─────────
  function markMutation() {
    mutationSeq.current += 1;
    lastMutationAt.current = Date.now();
    try { localStorage.setItem(lsRef.current.lastMutation, String(lastMutationAt.current)); } catch { /* */ }
    setIsDirty(true);
  }

  const setC = useCallback((fn: (prev: Customer[]) => Customer[]) => {
    markMutation();
    setCustomers(prev => {
      const next = fn(prev);
      if (!lsWrite(lsRef.current.customers, next)) LOG.warn("setC: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setP = useCallback((fn: (prev: Product[]) => Product[]) => {
    markMutation();
    setProducts(prev => {
      const next = fn(prev);
      if (!lsWrite(lsRef.current.products, next)) LOG.warn("setP: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setS = useCallback((fn: (prev: Sale[]) => Sale[]) => {
    markMutation();
    setSales(prev => {
      const next = fn(prev);
      if (!lsWrite(lsRef.current.sales, next)) LOG.warn("setS: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPay = useCallback((fn: (prev: Payment[]) => Payment[]) => {
    markMutation();
    setPayments(prev => {
      const next = fn(prev);
      if (!lsWrite(lsRef.current.payments, next)) LOG.warn("setPay: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setD = useCallback((fn: (prev: Debt[]) => Debt[]) => {
    markMutation();
    setDebts(prev => {
      const next = fn(prev);
      if (!lsWrite(lsRef.current.debts, next)) LOG.warn("setD: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Core sync (internal) ──────────────────────────────────────────────────
  // P1-FIX: seq snapshot taken BEFORE await so concurrent mutations remain dirty
  const syncToDriveInternal = useCallback(async (): Promise<void> => {
    const sess = sessionRef.current;
    if (!sess?.userId) {
      LOG.sync("syncToDriveInternal: no session, skip");
      return;
    }
    if (mutationSeq.current === syncedSeq.current) {
      LOG.sync("syncToDriveInternal: no dirty data, skip");
      return;
    }
    if (syncLockRef.current) {
      LOG.sync("syncToDriveInternal: sync already in flight, skip");
      return;
    }
    syncLockRef.current = true;

    // Capture seq BEFORE await — mutations that arrive mid-flight stay dirty
    const seqAtStart = mutationSeq.current;
    const { customers, products, sales, payments, debts } = stateRef.current;
    LOG.sync("syncToDriveInternal: start", {
      seqAtStart,
      counts: { customers: customers.length, products: products.length, sales: sales.length, payments: payments.length, debts: debts.length },
    });

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers, products, sales, payments, debts }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "(unreadable)");
        LOG.error(`syncToDriveInternal: HTTP ${res.status}`, errText);
        setSyncError(`Sync başarısız (HTTP ${res.status}). Verileriniz güvende — sonraki denemede tekrar gönderilecek.`);
        // P0-FIX: do NOT update sha or syncedSeq — data stays dirty
        return;
      }

      const json = await res.json();

      // P1-FIX: only advance syncedSeq to seqAtStart, not current mutationSeq
      if (syncedSeq.current < seqAtStart) {
        syncedSeq.current = seqAtStart;
      }
      // Clear dirty flag only if no new mutations arrived during this sync
      setIsDirty(mutationSeq.current > seqAtStart);

      const now = new Date();
      setLastSyncTime(now);
      try { localStorage.setItem(lsRef.current.lastSync, now.toISOString()); } catch { /* */ }
      setSyncError(null);

      LOG.sync("syncToDriveInternal: success", {
        seqSynced: seqAtStart,
        currentSeq: mutationSeq.current,
        pendingDirty: mutationSeq.current > seqAtStart,
      });
    } catch (e) {
      LOG.error("syncToDriveInternal: network error", e);
      setSyncError("Ağ hatası — verileriniz cihazda güvende, bağlantı gelince otomatik sync denenecek.");
      // P0-FIX: do NOT update sha or syncedSeq
    } finally {
      syncLockRef.current = false;
    }
  }, []);

  // ── Mount: fetch from GitHub ──────────────────────────────────────────────
  useEffect(() => {
    if (status !== "authenticated" || !session?.userId) {
      if (status === "unauthenticated") {
        // Clear all known LS data on sign-out so the next user starts clean
        try {
          Object.keys(localStorage).filter(k => k.startsWith("isimnet_")).forEach(k => localStorage.removeItem(k));
        } catch { /* */ }
        setCustomers([]); setProducts([]); setSales([]); setPayments([]); setDebts([]);
        setIsLoading(false);
        LOG.info("mount: unauthenticated — cleared localStorage");
      }
      return;
    }

    // Fast-path: show user's own cached data immediately (user-scoped keys prevent cross-user leakage)
    const localCustomers = lsRead<Customer>(LS.customers);
    const localProducts  = lsRead<Product>(LS.products);
    if (localCustomers) { setCustomers(localCustomers); }
    if (localProducts)  { setProducts(localProducts); }
    const localSales    = lsRead<Sale>(LS.sales);
    const localPayments = lsRead<Payment>(LS.payments);
    const localDebts    = lsRead<Debt>(LS.debts);
    if (localSales)    setSales(localSales);
    if (localPayments) setPayments(localPayments);
    if (localDebts)    setDebts(localDebts);

    // Restore user-scoped timestamps (these use LS with correct userId, unlike the top-level IIFE)
    try {
      const rawSync = localStorage.getItem(lsRef.current.lastSync);
      if (rawSync) setLastSyncTime(new Date(rawSync));
      const rawMut = localStorage.getItem(lsRef.current.lastMutation);
      if (rawMut) lastMutationAt.current = parseInt(rawMut, 10);
    } catch { /* */ }

    const hasLocal = localCustomers !== null || localProducts !== null;
    if (!hasLocal) setIsLoading(true);

    LOG.sync("mount: fetching from server");

    fetch("/api/sync")
      .then(async res => {
        if (!res.ok) {
          LOG.error(`mount: GET /api/sync HTTP ${res.status} — keeping local data`);
          setIsLoading(false);
          return;
        }

        const data = await res.json();
        LOG.sync("mount: received local data", {
          counts: { customers: data.customers?.length, products: data.products?.length, sales: data.sales?.length, payments: data.payments?.length, debts: data.debts?.length },
        });

        // P1-FIX: if local data was mutated after the last sync, protect it
        const lastSyncMs = (() => {
          try {
            const raw = localStorage.getItem(lsRef.current.lastSync);
            return raw ? new Date(raw).getTime() : 0;
          } catch { return 0; }
        })();

        if (lastMutationAt.current > lastSyncMs) {
          LOG.warn("mount: local data is NEWER than last sync — pushing local to GitHub instead of overwriting", {
            lastMutationAt: new Date(lastMutationAt.current).toISOString(),
            lastSyncAt: lastSyncMs ? new Date(lastSyncMs).toISOString() : "never",
          });
          setIsLoading(false);
          void syncToDriveInternal();
          return;
        }

        // Local DB is authoritative — apply all arrays atomically to prevent mixed stale/server state
        const mounted = {
          customers: Array.isArray(data.customers) ? data.customers as Customer[] : [],
          products:  Array.isArray(data.products)  ? data.products  as Product[]  : [],
          sales:     Array.isArray(data.sales)     ? data.sales     as Sale[]     : [],
          payments:  Array.isArray(data.payments)  ? data.payments  as Payment[]  : [],
          debts:     Array.isArray(data.debts)     ? data.debts     as Debt[]     : [],
        };
        setCustomers(mounted.customers); lsWrite(lsRef.current.customers, mounted.customers);
        setProducts(mounted.products);   lsWrite(lsRef.current.products,  mounted.products);
        setSales(mounted.sales);         lsWrite(lsRef.current.sales,     mounted.sales);
        setPayments(mounted.payments);   lsWrite(lsRef.current.payments,  mounted.payments);
        setDebts(mounted.debts);         lsWrite(lsRef.current.debts,     mounted.debts);

        // Clean orphan records (customer deleted on another device)
        // Also restore product stock for any sales that get orphaned
        const cIds = new Set(mounted.customers.map((c: Customer) => c.id));
        const orphanSales = mounted.sales.filter(s => !cIds.has(s.customerId));
        const hadOrphans = orphanSales.length > 0;
        const now = new Date().toISOString();
        // Compute corrected products synchronously so we can write to LS immediately
        const cleanProducts = hadOrphans
          ? mounted.products.map((p: Product) => {
              let restored = p.stock;
              for (const sale of orphanSales) {
                const item = sale.items.find((i: { productId: string }) => i.productId === p.id);
                if (item) restored += (item as { quantity: number }).quantity;
              }
              if (restored === p.stock) return p;
              LOG.info("mount: orphan stock restored", { productId: p.id, from: p.stock, to: restored });
              return { ...p, stock: restored, updatedAt: now };
            })
          : mounted.products;

        if (hadOrphans) {
          LOG.warn("mount: cleaning orphan sales — restoring stock", { count: orphanSales.length });
          setProducts(cleanProducts);
        }
        const cleanSales    = mounted.sales.filter((s: Sale)    => cIds.has(s.customerId));
        const cleanPayments = mounted.payments.filter((p: Payment)  => cIds.has(p.customerId));
        const cleanDebts    = mounted.debts.filter((d: Debt)    => cIds.has(d.customerId));
        setSales(cleanSales);
        setPayments(cleanPayments);
        setDebts(cleanDebts);

        // Write corrected data to LS immediately so a crash before syncToDriveInternal
        // completes doesn't revert the orphan cleanup (all 5 arrays including products)
        if (hadOrphans) {
          lsWrite(lsRef.current.products, cleanProducts);
          lsWrite(lsRef.current.sales,    cleanSales);
          lsWrite(lsRef.current.payments, cleanPayments);
          lsWrite(lsRef.current.debts,    cleanDebts);
        }

        syncedSeq.current = mutationSeq.current;
        LOG.sync("mount: applied local data");
        setIsLoading(false);

        // If orphan cleanup modified stock or removed records, push the corrected
        // data back to server so it doesn't revert on next device load.
        if (hadOrphans) {
          LOG.warn("mount: orphan cleanup changed data — pushing corrected state to server");
          mutationSeq.current += 1;
          void syncToDriveInternal();
        }
      })
      .catch(e => {
        LOG.error("mount: fetch error — using local data", e);
        setIsLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.userId]);

  // ── visibilitychange: sync on hide, refresh SHA on show ──────────────────
  useEffect(() => {
    function onVisibilityChange() {
      if (!sessionRef.current?.userId) return;

      if (document.visibilityState === "hidden") {
        if (mutationSeq.current === syncedSeq.current) {
          LOG.sync("visibilitychange hidden: no dirty data, skip");
          return;
        }
        const { customers, products, sales, payments, debts } = stateRef.current;
        LOG.sync("visibilitychange hidden: sending keepalive sync", {
          mutationSeq: mutationSeq.current, syncedSeq: syncedSeq.current,
        });
        // P0-FIX: keepalive:true ensures browser completes the request on tab hide/close
        fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customers, products, sales, payments, debts }),
          keepalive: true,
        }).catch(() => { /* best-effort — can't await on hidden */ });
      }

      if (document.visibilityState === "visible") {
        // Re-push if dirty — the keepalive may have failed (mobile network drop etc.)
        LOG.sync("visibilitychange visible: checking dirty state after keepalive");
        fetch("/api/sync")
          .then(r => r.ok ? r.json() : null)
          .then(json => {
            // Retry push if keepalive failed
            if (json && mutationSeq.current > syncedSeq.current) {
              LOG.warn("visibilitychange visible: dirty data detected — retrying sync (keepalive may have failed)");
              void syncToDriveInternal();
            }
          })
          .catch(() => {});
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // ── Periodic sync every 3 minutes ────────────────────────────────────────
  useEffect(() => {
    if (status !== "authenticated") return;
    const id = setInterval(() => {
      if (mutationSeq.current === syncedSeq.current) {
        LOG.sync("interval: no dirty data, skip");
        return;
      }
      LOG.sync("interval: dirty data, triggering sync", {
        mutationSeq: mutationSeq.current, syncedSeq: syncedSeq.current,
      });
      void syncToDriveInternal();
    }, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [status, syncToDriveInternal]);

  // ── CRUD: customers ───────────────────────────────────────────────────────
  const addCustomer = useCallback((data: NewCustomerFormData) => {
    const now = new Date().toISOString();
    const newC: Customer = { ...data, id: `c_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, createdAt: now, updatedAt: now };
    LOG.info("addCustomer", { id: newC.id, name: newC.name });
    setC(prev => [newC, ...prev]);
  }, [setC]);

  const updateCustomer = useCallback((id: string, data: Partial<NewCustomerFormData>) => {
    LOG.info("updateCustomer", { id });
    setC(prev => prev.map(c => c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c));
  }, [setC]);

  const captureUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    lastUndoRef.current = {
      customers, products, sales, payments, debts,
    };
    setCanUndo(true);
    undoTimerRef.current = setTimeout(() => {
      lastUndoRef.current = null;
      setCanUndo(false);
    }, 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, products, sales, payments, debts]);

  const undoLastAction = useCallback(() => {
    const snap = lastUndoRef.current;
    if (!snap) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    lastUndoRef.current = null;
    setCanUndo(false);
    LOG.warn("undoLastAction: restoring snapshot", {
      customers: snap.customers.length, products: snap.products.length,
      sales: snap.sales.length, payments: snap.payments.length, debts: snap.debts.length,
    });
    setCustomers(snap.customers);
    setProducts(snap.products);
    setSales(snap.sales);
    setPayments(snap.payments);
    setDebts(snap.debts);
    lsWrite(lsRef.current.customers, snap.customers);
    lsWrite(lsRef.current.products,  snap.products);
    lsWrite(lsRef.current.sales,     snap.sales);
    lsWrite(lsRef.current.payments,  snap.payments);
    lsWrite(lsRef.current.debts,     snap.debts);
    markMutation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteCustomer = useCallback((id: string) => {
    captureUndo();
    LOG.info("deleteCustomer", { id });
    // Restore product stock for every sale belonging to this customer before deleting
    const now = new Date().toISOString();
    const customerSales = stateRef.current.sales.filter(s => s.customerId === id);
    if (customerSales.length > 0) {
      LOG.info("deleteCustomer: restoring stock for customer sales", { customerId: id, salesCount: customerSales.length });
      setP(prev => prev.map(p => {
        let restored = p.stock;
        for (const sale of customerSales) {
          const item = sale.items.find(i => i.productId === p.id);
          if (item) restored += item.quantity;
        }
        if (restored === p.stock) return p;
        LOG.info("deleteCustomer: stock restored", { productId: p.id, from: p.stock, to: restored });
        return { ...p, stock: restored, updatedAt: now };
      }));
    }
    setC(prev => prev.filter(c => c.id !== id));
    setS(prev => prev.filter(s => s.customerId !== id));
    setPay(prev => prev.filter(p => p.customerId !== id));
    setD(prev => prev.filter(d => d.customerId !== id));
  }, [setC, setS, setPay, setD, setP]);

  // ── CRUD: products ────────────────────────────────────────────────────────
  const addProduct = useCallback((data: NewProductFormData) => {
    const now = new Date().toISOString();
    const newP: Product = { ...data, id: `p_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, createdAt: now, updatedAt: now };
    LOG.info("addProduct", { id: newP.id, name: newP.name });
    setP(prev => [newP, ...prev]);
  }, [setP]);

  const updateProduct = useCallback((id: string, data: Partial<NewProductFormData>) => {
    LOG.info("updateProduct", { id });
    setP(prev => prev.map(p => p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p));
  }, [setP]);

  const deleteProduct = useCallback((id: string) => {
    captureUndo();
    LOG.info("deleteProduct", { id });
    setP(prev => prev.filter(p => p.id !== id));
  }, [setP]);

  // ── CRUD: sales (with stock adjustment) ──────────────────────────────────
  const addSale = useCallback((data: Omit<Sale, "id">) => {
    const newS: Sale = { ...data, id: `s_${Date.now()}_${Math.random().toString(36).slice(2,7)}` };
    LOG.info("addSale", { id: newS.id, customerId: newS.customerId, total: newS.total });
    setS(prev => [newS, ...prev]);
    const now = new Date().toISOString();
    setP(prev => prev.map(p => {
      const item = data.items.find(i => i.productId === p.id);
      if (!item) return p;
      const newStock = Math.max(0, p.stock - item.quantity);
      LOG.info("addSale: stock adjusted", { productId: p.id, from: p.stock, to: newStock });
      return { ...p, stock: newStock, updatedAt: now };
    }));
  }, [setS, setP]);

  const updateSale = useCallback((id: string, data: Omit<Sale, "id" | "customerId">) => {
    const oldSale = stateRef.current.sales.find(s => s.id === id);
    if (!oldSale) return;
    LOG.info("updateSale", { id, total: data.total });
    const now = new Date().toISOString();
    setP(prev => prev.map(p => {
      const oldItem = oldSale.items.find(i => i.productId === p.id);
      const newItem = data.items.find(i => i.productId === p.id);
      const restored = oldItem ? p.stock + oldItem.quantity : p.stock;
      const applied  = newItem ? Math.max(0, restored - newItem.quantity) : restored;
      if (restored === p.stock && applied === p.stock) return p;
      return { ...p, stock: applied, updatedAt: now };
    }));
    setS(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  }, [setS, setP]);

  const deleteSale = useCallback((id: string) => {
    captureUndo();
    const sale = stateRef.current.sales.find(s => s.id === id);
    if (sale) {
      LOG.info("deleteSale: restoring stock", { id });
      const now = new Date().toISOString();
      setP(prev => prev.map(p => {
        const item = sale.items.find(i => i.productId === p.id);
        if (!item) return p;
        return { ...p, stock: p.stock + item.quantity, updatedAt: now };
      }));
    }
    setS(prev => prev.filter(s => s.id !== id));
  }, [setS, setP]);

  // ── CRUD: payments ────────────────────────────────────────────────────────
  const addPayment = useCallback((data: Omit<Payment, "id">) => {
    const newP: Payment = { ...data, id: `pay_${Date.now()}_${Math.random().toString(36).slice(2,7)}` };
    LOG.info("addPayment", { id: newP.id, customerId: newP.customerId, amount: newP.amount });
    setPay(prev => [newP, ...prev]);
  }, [setPay]);

  const updatePayment = useCallback((id: string, data: Pick<Payment, "amount" | "description">) => {
    LOG.info("updatePayment", { id });
    setPay(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
  }, [setPay]);

  const deletePayment = useCallback((id: string) => {
    captureUndo();
    LOG.info("deletePayment", { id });
    setPay(prev => prev.filter(p => p.id !== id));
  }, [setPay]);

  // ── CRUD: debts ───────────────────────────────────────────────────────────
  const addDebt = useCallback((data: Omit<Debt, "id">) => {
    const newD: Debt = { ...data, id: `d_${Date.now()}_${Math.random().toString(36).slice(2,7)}` };
    LOG.info("addDebt", { id: newD.id, customerId: newD.customerId, amount: newD.amount });
    setD(prev => [newD, ...prev]);
  }, [setD]);

  const updateDebt = useCallback((id: string, data: Pick<Debt, "amount" | "description">) => {
    LOG.info("updateDebt", { id });
    setD(prev => prev.map(d => d.id === id ? { ...d, ...data } : d));
  }, [setD]);

  const deleteDebt = useCallback((id: string) => {
    captureUndo();
    LOG.info("deleteDebt", { id });
    setD(prev => prev.filter(d => d.id !== id));
  }, [setD]);

  // ── Manual sync ───────────────────────────────────────────────────────────
  const syncToDrive = useCallback(async () => {
    if (isSyncing) { LOG.sync("syncToDrive: already syncing"); return; }
    LOG.sync("syncToDrive: manual trigger");
    setIsSyncing(true);
    setSyncError(null);
    try {
      await syncToDriveInternal();
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, syncToDriveInternal]);

  const restoreFromDrive = useCallback(async () => {
    LOG.sync("restoreFromDrive: start");
    setIsLoading(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/sync");
      if (!res.ok) {
        LOG.error(`restoreFromDrive: HTTP ${res.status}`);
        setSyncError(`Geri yükleme başarısız (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      LOG.sync("restoreFromDrive: received", { counts: { customers: data.customers?.length, products: data.products?.length } });

      // Apply all arrays atomically — default missing keys to [] to prevent mixed stale/server state
      const restored = {
        customers: Array.isArray(data.customers) ? data.customers : [],
        products:  Array.isArray(data.products)  ? data.products  : [],
        sales:     Array.isArray(data.sales)     ? data.sales     : [],
        payments:  Array.isArray(data.payments)  ? data.payments  : [],
        debts:     Array.isArray(data.debts)     ? data.debts     : [],
      };
      setCustomers(restored.customers); lsWrite(lsRef.current.customers, restored.customers);
      setProducts(restored.products);   lsWrite(lsRef.current.products,  restored.products);
      setSales(restored.sales);         lsWrite(lsRef.current.sales,     restored.sales);
      setPayments(restored.payments);   lsWrite(lsRef.current.payments,  restored.payments);
      setDebts(restored.debts);         lsWrite(lsRef.current.debts,     restored.debts);

      syncedSeq.current = mutationSeq.current;
      setIsDirty(false);
      const now = new Date();
      setLastSyncTime(now);
      try { localStorage.setItem(lsRef.current.lastSync, now.toISOString()); } catch { /* */ }
      LOG.sync("restoreFromDrive: complete");
    } catch (e) {
      LOG.error("restoreFromDrive: error", e);
      setSyncError("Geri yükleme sırasında hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Clear all data ────────────────────────────────────────────────────────
  const clearAllData = useCallback(async () => {
    // Wait for any in-flight sync to complete so clearAllData POST arrives last on the server
    if (syncLockRef.current) {
      LOG.warn("clearAllData: waiting for in-flight sync to complete before wiping");
      await new Promise<void>(resolve => {
        const poll = setInterval(() => {
          if (!syncLockRef.current) { clearInterval(poll); resolve(); }
        }, 50);
      });
    }
    LOG.warn("clearAllData: wiping all local and remote data");
    setCustomers([]); lsWrite(lsRef.current.customers, []);
    setProducts([]);  lsWrite(lsRef.current.products,  []);
    setSales([]);     lsWrite(lsRef.current.sales,     []);
    setPayments([]);  lsWrite(lsRef.current.payments,  []);
    setDebts([]);     lsWrite(lsRef.current.debts,     []);
    // Use markMutation so lastMutationAt timestamp stays consistent
    markMutation();
    if (sessionRef.current?.userId) {
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customers: [], products: [], sales: [], payments: [], debts: [] }),
        });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.ok) {
            syncedSeq.current = mutationSeq.current;
            setIsDirty(false);
            const now = new Date();
            setLastSyncTime(now);
            try { localStorage.setItem(lsRef.current.lastSync, now.toISOString()); } catch { /* */ }
          } else {
            // Write succeeded but response not ok — keep data dirty so next auto-sync retries
            LOG.error("clearAllData: remote wipe response not ok — will retry on next sync");
            setSyncError("Veri silme doğrulanamadı. Bir sonraki senkronizasyonda tekrar denenecek.");
          }
          LOG.warn("clearAllData: remote data wiped");
        } else {
          // Remote wipe failed — data is locally empty but remotely still has old data
          LOG.error(`clearAllData: remote wipe failed HTTP ${res.status}`);
          setSyncError(`Uzak veri silinemedi (HTTP ${res.status}). Sonraki senkronizasyonda tekrar denenecek.`);
        }
      } catch (e) {
        LOG.error("clearAllData: remote wipe error", e);
        setSyncError("Ağ hatası — uzak veri silinemedi. Sonraki senkronizasyonda tekrar denenecek.");
      }
    }
  }, [markMutation]);

  // ── Computed helpers ──────────────────────────────────────────────────────
  const getCustomerTotals = useCallback((customerId: string) => {
    const totalRevenue   = sales.filter(s => s.customerId === customerId).reduce((sum, s) => sum + s.total, 0);
    const totalCollected = payments.filter(p => p.customerId === customerId).reduce((sum, p) => sum + p.amount, 0);
    const myDebt         = debts.filter(d => d.customerId === customerId).reduce((sum, d) => sum + d.amount, 0);
    return { totalRevenue, totalCollected, currentDebt: totalRevenue - totalCollected, myDebt };
  }, [sales, payments, debts]);

  const getCustomerFeed = useCallback((customerId: string): ActivityItem[] => {
    return buildActivityFeed(
      sales.filter(s => s.customerId === customerId),
      payments.filter(p => p.customerId === customerId),
      debts.filter(d => d.customerId === customerId),
    );
  }, [sales, payments, debts]);


  const backupToGitHub = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      const { customers, products, sales, payments, debts } = stateRef.current;
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers, products, sales, payments, debts }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setSyncError(`GitHub yedekleme başarısız (HTTP ${res.status}): ${txt}`);
        LOG.error("backupToGitHub: failed", { status: res.status });
      } else {
        const now = new Date();
        setLastSyncTime(now);
        try { localStorage.setItem(lsRef.current.lastSync, now.toISOString()); } catch { /* */ }
        setSyncError(null);
        LOG.sync("backupToGitHub: success");
      }
    } catch (e) {
      setSyncError("GitHub bağlantı hatası.");
      LOG.error("backupToGitHub: error", e);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  const restoreFromGitHub = useCallback(async () => {
    setIsLoading(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setSyncError(`GitHub geri yükleme başarısız (HTTP ${res.status}): ${txt}`);
        LOG.error("restoreFromGitHub: failed", { status: res.status });
        return;
      }
      // Backup route wrote data to local DB — now reload from local DB
      await restoreFromDrive();
      LOG.sync("restoreFromGitHub: restored and reloaded from local DB");
    } catch (e) {
      setSyncError("GitHub geri yükleme sırasında hata oluştu.");
      LOG.error("restoreFromGitHub: error", e);
    } finally {
      setIsLoading(false);
    }
  }, [restoreFromDrive]);

  const value = useMemo<DataContextValue>(() => ({
    customers, products, sales, payments, debts,
    isLoading, isSyncing, lastSyncTime, syncError,
    addCustomer, updateCustomer, deleteCustomer,
    addProduct, updateProduct, deleteProduct,
    addSale, updateSale, deleteSale,
    addPayment, updatePayment, deletePayment,
    addDebt, updateDebt, deleteDebt,
    getCustomerTotals, getCustomerFeed,
    isDirty,
    syncToDrive, restoreFromDrive, clearAllData,
    backupToGitHub, restoreFromGitHub,
    canUndo, undoLastAction,
  }), [
    customers, products, sales, payments, debts,
    isLoading, isSyncing, lastSyncTime, syncError,
    addCustomer, updateCustomer, deleteCustomer,
    addProduct, updateProduct, deleteProduct,
    addSale, updateSale, deleteSale,
    addPayment, updatePayment, deletePayment,
    addDebt, updateDebt, deleteDebt,
    getCustomerTotals, getCustomerFeed,
    isDirty,
    syncToDrive, restoreFromDrive, clearAllData,
    backupToGitHub, restoreFromGitHub,
    canUndo, undoLastAction,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
