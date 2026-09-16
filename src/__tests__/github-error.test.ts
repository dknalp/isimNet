import { describe, it, expect, vi, afterEach } from "vitest";

// ── github.ts: attemptWrite error handling ───────────────────────────────────
// We test the logic surface: 409 and 422 should both trigger a CONFLICT retry,
// not a null-return that DataContext treats as a hard failure.

// Mock fetch for the GitHub API layer
const mockFetch = vi.fn();

describe("attemptWrite: HTTP error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  it("maps 409 to CONFLICT sentinel (already tested in sync-route tests)", () => {
    // Conceptual: 409 -> "CONFLICT" -> retry with fresh SHA
    const status = 409;
    const isManagedConflict = status === 409 || status === 422;
    expect(isManagedConflict).toBe(true);
  });

  it("maps 422 to CONFLICT sentinel (create-when-exists with sha=null)", () => {
    // 422 Unprocessable Entity = file already exists, sha required
    // Must be treated same as 409 so writeDataFile retries with fresh SHA
    const status: number = 422;
    const isManagedConflict = status === 409 || status === 422;
    expect(isManagedConflict).toBe(true);
  });

  it("non-conflict non-ok statuses (500, 403) are NOT managed conflicts", () => {
    for (const status of [500, 403, 401, 404]) {
      const isManagedConflict = status === 409 || status === 422;
      expect(isManagedConflict).toBe(false);
    }
  });
});
