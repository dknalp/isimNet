import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir:    vi.fn(),
    rename:   vi.fn(),
    unlink:   vi.fn(),
  },
}));

import fs from "node:fs/promises";
import { readLocalData, writeLocalData } from "@/lib/localdb";
import type { AppData } from "@/lib/github";

const mockFs = fs as unknown as {
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  mkdir:    ReturnType<typeof vi.fn>;
  rename:   ReturnType<typeof vi.fn>;
  unlink:   ReturnType<typeof vi.fn>;
};

const EMPTY: AppData = { customers: [], products: [], sales: [], payments: [], debts: [] };
const SAMPLE: AppData = {
  customers: [{ id: "c1", name: "A", createdAt: "2024-01-01", updatedAt: "2024-01-01" }],
  products:  [{ id: "p1", name: "X", description: "", price: 10, stock: 5, createdAt: "2024-01-01", updatedAt: "2024-01-01" }],
  sales: [], payments: [], debts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
  mockFs.rename.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
});

// ─── readLocalData ────────────────────────────────────────────────────────────

describe("readLocalData", () => {
  it("returns parsed AppData when file exists and is valid", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify(SAMPLE));
    expect(await readLocalData("u1")).toEqual(SAMPLE);
  });

  it("returns null on ENOENT (file does not exist)", async () => {
    mockFs.readFile.mockRejectedValue(Object.assign(new Error(), { code: "ENOENT" }));
    expect(await readLocalData("u1")).toBeNull();
  });

  it("returns null when file contains corrupt JSON", async () => {
    mockFs.readFile.mockResolvedValue("{ not json }}}");
    expect(await readLocalData("u1")).toBeNull();
  });

  it("returns null when file is valid JSON but null (not AppData shape)", async () => {
    mockFs.readFile.mockResolvedValue("null");
    expect(await readLocalData("u1")).toBeNull();
  });

  it("returns null when file is valid JSON array (not AppData object)", async () => {
    mockFs.readFile.mockResolvedValue("[1,2,3]");
    expect(await readLocalData("u1")).toBeNull();
  });

  it("returns null when file is a number", async () => {
    mockFs.readFile.mockResolvedValue("42");
    expect(await readLocalData("u1")).toBeNull();
  });

  it("returns null when AppData is missing required array fields", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ customers: [], products: [] }));
    expect(await readLocalData("u1")).toBeNull();
  });

  it("returns null when customers field is not an array", async () => {
    const bad = { ...EMPTY, customers: { id: "c1" } };
    mockFs.readFile.mockResolvedValue(JSON.stringify(bad));
    expect(await readLocalData("u1")).toBeNull();
  });

  it("returns null on unexpected fs error (EACCES)", async () => {
    mockFs.readFile.mockRejectedValue(Object.assign(new Error(), { code: "EACCES" }));
    expect(await readLocalData("u1")).toBeNull();
  });

  it("passes userId through SHA-256 — different userIds give different paths", async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify(EMPTY));
    await readLocalData("userA");
    await readLocalData("userB");
    const [pathA] = mockFs.readFile.mock.calls[0] as [string];
    const [pathB] = mockFs.readFile.mock.calls[1] as [string];
    expect(pathA).not.toBe(pathB);
  });
});

// ─── writeLocalData ───────────────────────────────────────────────────────────

describe("writeLocalData", () => {
  it("calls mkdir, writeFile (to .tmp), then rename atomically", async () => {
    await writeLocalData("u1", SAMPLE);
    expect(mockFs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(mockFs.rename).toHaveBeenCalledTimes(1);

    const [tmpPath] = mockFs.writeFile.mock.calls[0] as [string, string, string];
    const [from, to] = mockFs.rename.mock.calls[0] as [string, string];
    expect(tmpPath).toBe(from);
    expect(tmpPath).toMatch(/\.tmp\.[0-9a-f]{16}$/);
    expect(to).not.toMatch(/\.tmp$/);
  });

  it("serializes data as JSON to tmp file", async () => {
    await writeLocalData("u1", SAMPLE);
    const [, content] = mockFs.writeFile.mock.calls[0] as [string, string, string];
    expect(JSON.parse(content)).toEqual(SAMPLE);
  });

  it("cleans up .tmp file when rename fails, then rethrows", async () => {
    const renameErr = new Error("EXDEV");
    mockFs.rename.mockRejectedValue(renameErr);
    await expect(writeLocalData("u1", EMPTY)).rejects.toThrow("EXDEV");
    // unlink called on the tmp path
    expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    const [tmpPath] = mockFs.writeFile.mock.calls[0] as [string];
    const [unlinkPath] = mockFs.unlink.mock.calls[0] as [string];
    expect(unlinkPath).toBe(tmpPath);
  });

  it("throws original error even when unlink also fails (no swallow)", async () => {
    mockFs.rename.mockRejectedValue(new Error("rename-err"));
    mockFs.unlink.mockRejectedValue(new Error("unlink-err"));
    await expect(writeLocalData("u1", EMPTY)).rejects.toThrow("rename-err");
  });

  it("rethrows when mkdir fails", async () => {
    mockFs.mkdir.mockRejectedValue(new Error("EPERM"));
    await expect(writeLocalData("u1", EMPTY)).rejects.toThrow("EPERM");
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it("different userIds produce different target paths (SHA-256 isolation)", async () => {
    await writeLocalData("user1", EMPTY);
    await writeLocalData("user2", EMPTY);
    const path1 = (mockFs.rename.mock.calls[0] as [string, string])[1];
    const path2 = (mockFs.rename.mock.calls[1] as [string, string])[1];
    expect(path1).not.toBe(path2);
  });

  it("userId with path traversal maps to safe sha256 hex filename, not a path escape", async () => {
    await writeLocalData("../../etc/passwd", EMPTY);
    const [, to] = mockFs.rename.mock.calls[0] as [string, string];
    expect(to).not.toContain("..");
    expect(to).not.toContain("etc");
    expect(to).toMatch(/[a-f0-9]{64}\.json$/);
  });

  it("same userId always maps to same filename (deterministic)", async () => {
    await writeLocalData("stable-user", EMPTY);
    await writeLocalData("stable-user", EMPTY);
    const path1 = (mockFs.rename.mock.calls[0] as [string, string])[1];
    const path2 = (mockFs.rename.mock.calls[1] as [string, string])[1];
    expect(path1).toBe(path2);
  });
});
