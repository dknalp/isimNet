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