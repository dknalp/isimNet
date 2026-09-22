export interface Customer {
  id: string;
  name: string;
  phone?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Sale {
  id: string;
  customerId: string;
  date: string;
  items: SaleItem[];
  vatRate: 0 | 10 | 20;
  subtotal: number;
  vatAmount: number;
  total: number;
}

export interface Payment {
  id: string;
  customerId: string;
  date: string;
  amount: number;
  description: string;
  method?: "nakit" | "cek" | "havale" | "kredi_karti";
}

export interface Debt {
  id: string;
  customerId: string;
  date: string;
  amount: number;
  description: string;
}

export interface ActivityItem {
  type: "sale" | "payment" | "debt";
  date: string;
  runningBalance: number;
  data: Sale | Payment | Debt;
}

export type NewCustomerFormData = Omit<Customer, "id" | "createdAt" | "updatedAt">;

export interface SaleItemDraft {
  productId: string;
  productName: string;
  listPrice: number;
  quantity: number;
  priceOverride?: number;
}

export function buildActivityFeed(sales: Sale[], payments: Payment[], debts: Debt[] = []): ActivityItem[] {
  type RawItem = { type: "sale" | "payment" | "debt"; date: string; data: Sale | Payment | Debt };

  const raw: RawItem[] = [
    ...sales.map((s) => ({ type: "sale" as const, date: s.date, data: s })),
    ...payments.map((p) => ({ type: "payment" as const, date: p.date, data: p })),
    ...debts.map((d) => ({ type: "debt" as const, date: d.date, data: d })),
  ].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    // Stable tie-breaker: payments and debts (reductions) before sales on same timestamp
    const typeOrder = { payment: 0, debt: 1, sale: 2 };
    const typeCmp = typeOrder[a.type] - typeOrder[b.type];
    if (typeCmp !== 0) return typeCmp;
    // Final tie-breaker: ID lexicographic order for full determinism
    return (a.data as Sale | Payment | Debt).id.localeCompare((b.data as Sale | Payment | Debt).id);
  });

  let balance = 0;
  const items: ActivityItem[] = raw.map((r) => {
    if (r.type === "sale") balance += (r.data as Sale).total;
    else if (r.type === "payment") balance -= (r.data as Payment).amount;
    else balance -= (r.data as Debt).amount;
    return { type: r.type, date: r.date, runningBalance: balance, data: r.data };
  });

  return items.reverse();
}
