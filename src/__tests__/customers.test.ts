import { describe, it, expect } from "vitest";
import { buildActivityFeed } from "@/lib/customers";
import type { Sale, Payment, Debt } from "@/lib/customers";

function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "s1",
    customerId: "c1",
    date: "2024-06-01T10:00:00.000Z",
    items: [{ productId: "p1", productName: "Ürün", quantity: 2, unitPrice: 100 }],
    subtotal: 200,
    vatRate: 18,
    vatAmount: 36,
    total: 236,
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay1",
    customerId: "c1",
    date: "2024-06-01T10:00:00.000Z",
    amount: 100,
    description: "Ödeme",
    ...overrides,
  };
}

function makeDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "d1",
    customerId: "c1",
    date: "2024-06-01T10:00:00.000Z",
    amount: 50,
    description: "Borç",
    ...overrides,
  };
}

// ─── Empty inputs ─────────────────────────────────────────────────────────────

describe("buildActivityFeed: empty inputs", () => {
  it("returns empty array for all empty inputs", () => {
    expect(buildActivityFeed([], [], [])).toEqual([]);
  });

  it("handles missing debts argument (defaults to [])", () => {
    expect(buildActivityFeed([], [])).toEqual([]);
  });

  it("returns correct items when only sales provided", () => {
    const feed = buildActivityFeed([makeSale()], [], []);
    expect(feed).toHaveLength(1);
    expect(feed[0].type).toBe("sale");
  });

  it("returns correct items when only payments provided", () => {
    const feed = buildActivityFeed([], [makePayment()], []);
    expect(feed).toHaveLength(1);
    expect(feed[0].type).toBe("payment");
  });

  it("returns correct items when only debts provided", () => {
    const feed = buildActivityFeed([], [], [makeDebt()]);
    expect(feed).toHaveLength(1);
    expect(feed[0].type).toBe("debt");
  });
});

// ─── Running balance arithmetic ───────────────────────────────────────────────

describe("buildActivityFeed: balance arithmetic", () => {
  it("sale increases balance by total", () => {
    const feed = buildActivityFeed([makeSale({ total: 500 })], [], []);
    expect(feed[0].runningBalance).toBe(500);
  });

  it("payment decreases balance", () => {
    const feed = buildActivityFeed(
      [makeSale({ date: "2024-01-01", total: 500 })],
      [makePayment({ date: "2024-01-02", amount: 200 })],
      []
    );
    const sorted = feed.sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted[0].runningBalance).toBe(500);
    expect(sorted[1].runningBalance).toBe(300);
  });

  it("debt decreases balance", () => {
    const feed = buildActivityFeed(
      [makeSale({ date: "2024-01-01", total: 500 })],
      [],
      [makeDebt({ date: "2024-01-02", amount: 100 })]
    );
    const sorted = feed.sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted[0].runningBalance).toBe(500);
    expect(sorted[1].runningBalance).toBe(400);
  });

  it("balance can go negative (overpayment)", () => {
    const feed = buildActivityFeed(
      [makeSale({ date: "2024-01-01", total: 100 })],
      [makePayment({ date: "2024-01-02", amount: 300 })],
      []
    );
    const lastEntry = feed.find(f => f.type === "payment")!;
    expect(lastEntry.runningBalance).toBe(-200);
  });

  it("multiple sales accumulate correctly", () => {
    const sales = [
      makeSale({ id: "s1", date: "2024-01-01", total: 100 }),
      makeSale({ id: "s2", date: "2024-01-02", total: 200 }),
      makeSale({ id: "s3", date: "2024-01-03", total: 300 }),
    ];
    const feed = buildActivityFeed(sales, [], []);
    // Sorted newest-first, so reversed running balance: 600, 500, 100
    const balances = feed.map(f => f.runningBalance);
    expect(Math.max(...balances)).toBe(600);
    expect(Math.min(...balances)).toBe(100);
  });

  it("complex mix: sale + payment + debt computes correct final balance", () => {
    const feed = buildActivityFeed(
      [makeSale({ id: "s1", date: "2024-01-01", total: 1000 })],
      [makePayment({ id: "p1", date: "2024-01-03", amount: 400 })],
      [makeDebt({ id: "d1", date: "2024-01-02", amount: 100 })]
    );
    // Oldest-first order: sale(1000) → debt(-100→900) → payment(-400→500)
    // Feed is newest-first so last item in array has final balance
    const finalBalance = feed[0].runningBalance;
    expect(finalBalance).toBe(500);
  });

  it("handles large amounts without floating-point corruption (integer amounts)", () => {
    const largeTotal = 9_999_999;
    const feed = buildActivityFeed([makeSale({ total: largeTotal })], [], []);
    expect(feed[0].runningBalance).toBe(largeTotal);
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe("buildActivityFeed: sort order", () => {
  it("feed is returned newest-first (most recent date at index 0)", () => {
    const sales = [
      makeSale({ id: "s1", date: "2024-01-01T00:00:00.000Z", total: 100 }),
      makeSale({ id: "s2", date: "2024-06-01T00:00:00.000Z", total: 200 }),
    ];
    const feed = buildActivityFeed(sales, [], []);
    expect(feed[0].date).toBe("2024-06-01T00:00:00.000Z");
    expect(feed[1].date).toBe("2024-01-01T00:00:00.000Z");
  });

  it("same timestamp: payment ordered before debt, debt before sale (stable tie-breaker)", () => {
    const ts = "2024-06-01T12:00:00.000Z";
    const feed = buildActivityFeed(
      [makeSale({ id: "s1", date: ts, total: 100 })],
      [makePayment({ id: "pay1", date: ts, amount: 50 })],
      [makeDebt({ id: "d1", date: ts, amount: 25 })]
    );
    // Sort is descending by date; for same-timestamp, typeOrder ascending (payment=0,debt=1,sale=2)
    // so same-date items appear as: payment first, debt second, sale last (payment wins tie-break)
    const types = feed.map(f => f.type);
    expect(types).toEqual(["payment", "debt", "sale"]);
  });

  it("different dates across types are interleaved correctly", () => {
    const feed = buildActivityFeed(
      [makeSale({ id: "s1", date: "2024-01-03", total: 100 })],
      [makePayment({ id: "p1", date: "2024-01-01", amount: 50 })],
      [makeDebt({ id: "d1", date: "2024-01-02", amount: 25 })]
    );
    expect(feed[0].date).toBe("2024-01-03");
    expect(feed[1].date).toBe("2024-01-02");
    expect(feed[2].date).toBe("2024-01-01");
  });
});

// ─── Single item of each type ─────────────────────────────────────────────────

describe("buildActivityFeed: single item", () => {
  it("single sale returns array of length 1 with correct type and balance", () => {
    const feed = buildActivityFeed([makeSale({ total: 999 })], [], []);
    expect(feed).toHaveLength(1);
    expect(feed[0].type).toBe("sale");
    expect(feed[0].runningBalance).toBe(999);
    expect(feed[0].data).toMatchObject({ total: 999 });
  });

  it("single payment returns array of length 1 with negative balance", () => {
    const feed = buildActivityFeed([], [makePayment({ amount: 100 })], []);
    expect(feed).toHaveLength(1);
    expect(feed[0].type).toBe("payment");
    expect(feed[0].runningBalance).toBe(-100);
  });

  it("single debt returns array of length 1 with negative balance", () => {
    const feed = buildActivityFeed([], [], [makeDebt({ amount: 75 })]);
    expect(feed).toHaveLength(1);
    expect(feed[0].type).toBe("debt");
    expect(feed[0].runningBalance).toBe(-75);
  });
});
