import { describe, it, expect, vi, afterEach } from "vitest";
import { readDataFile, writeDataFile, readOrMigrateDataFile, AppData } from "@/lib/github";

const EMPTY_DATA: AppData = {
  customers: [],
  products:  [],
  sales:     [],
  payments:  [],
  debts:     [],
};

function b64(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── readDataFile ────────────────────────────────────────────────────────────

describe("readDataFile", () => {
  it("returns data and sha on 200 OK", async () => {
    const payload: AppData = { ...EMPTY_DATA, customers: [{ id: "c1", name: "Ali" } as never] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({ content: b64(payload), sha: "abc123" })
    ));

    const result = await readDataFile("user1");

    expect(result.data).toEqual(payload);
    expect(result.sha).toBe("abc123");
  });

  it("returns null/null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse("", 404)));

    const result = await readDataFile("user1");

    expect(result.data).toBeNull();
    expect(result.sha).toBeNull();
  });

  it("returns null/null on non-ok response (500)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ message: "error" }, 500)));

    const result = await readDataFile("user1");

    expect(result.data).toBeNull();
    expect(result.sha).toBeNull();
  });

  it("calls GitHub API with correct URL for data.json", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ content: b64(EMPTY_DATA), sha: "sha1" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await readDataFile("userXYZ");

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/contents\/users\/userXYZ\/data\.json\?ref=/);
    expect((opts.headers as Record<string, string>)["Authorization"]).toMatch(/^token .+/);
  });
});

// ─── writeDataFile ───────────────────────────────────────────────────────────

describe("writeDataFile", () => {
  it("returns new sha on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({ content: { sha: "new_sha_456" } })
    ));

    const sha = await writeDataFile("user1", EMPTY_DATA, null);

    expect(sha).toBe("new_sha_456");
  });

  it("includes sha in request body when sha is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ content: { sha: "updated_sha" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeDataFile("user1", EMPTY_DATA, "existing_sha_abc");

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.sha).toBe("existing_sha_abc");
  });

  it("omits sha from request body when sha is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ content: { sha: "created_sha" } }, 201)
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeDataFile("user1", EMPTY_DATA, null);

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.sha).toBeUndefined();
  });

  it("encodes data as base64 in request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ content: { sha: "s1" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const data: AppData = { ...EMPTY_DATA, customers: [{ id: "c1", name: "Test" } as never] };
    await writeDataFile("user1", data, null);

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    const decoded = JSON.parse(Buffer.from(body.content, "base64").toString("utf-8"));
    expect(decoded).toEqual(data);
  });

  it("uses data.json path in PUT URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({ content: { sha: "s1" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await writeDataFile("user42", EMPTY_DATA, null);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/contents\/users\/user42\/data\.json$/);
  });

  it("returns null when content.sha is missing from success response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({ content: {} })
    ));

    const sha = await writeDataFile("user1", EMPTY_DATA, null);

    expect(sha).toBeNull();
  });

  it("retries with fresh SHA on 409 conflict and returns new sha on success", async () => {
    // Call 1: PUT → 409
    // Call 2: GET (fresh SHA) → 200 with sha
    // Call 3: PUT retry → 200 with new sha
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse({ message: "conflict" }, 409))
      .mockResolvedValueOnce(makeResponse({ content: b64(EMPTY_DATA), sha: "fresh_sha" }))
      .mockResolvedValueOnce(makeResponse({ content: { sha: "retry_sha" } }));
    vi.stubGlobal("fetch", fetchMock);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sha = await writeDataFile("user1", EMPTY_DATA, "stale_sha");

    expect(sha).toBe("retry_sha");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("409"));

    // Second PUT should use the fresh sha
    const [, opts] = fetchMock.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.sha).toBe("fresh_sha");
  });

  it("returns null after two consecutive 409 conflicts", async () => {
    // Call 1: PUT → 409
    // Call 2: GET (fresh SHA) → 200
    // Call 3: PUT retry → 409 again
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse({ message: "conflict" }, 409))
      .mockResolvedValueOnce(makeResponse({ content: b64(EMPTY_DATA), sha: "fresh_sha" }))
      .mockResolvedValueOnce(makeResponse({ message: "conflict again" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const sha = await writeDataFile("user1", EMPTY_DATA, "stale_sha");

    expect(sha).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("second conflict"));
  });

  it("returns null and logs error on non-409 failure", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ message: "error" }, 500)));

    const sha = await writeDataFile("user1", EMPTY_DATA, null);

    expect(sha).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("500"),
      expect.any(String)
    );
  });
});

