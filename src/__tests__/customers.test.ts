import { describe, it, expect } from "vitest";
import { buildActivityFeed, Sale, Payment, Debt } from "@/lib/customers";

function makeSale(id: string, date: string, total: number): Sale {
  return {
    id,
    customerId: "c1",
    date,
    items: [],
    vatRate: 0,
    subtotal: total,
    vatAmount: 0,
    total,
  };
}

function makePayment(id: string, date: string, amount: number): Payment {
  return { id, customerId: "c1", date, amount, description: "" };
}

function makeDebt(id: string, date: string, amount: number): Debt {
  return { id, customerId: "c1", date, amount, description: "" };
}

describe("buildActivityFeed", () => {
  it("returns empty array for empty inputs", () => {
    expect(buildActivityFeed([], [], [])).toEqual([]);
  });

  it("returns empty array with default debts parameter", () => {
    expect(buildActivityFeed([], [])).toEqual([]);
  });

  it("computes correct running balance: sale then payment", () => {
    const sales = [makeSale("s1", "2024-01-01T10:00:00.000Z", 1000)];
    const payments = [makePayment("p1", "2024-01-02T10:00:00.000Z", 400)];
    const feed = buildActivityFeed(sales, payments);

    // Newest first — payment is first in output
    expect(feed[0].type).toBe("payment");
    expect(feed[0].runningBalance).toBe(600);
    expect(feed[1].type).toBe("sale");
    expect(feed[1].runningBalance).toBe(1000);
  });

  it("computes correct running balance: sale, payment, debt", () => {
    const sales = [makeSale("s1", "2024-01-01T10:00:00.000Z", 1000)];
    const payments = [makePayment("p1", "2024-01-02T10:00:00.000Z", 300)];
    const debts = [makeDebt("d1", "2024-01-03T10:00:00.000Z", 200)];
    const feed = buildActivityFeed(sales, payments, debts);

    // Newest first: debt (balance=500), payment (balance=700), sale (balance=1000)
    expect(feed[0].type).toBe("debt");
    expect(feed[0].runningBalance).toBe(500);
    expect(feed[1].type).toBe("payment");
    expect(feed[1].runningBalance).toBe(700);
    expect(feed[2].type).toBe("sale");
    expect(feed[2].runningBalance).toBe(1000);
  });

  it("result is sorted newest-first (reversed chronological)", () => {
    const sales = [
      makeSale("s1", "2024-01-01T10:00:00.000Z", 100),
      makeSale("s2", "2024-03-01T10:00:00.000Z", 200),
      makeSale("s3", "2024-02-01T10:00:00.000Z", 150),
    ];
    const feed = buildActivityFeed(sales, []);
    const dates = feed.map((f) => f.date);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  it("same-timestamp events produce deterministic running balance", () => {
    const ts = "2024-06-15T12:00:00.000Z";
    const sales = [makeSale("s1", ts, 500)];
    const payments = [makePayment("p1", ts, 200)];
    // Run twice — result must be identical
    const feed1 = buildActivityFeed(sales, payments);
    const feed2 = buildActivityFeed(sales, payments);
    const balances1 = feed1.map((f) => f.runningBalance);
    const balances2 = feed2.map((f) => f.runningBalance);
    expect(balances1).toEqual(balances2);
  });

  it("same-timestamp: payment sorts before sale (reduces balance first)", () => {
    const ts = "2024-06-15T12:00:00.000Z";
    const sales = [makeSale("s1", ts, 1000)];
    const payments = [makePayment("p1", ts, 400)];
    const feed = buildActivityFeed(sales, payments);
    // Oldest-first processing: payment (0-400=-400) then sale (-400+1000=600)
    // Reversed output: sale first (balance=600), payment last (balance=-400... wait)
    // Actually: payment sorts before sale in ascending order
    // ascending: payment runningBalance = -400, sale runningBalance = 600
    // reversed (newest-first): sale (600), payment (-400)
    const saleFeed = feed.find((f) => f.type === "sale");
    const payFeed = feed.find((f) => f.type === "payment");
    expect(saleFeed).toBeDefined();
    expect(payFeed).toBeDefined();
    // Balances are deterministic
    expect(saleFeed!.runningBalance).toBe(600);
    expect(payFeed!.runningBalance).toBe(-400);
  });

  it("handles only payments (balance goes negative)", () => {
    const payments = [
      makePayment("p1", "2024-01-01T10:00:00.000Z", 100),
      makePayment("p2", "2024-01-02T10:00:00.000Z", 50),
    ];
    const feed = buildActivityFeed([], payments);
    expect(feed[0].runningBalance).toBe(-150);
    expect(feed[1].runningBalance).toBe(-100);
  });
});
