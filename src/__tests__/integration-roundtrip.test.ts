import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Full POST → GET round-trip through local DB ───────────────────────────────

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { GET, POST } from "@/app/api/sync/route";
import { auth } from "@/lib/auth";
import fs from "node:fs/promises";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>;

const FULL_DATA = {
  customers: [
    { id: "c1", name: "Ahmet Yılmaz", phone: "555-0001", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "c2", name: "Fatma Şahin",  phone: "555-0002", createdAt: "2026-01-02", updatedAt: "2026-01-02" },
  ],
  products: [
    { id: "p1", name: "Elma", description: "Taze elma", price: 10, stock: 100, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "p2", name: "Armut", description: "Taze armut", price: 15, stock: 50, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ],
  sales: [
    {
      id: "s1", customerId: "c1", date: "2026-06-01T10:00:00.000Z",
      items: [{ productId: "p1", productName: "Elma", quantity: 5, unitPrice: 10, total: 50 }],
      subtotal: 50, vatRate: 10, vatAmount: 5, total: 55,
    },
  ],
  payments: [
    { id: "pay1", customerId: "c1", date: "2026-06-02T10:00:00.000Z", amount: 30, description: "Nakit" },
  ],
  debts: [
    { id: "d1", customerId: "c2", date: "2026-06-01T10:00:00.000Z", amount: 200, description: "Borç devri" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user-integration-test" });
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
  mockFs.rename.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
  mockFs.readFile.mockResolvedValue(JSON.stringify(FULL_DATA));
});

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST → GET round-trip", () => {
  it("data written in POST is returned identically by GET", async () => {
    // POST: write data
    const postRes = await POST(makePost(FULL_DATA));
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.ok).toBe(true);
    expect(postJson.sha).toBeUndefined();

    // Simulate: readFile now returns what was written
    const writtenContent = mockFs.writeFile.mock.calls[0]?.[1] as string;
    expect(writtenContent).toBeDefined();
    mockFs.readFile.mockResolvedValue(writtenContent);

    // GET: read data back
    const getRes = await GET();
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();

    expect(getJson.customers).toEqual(FULL_DATA.customers);
    expect(getJson.products).toEqual(FULL_DATA.products);
    expect(getJson.sales).toEqual(FULL_DATA.sales);
    expect(getJson.payments).toEqual(FULL_DATA.payments);
    expect(getJson.debts).toEqual(FULL_DATA.debts);
    expect(getJson.sha).toBeUndefined();
  });

  it("POST then GET preserves all fields including nested sale items", async () => {
    await POST(makePost(FULL_DATA));
    const writtenContent = mockFs.writeFile.mock.calls[0]?.[1] as string;
    mockFs.readFile.mockResolvedValue(writtenContent);

    const getRes = await GET();
    const getJson = await getRes.json();
    expect(getJson.sales[0].items[0].productName).toBe("Elma");
    expect(getJson.sales[0].vatRate).toBe(10);
    expect(getJson.sales[0].vatAmount).toBe(5);
  });

  it("large payload round-trip: 500 customers preserved exactly", async () => {
    const bigData = {
      customers: Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, name: `Müşteri ${i}` })),
      products:  Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, name: `Ürün ${i}` })),
      sales:     Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, customerId: `c${i % 100}`, total: i * 10 })),
      payments:  Array.from({ length: 500 }, (_, i) => ({ id: `pay${i}`, customerId: `c${i % 100}`, amount: i * 5 })),
      debts:     Array.from({ length: 500 }, (_, i) => ({ id: `d${i}`, customerId: `c${i % 100}`, amount: i * 3 })),
    };

    await POST(makePost(bigData));
    const writtenContent = mockFs.writeFile.mock.calls[0]?.[1] as string;
    mockFs.readFile.mockResolvedValue(writtenContent);

    const getRes = await GET();
    const getJson = await getRes.json();
    expect(getJson.customers).toHaveLength(500);
    expect(getJson.products).toHaveLength(500);
    expect(getJson.sales).toHaveLength(500);
    expect(getJson.customers[499]).toEqual(bigData.customers[499]);
    expect(getJson.sales[0].total).toBe(0);
    expect(getJson.sales[499].total).toBe(4990);
  });

  it("subsequent POSTs overwrite previous data — last write wins", async () => {
    const firstData  = { customers: [{ id: "c1" }], products: [], sales: [], payments: [], debts: [] };
    const secondData = { customers: [{ id: "c2" }], products: [], sales: [], payments: [], debts: [] };

    await POST(makePost(firstData));
    await POST(makePost(secondData));

    // Use the last written content
    const lastWrite = mockFs.writeFile.mock.calls[mockFs.writeFile.mock.calls.length - 1]?.[1] as string;
    mockFs.readFile.mockResolvedValue(lastWrite);

    const getRes = await GET();
    const getJson = await getRes.json();
    expect(getJson.customers).toEqual([{ id: "c2" }]);
  });

  it("GET with no stored data returns all empty arrays", async () => {
    mockFs.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const getRes = await GET();
    const getJson = await getRes.json();
    expect(getJson.customers).toEqual([]);
    expect(getJson.products).toEqual([]);
    expect(getJson.sales).toEqual([]);
    expect(getJson.payments).toEqual([]);
    expect(getJson.debts).toEqual([]);
    expect(getJson.sha).toBeUndefined();
  });
});

describe("Atomic write verification", () => {
  it("writeFile is called before rename (tmp → target order)", async () => {
    const writeOrder: string[] = [];
    mockFs.writeFile.mockImplementation(() => { writeOrder.push("writeFile"); return Promise.resolve(); });
    mockFs.rename.mockImplementation(() => { writeOrder.push("rename"); return Promise.resolve(); });

    await POST(makePost(FULL_DATA));
    expect(writeOrder).toEqual(["writeFile", "rename"]);
  });

  it("tmp path contains .tmp. and target path does not", async () => {
    await POST(makePost(FULL_DATA));
    const [tmpPath] = mockFs.writeFile.mock.calls[0] as [string];
    const [, targetPath] = mockFs.rename.mock.calls[0] as [string, string];
    expect(tmpPath).toContain(".tmp.");
    expect(targetPath).not.toContain(".tmp.");
    expect(targetPath).toMatch(/[a-f0-9]{64}\.json$/);
  });

  it("different users get different file paths", async () => {
    await POST(makePost(FULL_DATA));
    const path1 = (mockFs.rename.mock.calls[0] as [string, string])[1];

    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "different-user" });
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.rename.mockResolvedValue(undefined);

    await POST(makePost(FULL_DATA));
    const path2 = (mockFs.rename.mock.calls[0] as [string, string])[1];

    expect(path1).not.toBe(path2);
  });
});