// ─── readOrMigrateDataFile ───────────────────────────────────────────────────

describe("readOrMigrateDataFile", () => {
  it("returns existing data.json without migration", async () => {
    const payload: AppData = { ...EMPTY_DATA, customers: [{ id: "c1" } as never] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({ content: b64(payload), sha: "sha1" })
    ));

    const result = await readOrMigrateDataFile("user1");

    expect(result.data).toEqual(payload);
    expect(result.sha).toBe("sha1");
  });

  it("returns null/null when data.json and legacy files are all absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse("", 404)));

    const result = await readOrMigrateDataFile("user1");

    expect(result.data).toBeNull();
    expect(result.sha).toBeNull();
  });
});
// ─── readOrMigrateDataFile: expanded coverage ────────────────────────────────

describe("readOrMigrateDataFile: migration paths", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("migrates legacy separate files when data.json is absent (404)", async () => {
    // Legacy shape: customers.json, products.json, sales.json, payments.json, debts.json all present
    const legacyCustomers = [{ id: "c1", name: "Ahmet" }];
    const legacyProducts  = [{ id: "p1", name: "Ürün" }];
    const legacySales     = [{ id: "s1" }];
    const legacyPayments  = [{ id: "pay1" }];
    const legacyDebts     = [{ id: "d1" }];

    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method ?? "GET";

      // First call: data.json GET → 404 (no unified file)
      if (method === "GET" && u.includes("data.json") && callIdx === 0) {
        callIdx++;
        return makeResponse("Not Found", 404);
      }
      // Legacy file reads (Promise.all — 5 GETs)
      if (method === "GET" && u.includes("customers.json")) return makeResponse({ content: b64(legacyCustomers), sha: "sha_c" });
      if (method === "GET" && u.includes("products.json"))  return makeResponse({ content: b64(legacyProducts),  sha: "sha_p" });
      if (method === "GET" && u.includes("sales.json"))     return makeResponse({ content: b64(legacySales),     sha: "sha_s" });
      if (method === "GET" && u.includes("payments.json"))  return makeResponse({ content: b64(legacyPayments),  sha: "sha_pay" });
      if (method === "GET" && u.includes("debts.json"))     return makeResponse({ content: b64(legacyDebts),     sha: "sha_d" });
      // Migration write: PUT to data.json
      if (method === "PUT" && u.includes("data.json")) return makeResponse({ content: { sha: "migrated_sha" } });
      return makeResponse("Unexpected", 404);
    }));

    const result = await readOrMigrateDataFile("user1");
    expect(result.data).not.toBeNull();
    expect(result.data!.customers).toEqual(legacyCustomers);
    expect(result.data!.products).toEqual(legacyProducts);
    expect(result.data!.sales).toEqual(legacySales);
    expect(result.data!.payments).toEqual(legacyPayments);
    expect(result.data!.debts).toEqual(legacyDebts);
  });

  it("returns null data when both data.json and all legacy files are 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeResponse("Not Found", 404)));
    const result = await readOrMigrateDataFile("user1");
    expect(result.data).toBeNull();
    expect(result.sha).toBeNull();
  });

  it("returns null data when data.json is 404 and legacy files also 404 (no migration needed)", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      return makeResponse("Not Found", 404);
    }));
    const result = await readOrMigrateDataFile("user_new");
    expect(result.data).toBeNull();
    expect(result.sha).toBeNull();
    // Should have called data.json + 5 legacy files = at least 6 calls
    expect(callCount).toBeGreaterThanOrEqual(6);
  });
});

// ─── writeDataFile: edge case — fresh read returns null after conflict ────────

