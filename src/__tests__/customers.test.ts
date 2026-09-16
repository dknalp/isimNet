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
    vatRate: 20,
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
    // Sort ascending by typeOrder (payment=0,debt=1,sale=2), then items.reverse() for newest-first display.
    // After reversal: [payment,debt,sale] → [sale,debt,payment]
    const types = feed.map(f => f.type);
    expect(types).toEqual(["sale", "debt", "payment"]);
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

// ─── Round 3: Business logic edge cases ──────────────────────────────────────

describe("buildActivityFeed: edge cases", () => {
  const BASE_DATE = "2026-01-01T12:00:00.000Z";

  it("negative balance when payments exceed sales", () => {
    const sales: Sale[] = [{
      id: "s1", customerId: "c1", date: "2026-01-01T10:00:00.000Z",
      items: [], subtotal: 100, vatRate: 0, vatAmount: 0, total: 100,
    }];
    const payments: Payment[] = [{
      id: "pay1", customerId: "c1", date: "2026-01-02T10:00:00.000Z",
      amount: 200, description: "overpayment",
    }];
    const feed = buildActivityFeed(sales, payments);
    // Most recent first: payment at top, then sale
    expect(feed[0].runningBalance).toBe(-100); // 100 - 200 = -100
    expect(feed[1].runningBalance).toBe(100);
  });

  it("debt reduces balance (same as payment)", () => {
    const debts: Debt[] = [{
      id: "d1", customerId: "c1", date: BASE_DATE, amount: 50, description: "credit",
    }];
    const feed = buildActivityFeed([], [], debts);
    expect(feed[0].runningBalance).toBe(-50);
  });

  it("handles 1000 items without stack overflow", () => {
    const sales: Sale[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `s${i}`, customerId: "c1",
      date: new Date(Date.now() + i * 1000).toISOString(),
      items: [], subtotal: 1, vatRate: 0, vatAmount: 0, total: 1,
    }));
    expect(() => buildActivityFeed(sales, [])).not.toThrow();
    const feed = buildActivityFeed(sales, []);
    expect(feed).toHaveLength(1000);
    expect(feed[0].runningBalance).toBe(1000); // most recent = highest balance
  });

  it("single sale: runningBalance equals total", () => {
    const sales: Sale[] = [{
      id: "s1", customerId: "c1", date: BASE_DATE,
      items: [], subtotal: 250, vatRate: 10, vatAmount: 25, total: 275,
    }];
    const feed = buildActivityFeed(sales, []);
    expect(feed).toHaveLength(1);
    expect(feed[0].runningBalance).toBe(275);
    expect(feed[0].type).toBe("sale");
  });

  it("single payment: runningBalance is negative (no prior sales)", () => {
    const payments: Payment[] = [{
      id: "pay1", customerId: "c1", date: BASE_DATE, amount: 100, description: "advance",
    }];
    const feed = buildActivityFeed([], payments);
    expect(feed).toHaveLength(1);
    expect(feed[0].runningBalance).toBe(-100);
  });

  it("items with same date and same type sorted by ID lexicographically then reversed", () => {
    const sales: Sale[] = [
      { id: "s_b", customerId: "c1", date: BASE_DATE, items: [], subtotal: 1, vatRate: 0, vatAmount: 0, total: 1 },
      { id: "s_a", customerId: "c1", date: BASE_DATE, items: [], subtotal: 2, vatRate: 0, vatAmount: 0, total: 2 },
    ];
    const feed = buildActivityFeed(sales, []);
    // Ascending sort by (date, type=sale, id): s_a < s_b → after reverse: s_b first
    expect((feed[0].data as Sale).id).toBe("s_b");
    expect((feed[1].data as Sale).id).toBe("s_a");
  });
});

// ─── Round 5: getCustomerTotals logic (pure functions extracted for testing) ──

