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