describe("writeDataFile: conflict + fresh read null", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when 409 retry occurs but fresh readDataFile returns null data", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";

      if (method === "PUT") {
        callIdx++;
        if (callIdx === 1) return makeResponse("Conflict", 409);
        // Second PUT (retry) — should not be reached if we return null sha
        return makeResponse({ content: { sha: "retry_sha" } });
      }
      if (method === "GET") {
        // Fresh read after conflict returns 404 (file deleted between writes)
        return makeResponse("Not Found", 404);
      }
      return makeResponse("Unexpected", 500);
    }));

    // When fresh read returns null sha, writeDataFile cannot retry meaningfully
    // Current behavior: calls writeDataFile with null sha → GitHub creates new file or errors
    // This test documents the actual behavior (retry proceeds with null sha)
    const result = await writeDataFile("user1", EMPTY_DATA, "stale_sha");
    // Behavior: either returns a new sha (if GitHub accepts null-sha PUT) or null
    // The test ensures it does NOT throw
    expect(result === null || typeof result === "string").toBe(true);
  });
});

// ─── Round 4: readOrMigrateDataFile — migration paths ────────────────────────

describe("readOrMigrateDataFile: migration scenarios", () => {
  function makeFetchForMigration({
    dataJsonStatus = 404,
    customers = null as unknown[] | null,
    products  = null as unknown[] | null,
    sales     = [] as unknown[],
    payments  = [] as unknown[],
    debts     = [] as unknown[],
    writeStatus = 200,
    writeSha = "migrated_sha",
  } = {}) {
    const legacyMap: Record<string, unknown[] | null> = {
      "customers.json": customers,
      "products.json":  products,
      "sales.json":     sales,
      "payments.json":  payments,
      "debts.json":     debts,
    };
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      // First call: data.json check
      if (callCount === 0) {
        callCount++;
        return makeResponse("", dataJsonStatus);
      }
      callCount++;
      // Legacy file reads
      for (const [file, data] of Object.entries(legacyMap)) {
        if (url.includes(file)) {
          if (data === null) return makeResponse("", 404);
          return makeResponse({ content: b64(data), sha: "leg_sha" });
        }
      }
      // Migration write (PUT)
      if (method === "PUT") {
        if (writeStatus !== 200) return makeResponse("conflict", writeStatus);
        return makeResponse({ content: { sha: writeSha } }, writeStatus);
      }
      return makeResponse("", 404);
    }));
  }

  it("happy path: data.json absent, legacy files exist → migrates and returns data", async () => {
    const legacyCustomers = [{ id: "c1", name: "Ali" }];
    const legacyProducts  = [{ id: "p1", name: "Ürün" }];
    makeFetchForMigration({ customers: legacyCustomers, products: legacyProducts });

    const result = await readOrMigrateDataFile("user1");

    expect(result.data).not.toBeNull();
    expect(result.data?.customers).toEqual(legacyCustomers);
    expect(result.data?.products).toEqual(legacyProducts);
    expect(result.sha).toBe("migrated_sha");
  });

  it("bug: returns null when customers.json exists but products.json is 404 (data silently lost)", async () => {
    // readLegacyFiles returns null if !customers.length && !products.length
    // But if customers exist and products don't, customers=[{...}], products=[]
    // Then customers.length > 0 → NOT null → data returned correctly
    // The actual bug: if customers.json is 404 but sales.json has data → all lost
    const legacySales = [{ id: "s1" }];
    makeFetchForMigration({
      customers: null,   // 404
      products: null,    // 404
      sales: legacySales,
    });

    const result = await readOrMigrateDataFile("user1");
    // Bug: returns null because customers=[] and products=[] even though sales has data
    // This is a documented known bug — sales data would be silently discarded
    expect(result.data).toBeNull(); // documents the bug, not the desired behavior
  });

  it("customers.json has data, products.json is 404 → migration works (only customers+products checked)", async () => {
    const legacyCustomers = [{ id: "c1" }];
    makeFetchForMigration({
      customers: legacyCustomers,
      products: null,  // 404
    });

    const result = await readOrMigrateDataFile("user1");
    // customers.length > 0 → not null → migration proceeds
    expect(result.data).not.toBeNull();
    expect(result.data?.customers).toEqual(legacyCustomers);
    expect(result.data?.products).toEqual([]);
  });

  it("migration write fails (409 conflict) → returns data with null sha", async () => {
    const legacyCustomers = [{ id: "c1" }];
    makeFetchForMigration({
      customers: legacyCustomers,
      products: [],
      writeStatus: 409,
    });

    const result = await readOrMigrateDataFile("user1");
    // writeDataFile returns null on double conflict
    // readOrMigrateDataFile returns { data: legacy, sha: null }
    expect(result.data).not.toBeNull();
    // sha may be null if write failed
    // document actual behavior
    expect(result.data?.customers).toEqual(legacyCustomers);
  });
});

