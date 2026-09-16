import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/localdb", () => ({
  readLocalData:  vi.fn(),
  writeLocalData: vi.fn(),
}));

import { GET, POST } from "@/app/api/sync/route";
import { auth } from "@/lib/auth";
import { readLocalData, writeLocalData } from "@/lib/localdb";

const mockAuth  = auth          as ReturnType<typeof vi.fn>;
const mockRead  = readLocalData  as ReturnType<typeof vi.fn>;
const mockWrite = writeLocalData as ReturnType<typeof vi.fn>;

const SAMPLE_DATA = {
  customers: [{ id: "c1", name: "Ahmet" }],
  products:  [{ id: "p1", name: "Ürün A" }],
  sales:     [{ id: "s1", customerId: "c1", total: 100 }],
  payments:  [{ id: "pay1", customerId: "c1", amount: 50 }],
  debts:     [{ id: "d1", customerId: "c1", amount: 200 }],
};

const EMPTY_ARRAYS = {
  customers: [], products: [], sales: [], payments: [], debts: [],
};

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user1" });
  mockWrite.mockResolvedValue(undefined);
});

// ─── GET handler ─────────────────────────────────────────────────────────────

describe("GET /api/sync", () => {
  it("returns all data from local db", async () => {
    mockRead.mockResolvedValue(SAMPLE_DATA);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.customers).toEqual(SAMPLE_DATA.customers);
    expect(json.products).toEqual(SAMPLE_DATA.products);
    expect(json.sales).toEqual(SAMPLE_DATA.sales);
    expect(json.payments).toEqual(SAMPLE_DATA.payments);
    expect(json.debts).toEqual(SAMPLE_DATA.debts);
    expect(json.sha).toBeUndefined();
  });

  it("returns empty arrays when local file does not exist", async () => {
    mockRead.mockResolvedValue(null);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.customers).toEqual([]);
    expect(json.products).toEqual([]);
    expect(json.sales).toEqual([]);
    expect(json.payments).toEqual([]);
    expect(json.debts).toEqual([]);
  });

  it("normalizes non-array fields to [] when stored file has schema drift", async () => {
    // Simulates a corrupt or old-schema file where some fields are missing/wrong type
    mockRead.mockResolvedValue({ customers: null, products: undefined, sales: [], payments: [], debts: "bad" } as unknown);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.customers).toEqual([]);  // null → []
    expect(json.products).toEqual([]);   // undefined → []
    expect(json.sales).toEqual([]);      // [] → []
    expect(json.payments).toEqual([]);
    expect(json.debts).toEqual([]);      // "bad" → []
  });

  it("calls readLocalData exactly once with userId", async () => {
    mockRead.mockResolvedValue(SAMPLE_DATA);
    await GET();
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalledWith("user1");
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("returns 401 when session has no userId", async () => {
    mockAuth.mockResolvedValue({ userId: undefined });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 500 when readLocalData throws", async () => {
    mockRead.mockRejectedValue(new Error("disk error"));
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("Read failed");
  });
});

// ─── POST handler ────────────────────────────────────────────────────────────

describe("POST /api/sync", () => {
  it("writes data to local db and returns ok", async () => {
    const req = makePostRequest(SAMPLE_DATA);
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sha).toBeUndefined();
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it("passes all data types to writeLocalData", async () => {
    const req = makePostRequest(SAMPLE_DATA);
    await POST(req);

    expect(mockWrite).toHaveBeenCalledWith("user1", {
      customers: SAMPLE_DATA.customers,
      products:  SAMPLE_DATA.products,
      sales:     SAMPLE_DATA.sales,
      payments:  SAMPLE_DATA.payments,
      debts:     SAMPLE_DATA.debts,
    });
  });

  it("returns 400 when required array fields are missing", async () => {
    const req = makePostRequest({ sha: null });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/arrays/);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 400 when a data field is not an array", async () => {
    const req = makePostRequest({ ...EMPTY_ARRAYS, customers: { id: "c1" } });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON body", async () => {
    const req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid JSON body");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("ignores sha field in body (no longer used)", async () => {
    const req = makePostRequest({ ...SAMPLE_DATA, sha: "some-sha" });
    await POST(req);
    const [, writtenData] = mockWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(writtenData.sha).toBeUndefined();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makePostRequest(SAMPLE_DATA);
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 500 when writeLocalData throws", async () => {
    mockWrite.mockRejectedValue(new Error("disk full"));
    const req = makePostRequest(SAMPLE_DATA);
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBe("Sync failed");
  });
});
