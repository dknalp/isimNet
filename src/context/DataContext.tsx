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

// ── LocalStorage keys ─────────────────────────────────────────────────────────
const LS = {
  customers:    "isimnet_customers",
  products:     "isimnet_products",
  sales:        "isimnet_sales",
  payments:     "isimnet_payments",
  debts:        "isimnet_debts",
  lastSync:     "isimnet_last_sync",
  lastMutation: "isimnet_last_mutation",
};

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
}

const DataContext = createContext<DataContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────
export function DataProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();

  const [customers, setCustomers] = useState<Customer[]>(() => lsRead<Customer>(LS.customers) ?? []);
  const [products,  setProducts]  = useState<Product[]>(()  => lsRead<Product>(LS.products)   ?? []);
  const [sales,     setSales]     = useState<Sale[]>(()     => lsRead<Sale>(LS.sales)          ?? []);
  const [payments,  setPayments]  = useState<Payment[]>(()  => lsRead<Payment>(LS.payments)    ?? []);
  const [debts,     setDebts]     = useState<Debt[]>(()     => lsRead<Debt>(LS.debts)          ?? []);

  const [isLoading,    setIsLoading]    = useState(true);
  const [isSyncing,    setIsSyncing]    = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncError,    setSyncError]    = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS.lastSync);
      if (raw) setLastSyncTime(new Date(raw));
    } catch { /* */ }
  }, []);

  const stateRef = useRef({ customers, products, sales, payments, debts });
  stateRef.current = { customers, products, sales, payments, debts };

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const shaRef = useRef<string | null>(null);

  // P1-FIX: dirty tracking — seq snapshot captured BEFORE async, so concurrent mutations aren't lost
  const mutationSeq = useRef(0);
  const syncedSeq   = useRef(0);

  // P1-FIX: track timestamp of last mutation to detect offline edits on remount
  const lastMutationAt = useRef<number>(
    (() => {
      try {
        const raw = localStorage.getItem(LS.lastMutation);
        return raw ? parseInt(raw, 10) : 0;
      } catch { return 0; }
    })()
  );

  // ── Mutation helpers: write localStorage + increment dirty counter ─────────
  function markMutation() {
    mutationSeq.current += 1;
    lastMutationAt.current = Date.now();
    try { localStorage.setItem(LS.lastMutation, String(lastMutationAt.current)); } catch { /* */ }
  }

  const setC = useCallback((fn: (prev: Customer[]) => Customer[]) => {
    markMutation();
    setCustomers(prev => {
      const next = fn(prev);
      if (!lsWrite(LS.customers, next)) LOG.warn("setC: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setP = useCallback((fn: (prev: Product[]) => Product[]) => {
    markMutation();
    setProducts(prev => {
      const next = fn(prev);
      if (!lsWrite(LS.products, next)) LOG.warn("setP: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setS = useCallback((fn: (prev: Sale[]) => Sale[]) => {
    markMutation();
    setSales(prev => {
      const next = fn(prev);
      if (!lsWrite(LS.sales, next)) LOG.warn("setS: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPay = useCallback((fn: (prev: Payment[]) => Payment[]) => {
    markMutation();
    setPayments(prev => {
      const next = fn(prev);
      if (!lsWrite(LS.payments, next)) LOG.warn("setPay: localStorage write failed — data in memory only");
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setD = useCallback((fn: (prev: Debt[]) => Debt[]) => {
    markMutation();
    setDebts(prev => {
      const next = fn(prev);
      if (!lsWrite(LS.debts, next)) LOG.warn("setD: localStorage write failed — data in memory only");
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

    // Capture seq BEFORE await — mutations that arrive mid-flight stay dirty
    const seqAtStart = mutationSeq.current;
    const { customers, products, sales, payments, debts } = stateRef.current;
    const currentSha = shaRef.current;

    LOG.sync("syncToDriveInternal: start", {
      seqAtStart, sha: currentSha,
      counts: { customers: customers.length, products: products.length, sales: sales.length, payments: payments.length, debts: debts.length },
    });

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers, products, sales, payments, debts, sha: currentSha }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "(unreadable)");
        LOG.error(`syncToDriveInternal: HTTP ${res.status}`, errText);
        setSyncError(`Sync başarısız (HTTP ${res.status}). Verileriniz güvende — sonraki denemede tekrar gönderilecek.`);
        // P0-FIX: do NOT update sha or syncedSeq — data stays dirty
        return;
      }

      const json = await res.json();

      // P0-FIX: missing sha = GitHub write silently failed
      if (!json.sha) {
        LOG.error("syncToDriveInternal: response missing sha — write may have failed silently", json);
        setSyncError("Sync doğrulanamadı (sha eksik). Verileriniz güvende — bir sonraki sync tekrar denenecek.");
        return;
      }

      // P1-FIX: only advance syncedSeq to seqAtStart, not current mutationSeq
      if (syncedSeq.current < seqAtStart) {
        syncedSeq.current = seqAtStart;
      }
      shaRef.current = json.sha;

      const now = new Date();
      setLastSyncTime(now);
      try { localStorage.setItem(LS.lastSync, now.toISOString()); } catch { /* */ }
      setSyncError(null);

      LOG.sync("syncToDriveInternal: success", {
        newSha: json.sha,
        seqSynced: seqAtStart,
        currentSeq: mutationSeq.current,
        pendingDirty: mutationSeq.current > seqAtStart,
      });
    } catch (e) {
      LOG.error("syncToDriveInternal: network error", e);
      setSyncError("Ağ hatası — verileriniz cihazda güvende, bağlantı gelince otomatik sync denenecek.");
      // P0-FIX: do NOT update sha or syncedSeq
    }
  }, []);

  // ── Mount: fetch from GitHub ──────────────────────────────────────────────
  useEffect(() => {
    if (status !== "authenticated" || !session?.userId) {
      if (status === "unauthenticated") {
        setIsLoading(false);
        LOG.info("mount: unauthenticated, using local data only");
      }
      return;
    }

    const hasLocal = lsRead(LS.customers) !== null || lsRead(LS.products) !== null;
    if (!hasLocal) setIsLoading(true);

    LOG.sync("mount: fetching from GitHub");

    fetch("/api/sync")
      .then(async res => {
        if (!res.ok) {
          LOG.error(`mount: GET /api/sync HTTP ${res.status} — keeping local data`);
          setIsLoading(false);
          return;
        }

        const data = await res.json();
        LOG.sync("mount: received GitHub data", {
          sha: data.sha,
          counts: { customers: data.customers?.length, products: data.products?.length, sales: data.sales?.length, payments: data.payments?.length, debts: data.debts?.length },
        });

        if (!data.customers && !data.products) {
          LOG.sync("mount: GitHub returned empty — keeping local data");
          setIsLoading(false);
          return;
        }

        // P1-FIX: if local data was mutated after the last sync, protect it
        const lastSyncMs = (() => {
          try {
            const raw = localStorage.getItem(LS.lastSync);
            return raw ? new Date(raw).getTime() : 0;
          } catch { return 0; }
        })();

        if (lastMutationAt.current > lastSyncMs) {
          LOG.warn("mount: local data is NEWER than last sync — pushing local to GitHub instead of overwriting", {
            lastMutationAt: new Date(lastMutationAt.current).toISOString(),
            lastSyncAt: lastSyncMs ? new Date(lastSyncMs).toISOString() : "never",
          });
          // Capture fresh GitHub sha so our push resolves correctly
          shaRef.current = data.sha ?? null;
          setIsLoading(false);
          void syncToDriveInternal();
          return;
        }

        // GitHub is authoritative
        shaRef.current = data.sha ?? null;

        if (Array.isArray(data.customers)) { setCustomers(data.customers); lsWrite(LS.customers, data.customers); }
        if (Array.isArray(data.products))  { setProducts(data.products);   lsWrite(LS.products,  data.products); }
        if (Array.isArray(data.sales))     { setSales(data.sales);         lsWrite(LS.sales,     data.sales); }
        if (Array.isArray(data.payments))  { setPayments(data.payments);   lsWrite(LS.payments,  data.payments); }
        if (Array.isArray(data.debts))     { setDebts(data.debts);         lsWrite(LS.debts,     data.debts); }

        // Clean orphan records (customer deleted on another device)
        const cIds = new Set((data.customers as Customer[]).map((c: Customer) => c.id));
        setSales(prev   => prev.filter(s => cIds.has(s.customerId)));
        setPayments(prev => prev.filter(p => cIds.has(p.customerId)));
        setDebts(prev   => prev.filter(d => cIds.has(d.customerId)));

        syncedSeq.current = mutationSeq.current;
        LOG.sync("mount: applied GitHub data", { sha: data.sha });
        setIsLoading(false);
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
          body: JSON.stringify({ customers, products, sales, payments, debts, sha: shaRef.current }),
          keepalive: true,
        }).catch(() => { /* best-effort — can't await on hidden */ });
      }

      if (document.visibilityState === "visible") {
        // Refresh SHA after keepalive POST (response unavailable from keepalive)
        LOG.sync("visibilitychange visible: refreshing SHA from GitHub");
        fetch("/api/sync")
          .then(r => r.ok ? r.json() : null)
          .then(json => {
            if (json?.sha !== undefined) {
              shaRef.current = json.sha;
              LOG.sync("visibilitychange visible: SHA refreshed", { sha: json.sha });
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
    const newC: Customer = { ...data, id: `c_${Date.now()}`, createdAt: now, updatedAt: now };
    LOG.info("addCustomer", { id: newC.id, name: newC.name });
    setC(prev => [newC, ...prev]);
  }, [setC]);

  const updateCustomer = useCallback((id: string, data: Partial<NewCustomerFormData>) => {
    LOG.info("updateCustomer", { id });
    setC(prev => prev.map(c => c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c));
  }, [setC]);

  const deleteCustomer = useCallback((id: string) => {
    LOG.info("deleteCustomer", { id });
    setC(prev => prev.filter(c => c.id !== id));
    setS(prev => prev.filter(s => s.customerId !== id));
    setPay(prev => prev.filter(p => p.customerId !== id));
    setD(prev => prev.filter(d => d.customerId !== id));
  }, [setC, setS, setPay, setD]);

  // ── CRUD: products ────────────────────────────────────────────────────────
  const addProduct = useCallback((data: NewProductFormData) => {
    const now = new Date().toISOString();
    const newP: Product = { ...data, id: `p_${Date.now()}`, createdAt: now, updatedAt: now };
    LOG.info("addProduct", { id: newP.id, name: newP.name });
    setP(prev => [newP, ...prev]);
  }, [setP]);

  const updateProduct = useCallback((id: string, data: Partial<NewProductFormData>) => {
    LOG.info("updateProduct", { id });
    setP(prev => prev.map(p => p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p));
  }, [setP]);

  const deleteProduct = useCallback((id: string) => {
    LOG.info("deleteProduct", { id });
    setP(prev => prev.filter(p => p.id !== id));
  }, [setP]);

  // ── CRUD: sales (with stock adjustment) ──────────────────────────────────
  const addSale = useCallback((data: Omit<Sale, "id">) => {
    const newS: Sale = { ...data, id: `s_${Date.now()}` };
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
    const newP: Payment = { ...data, id: `pay_${Date.now()}` };
    LOG.info("addPayment", { id: newP.id, customerId: newP.customerId, amount: newP.amount });
    setPay(prev => [newP, ...prev]);
  }, [setPay]);

  const updatePayment = useCallback((id: string, data: Pick<Payment, "amount" | "description">) => {
    LOG.info("updatePayment", { id });
    setPay(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
  }, [setPay]);

  const deletePayment = useCallback((id: string) => {
    LOG.info("deletePayment", { id });
    setPay(prev => prev.filter(p => p.id !== id));
  }, [setPay]);

  // ── CRUD: debts ───────────────────────────────────────────────────────────
  const addDebt = useCallback((data: Omit<Debt, "id">) => {
    const newD: Debt = { ...data, id: `d_${Date.now()}` };
    LOG.info("addDebt", { id: newD.id, customerId: newD.customerId, amount: newD.amount });
    setD(prev => [newD, ...prev]);
  }, [setD]);

  const updateDebt = useCallback((id: string, data: Pick<Debt, "amount" | "description">) => {
    LOG.info("updateDebt", { id });
    setD(prev => prev.map(d => d.id === id ? { ...d, ...data } : d));
  }, [setD]);

  const deleteDebt = useCallback((id: string) => {
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
      LOG.sync("restoreFromDrive: received", { sha: data.sha, counts: { customers: data.customers?.length, products: data.products?.length } });

      shaRef.current = data.sha ?? null;
      if (Array.isArray(data.customers)) { setCustomers(data.customers); lsWrite(LS.customers, data.customers); }
      if (Array.isArray(data.products))  { setProducts(data.products);   lsWrite(LS.products,  data.products); }
      if (Array.isArray(data.sales))     { setSales(data.sales);         lsWrite(LS.sales,     data.sales); }
      if (Array.isArray(data.payments))  { setPayments(data.payments);   lsWrite(LS.payments,  data.payments); }
      if (Array.isArray(data.debts))     { setDebts(data.debts);         lsWrite(LS.debts,     data.debts); }

      syncedSeq.current = mutationSeq.current;
      const now = new Date();
      setLastSyncTime(now);
      try { localStorage.setItem(LS.lastSync, now.toISOString()); } catch { /* */ }
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
    LOG.warn("clearAllData: wiping all local and remote data");
    setCustomers([]); lsWrite(LS.customers, []);
    setProducts([]);  lsWrite(LS.products,  []);
    setSales([]);     lsWrite(LS.sales,     []);
    setPayments([]);  lsWrite(LS.payments,  []);
    setDebts([]);     lsWrite(LS.debts,     []);
    mutationSeq.current += 1;
    if (sessionRef.current?.userId) {
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customers: [], products: [], sales: [], payments: [], debts: [], sha: shaRef.current }),
        });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.sha) { shaRef.current = json.sha; syncedSeq.current = mutationSeq.current; }
          LOG.warn("clearAllData: remote data wiped", { sha: json?.sha });
        } else {
          LOG.error(`clearAllData: remote wipe failed HTTP ${res.status}`);
        }
      } catch (e) {
        LOG.error("clearAllData: remote wipe error", e);
      }
    }  }, []);

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

  const value = useMemo<DataContextValue>(() => ({
    customers, products, sales, payments, debts,
    isLoading, isSyncing, lastSyncTime, syncError,
    addCustomer, updateCustomer, deleteCustomer,
    addProduct, updateProduct, deleteProduct,
    addSale, updateSale, deleteSale,
    addPayment, updatePayment, deletePayment,
    addDebt, updateDebt, deleteDebt,
    getCustomerTotals, getCustomerFeed,
    syncToDrive, restoreFromDrive, clearAllData,
  }), [
    customers, products, sales, payments, debts,
    isLoading, isSyncing, lastSyncTime, syncError,
    addCustomer, updateCustomer, deleteCustomer,
    addProduct, updateProduct, deleteProduct,
    addSale, updateSale, deleteSale,
    addPayment, updatePayment, deletePayment,
    addDebt, updateDebt, deleteDebt,
    getCustomerTotals, getCustomerFeed,
    syncToDrive, restoreFromDrive, clearAllData,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