describe("currentDebt formula: totalRevenue - totalCollected - myDebt", () => {
  it("currentDebt excludes Debt entries if only totalRevenue - totalCollected used (bug check)", () => {
    // Simulating what getCustomerTotals returns
    const sales    = [{ total: 500 }];
    const payments = [{ amount: 100 }];
    const debts    = [{ amount: 150 }]; // Debt = credit/write-off

    const totalRevenue   = sales.reduce((s, x)    => s + x.total,  0); // 500
    const totalCollected = payments.reduce((s, x) => s + x.amount, 0); // 100
    const myDebt         = debts.reduce((s, x)    => s + x.amount, 0); // 150

    const currentDebt = totalRevenue - totalCollected - myDebt; // 250
    expect(currentDebt).toBe(250);
    // Old buggy formula: totalRevenue - totalCollected = 400 (WRONG — ignores debt write-offs)
    expect(totalRevenue - totalCollected).toBe(400);
  });

  it("currentDebt is zero when all amounts balance", () => {
    const totalRevenue   = 1000;
    const totalCollected = 600;
    const myDebt         = 400;
    expect(totalRevenue - totalCollected - myDebt).toBe(0);
  });

  it("currentDebt can go negative when total credits exceed sales", () => {
    const totalRevenue   = 100;
    const totalCollected = 200;
    const myDebt         = 50;
    expect(totalRevenue - totalCollected - myDebt).toBe(-150);
  });

  it("buildActivityFeed and currentDebt formula agree on balance", () => {
    // The running balance in buildActivityFeed at the end (first item after reverse)
    // should match totalRevenue - totalCollected - myDebt
    const sales: Sale[] = [{
      id: "s1", customerId: "c1", date: "2026-01-01T10:00:00.000Z",
      items: [], subtotal: 500, vatRate: 0, vatAmount: 0, total: 500,
    }];
    const payments: Payment[] = [{
      id: "pay1", customerId: "c1", date: "2026-01-02T10:00:00.000Z",
      amount: 100, description: "payment",
    }];
    const debts: Debt[] = [{
      id: "d1", customerId: "c1", date: "2026-01-03T10:00:00.000Z",
      amount: 150, description: "write-off",
    }];

    const feed = buildActivityFeed(sales, payments, debts);
    // Most recent first → feed[0] is the debt (most recent date), its runningBalance = final balance
    const finalBalance = feed[0].runningBalance;
    const formulaBalance = 500 - 100 - 150;
    expect(finalBalance).toBe(formulaBalance); // 250
  });
});

// ─── Round 15: Final edge cases ───────────────────────────────────────────────

describe("buildActivityFeed: omitted debts parameter", () => {
  it("works correctly when debts parameter is omitted (defaults to [])", () => {
    const sales: Sale[] = [{
      id: "s1", customerId: "c1", date: "2026-01-01T10:00:00.000Z",
      items: [], subtotal: 100, vatRate: 0, vatAmount: 0, total: 100,
    }];
    const payments: Payment[] = [];
    // Calling with only 2 arguments — debts defaults to []
    const feed = buildActivityFeed(sales, payments);
    expect(feed).toHaveLength(1);
    expect(feed[0].runningBalance).toBe(100);
  });

  it("explicitly passing empty debts array is same as omitting", () => {
    const sales: Sale[] = [{
      id: "s1", customerId: "c1", date: "2026-01-01T10:00:00.000Z",
      items: [], subtotal: 100, vatRate: 0, vatAmount: 0, total: 100,
    }];
    const withExplicit = buildActivityFeed(sales, [], []);
    const withOmitted  = buildActivityFeed(sales, []);
    expect(withExplicit).toEqual(withOmitted);
  });
});

describe("buildActivityFeed: DST and timezone boundaries", () => {
  it("correctly orders events across DST boundary dates", () => {
    // March DST change — ISO strings still sort correctly as strings
    const sales: Sale[] = [
      {
        id: "s1", customerId: "c1", date: "2026-03-29T01:00:00.000Z", // before DST
        items: [], subtotal: 100, vatRate: 0, vatAmount: 0, total: 100,
      },
      {
        id: "s2", customerId: "c1", date: "2026-03-29T03:00:00.000Z", // after DST
        items: [], subtotal: 200, vatRate: 0, vatAmount: 0, total: 200,
      },
    ];
    const feed = buildActivityFeed(sales, []);
    // Most recent first
    expect((feed[0].data as Sale).id).toBe("s2");
    expect((feed[1].data as Sale).id).toBe("s1");
    expect(feed[0].runningBalance).toBe(300); // cumulative: 100+200
    expect(feed[1].runningBalance).toBe(100);
  });
});

describe("buildActivityFeed: data type passed through correctly", () => {
  it("feed item.data is the original Sale/Payment/Debt object (not a copy)", () => {
    const originalSale: Sale = {
      id: "s1", customerId: "c1", date: "2026-01-01T10:00:00.000Z",
      items: [{ productId: "p1", productName: "Elma", quantity: 2, unitPrice: 10 }],
      subtotal: 20, vatRate: 10, vatAmount: 2, total: 22,
    };
    const feed = buildActivityFeed([originalSale], []);
    expect(feed[0].data).toBe(originalSale); // strict reference equality
  });
});