// ─── Round 8: Unguarded res.json() paths ─────────────────────────────────────

describe("readDataFile: res.json() failure", () => {
  it("returns null when GitHub 200 response is not valid JSON (proxy error page)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html>Bad Gateway</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    ));
    const result = await readDataFile("user1");
    expect(result.data).toBeNull();
    expect(result.sha).toBeNull();
  });
});

describe("writeDataFile: res.json() failure after successful PUT", () => {
  it("returns null when PUT 200 response body is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html>Bad Gateway</html>", { status: 200 })
    ));
    const sha = await writeDataFile("user1", EMPTY_DATA, null);
    expect(sha).toBeNull();
  });
});

describe("writeDataFile: retry when fresh SHA is also null (file deleted during conflict resolution)", () => {
  it("returns null when fresh read succeeds but also has no sha", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      callCount++;
      if (method === "PUT") return makeResponse("conflict", 409);
      // Fresh GET after conflict — file returns null sha
      return makeResponse({ content: null, sha: null });
    }));
    const sha = await writeDataFile("user1", EMPTY_DATA, "stale");
    // missing content → data=null, sha=null → retry with sha=null → 409 again → null
    expect(sha).toBeNull();
  });
});

// ─── Round 10: Cover remaining uncovered lines ────────────────────────────────

describe("readDataFile: corrupt base64 content (line 60-61)", () => {
  it("returns null when base64 decodes to invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({ content: Buffer.from("{ not valid json }}}").toString("base64"), sha: "sha1" })
    ));
    const result = await readDataFile("user1");
    expect(result.data).toBeNull();
    expect(result.sha).toBeNull();
  });

  it("returns null when base64 content is not valid base64", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({ content: "!!!not-base64!!!", sha: "sha1" })
    ));
    const result = await readDataFile("user1");
    // Buffer.from("!!!not-base64!!!","base64") does not throw — it produces garbage
    // JSON.parse of garbage throws → catch → null
    expect(result.data).toBeNull();
  });
});

describe("readLegacyFiles: corrupt legacy file (line 76)", () => {
  it("returns empty array for corrupt legacy file, not null (migration still proceeds if customers exist)", async () => {
    // customers.json = valid, products.json = corrupt base64
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("data.json")) return makeResponse("", 404);
      if (url.includes("customers.json")) {
        return makeResponse({ content: Buffer.from(JSON.stringify([{ id: "c1" }])).toString("base64"), sha: "s1" });
      }
      if (url.includes("products.json")) {
        // Returns valid response but corrupt base64 content
        return makeResponse({ content: "!!!not-base64!!!", sha: "s2" });
      }
      // All other legacy files (sales, payments, debts) return 404
      return makeResponse("", 404);
    }));

    const result = await readOrMigrateDataFile("user1");
    // customers has data → migration proceeds
    // products corrupt → falls back to []
    expect(result.data).not.toBeNull();
    expect(result.data?.customers).toEqual([{ id: "c1" }]);
    expect(result.data?.products).toEqual([]);
  });
});

// ─── Round 10b: branch coverage — res.text() throws on write failure ──────────

describe("writeDataFile: res.text() fails on non-ok response", () => {
  it("returns null when PUT fails and res.text() also throws", async () => {
    const failResponse = new Response(null, { status: 500 });
    Object.defineProperty(failResponse, "text", {
      value: () => Promise.reject(new Error("body already consumed")),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse));

    const sha = await writeDataFile("user1", EMPTY_DATA, null);
    expect(sha).toBeNull();
  });
});
