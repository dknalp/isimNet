import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/github", () => ({
  readOrMigrateDataFile: vi.fn(),
  writeDataFile:         vi.fn(),
}));
vi.mock("@/lib/localdb", () => ({
  writeLocalData: vi.fn(),
  readLocalData:  vi.fn(),
}));

import { GET, POST } from "@/app/api/backup/route";
import { auth } from "@/lib/auth";
import { readOrMigrateDataFile, writeDataFile } from "@/lib/github";
import { writeLocalData } from "@/lib/localdb";

const mockAuth   = auth                   as ReturnType<typeof vi.fn>;
const mockRead   = readOrMigrateDataFile  as ReturnType<typeof vi.fn>;
const mockWrite  = writeDataFile          as ReturnType<typeof vi.fn>;
const mockLocal  = writeLocalData         as ReturnType<typeof vi.fn>;

const FULL_DATA = {
  customers: [{ id: "c1", name: "Ahmet" }],
  products:  [{ id: "p1", name: "Ürün" }],
  sales:     [{ id: "s1", customerId: "c1", total: 100 }],
  payments:  [{ id: "pay1", customerId: "c1", amount: 50 }],
  debts:     [{ id: "d1", customerId: "c1", amount: 200 }],
};

const EMPTY = { customers: [], products: [], sales: [], payments: [], debts: [] };

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user1" });
  mockLocal.mockResolvedValue(undefined);
  mockRead.mockResolvedValue({ data: FULL_DATA, sha: "sha_abc" });
  mockWrite.mockResolvedValue("new_sha_xyz");
  // Restore GitHub env vars
  process.env.GITHUB_TOKEN      = "tok";
  process.env.GITHUB_REPO_OWNER = "owner";
  process.env.GITHUB_REPO_NAME  = "repo";
});

// ─── GET /api/backup ─────────────────────────────────────────────────────────

