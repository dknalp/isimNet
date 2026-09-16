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