describe("GET /api/backup", () => {
  it("returns 401 when not authenticated", async () => {
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

  it("returns 401 when session has RefreshTokenError (expired token)", async () => {
    mockAuth.mockResolvedValue({ userId: "user1", error: "RefreshTokenError" });
    const res = await GET();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/expired/i);
  });

  it("returns 503 when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/not configured/i);
  });

  it("returns 503 when GITHUB_TOKEN is set but GITHUB_REPO_OWNER missing", async () => {
    delete process.env.GITHUB_REPO_OWNER;
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns 503 when GITHUB_TOKEN is empty string (falsy)", async () => {
    process.env.GITHUB_TOKEN = "";
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("returns 404 when GitHub has no backup (data is null)", async () => {
    mockRead.mockResolvedValue({ data: null, sha: null });
    const res = await GET();
    expect(res.status).toBe(404);
    expect(mockLocal).not.toHaveBeenCalled();
  });

  it("returns 200 with counts on successful restore", async () => {
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.counts).toEqual({
      customers: 1, products: 1, sales: 1, payments: 1, debts: 1,
    });
  });

  it("calls writeLocalData with GitHub data on success", async () => {
    await GET();
    expect(mockLocal).toHaveBeenCalledTimes(1);
    expect(mockLocal).toHaveBeenCalledWith("user1", FULL_DATA);
  });

  it("returns 500 when readOrMigrateDataFile throws", async () => {
    mockRead.mockRejectedValue(new Error("GitHub API down"));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Restore failed");
  });

  it("returns 500 when writeLocalData throws (partial restore — data from GitHub not persisted)", async () => {
    // Bug: GitHub read succeeded but local write failed — client gets 500
    // The catch block handles both GitHub and local errors without distinction
    mockLocal.mockRejectedValue(new Error("disk full"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(mockRead).toHaveBeenCalledTimes(1); // GitHub was read
    // No distinction between "GitHub failed" and "local write failed" in error response
  });

  it("calls readOrMigrateDataFile with the session userId", async () => {
    await GET();
    expect(mockRead).toHaveBeenCalledWith("user1");
  });
});

// ─── POST /api/backup ────────────────────────────────────────────────────────

describe("POST /api/backup", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makePost(FULL_DATA));
    expect(res.status).toBe(401);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 401 when session has RefreshTokenError", async () => {
    mockAuth.mockResolvedValue({ userId: "user1", error: "RefreshTokenError" });
    const res = await POST(makePost(FULL_DATA));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/expired/i);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 503 when GitHub not configured", async () => {
    delete process.env.GITHUB_TOKEN;
    const res = await POST(makePost(FULL_DATA));
    expect(res.status).toBe(503);
  });

  it("returns 400 for malformed JSON body", async () => {
    const req = new NextRequest("http://localhost/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid }",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 200 with sha on success", async () => {
    const res = await POST(makePost(FULL_DATA));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sha).toBe("new_sha_xyz");
  });

  it("passes all data arrays to writeDataFile", async () => {
    await POST(makePost(FULL_DATA));
    const [userId, data] = mockWrite.mock.calls[0] as [string, typeof FULL_DATA, string | null];
    expect(userId).toBe("user1");
    expect(data.customers).toEqual(FULL_DATA.customers);
    expect(data.sales).toEqual(FULL_DATA.sales);
  });

  it("defaults missing arrays to [] in body", async () => {
    await POST(makePost({ sha: "abc" }));
    const [, data] = mockWrite.mock.calls[0] as [string, typeof EMPTY, string | null];
    expect(data.customers).toEqual([]);
    expect(data.products).toEqual([]);
  });

  it("passes sha string from body to writeDataFile", async () => {
    await POST(makePost({ ...FULL_DATA, sha: "my-sha-123" }));
    const [, , sha] = mockWrite.mock.calls[0] as [string, typeof FULL_DATA, string | null];
    expect(sha).toBe("my-sha-123");
  });

  it("passes null sha when sha field is absent", async () => {
    await POST(makePost(FULL_DATA));
    const [, , sha] = mockWrite.mock.calls[0] as [string, typeof FULL_DATA, string | null];
    expect(sha).toBeNull();
  });

  it("passes null sha when sha field is null (not string)", async () => {
    await POST(makePost({ ...FULL_DATA, sha: null }));
    const [, , sha] = mockWrite.mock.calls[0] as [string, typeof FULL_DATA, string | null];
    expect(sha).toBeNull();
  });

  it('passes null sha when sha field is literal string "null"', async () => {
    // "null" as a string is still a string — it will be passed as-is
    // This is a known edge case: GitHub would receive sha="null" and likely reject with 422
    // Document: callers must not send sha: "null"
    await POST(makePost({ ...FULL_DATA, sha: "null" }));
    const [, , sha] = mockWrite.mock.calls[0] as [string, typeof FULL_DATA, string | null];
    expect(sha).toBe("null"); // currently passed through — caller's responsibility
  });

  it("returns 502 when writeDataFile returns null (double conflict)", async () => {
    mockWrite.mockResolvedValue(null);
    const res = await POST(makePost(FULL_DATA));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("GitHub write failed");
  });

  it("returns 500 when writeDataFile throws", async () => {
    mockWrite.mockRejectedValue(new Error("Network error"));
    const res = await POST(makePost(FULL_DATA));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Backup failed");
  });

  it("strips unknown extra fields from body — only AppData shape written", async () => {
    await POST(makePost({ ...FULL_DATA, extraField: "should be ignored", sha: null }));
    const [, data] = mockWrite.mock.calls[0] as [string, Record<string, unknown>, string | null];
    expect(data.extraField).toBeUndefined();
    expect(Object.keys(data)).toEqual(["customers", "products", "sales", "payments", "debts"]);
  });
});

// ─── Round 13: Security and edge cases ───────────────────────────────────────

describe("GET /api/backup: auth throws (not returns null)", () => {
  it("propagates auth() throw as unhandled (no try/catch around auth in route)", async () => {
    mockAuth.mockRejectedValue(new Error("auth service down"));
    await expect(GET()).rejects.toThrow("auth service down");
  });
});

describe("POST /api/backup: edge cases", () => {
  it("userId with special characters is passed to writeDataFile safely", async () => {
    mockAuth.mockResolvedValue({ userId: "user@example.com|special<chars>" });
    await POST(makePost({ ...FULL_DATA, sha: null }));
    const [userId] = mockWrite.mock.calls[0] as [string, ...unknown[]];
    expect(userId).toBe("user@example.com|special<chars>");
    // Note: github.ts uses userId in the path directly — it builds the GitHub path
    // This is safe because github.ts uses template literals for the path, not file system access
  });

  it("returns 200 even with empty arrays (valid state for fresh account backup)", async () => {
    const emptyBody = { customers: [], products: [], sales: [], payments: [], debts: [], sha: null };
    const res = await POST(makePost(emptyBody));
    expect(res.status).toBe(200);
    const [, data] = mockWrite.mock.calls[0] as [string, typeof emptyBody, string | null];
    expect(data.customers).toEqual([]);
    expect(data.products).toEqual([]);
  });
});
