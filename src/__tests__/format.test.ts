import { describe, it, expect } from "vitest";
import { formatCurrency } from "@/lib/format";
import { formatCurrencyDisplay, parseCurrencyDisplay } from "@/lib/currencyInput";

// ─── formatCurrency ───────────────────────────────────────────────────────────

describe("formatCurrency", () => {
  it("formats positive integer in Turkish locale with TRY symbol", () => {
    expect(formatCurrency(1000)).toContain("1.000");
  });

  it("formats zero as ₺0", () => {
    expect(formatCurrency(0)).toMatch(/₺\s*0|0\s*₺/);
  });

  it("formats large number with correct thousand separators", () => {
    const result = formatCurrency(1_000_000);
    expect(result).toContain("1.000.000");
  });

  it("rounds fractional amounts to whole number (no decimals)", () => {
    const result = formatCurrency(99.9);
    expect(result).not.toContain(",");
    expect(result).not.toContain(".");
  });

  it("handles negative numbers", () => {
    const result = formatCurrency(-500);
    expect(result).toContain("500");
  });
});

// ─── formatCurrencyDisplay ────────────────────────────────────────────────────

describe("formatCurrencyDisplay", () => {
  it("returns empty string for empty input", () => {
    expect(formatCurrencyDisplay("")).toBe("");
  });

  it("formats integer with thousand separator", () => {
    expect(formatCurrencyDisplay("1000")).toBe("1.000");
  });

  it("formats large number correctly", () => {
    expect(formatCurrencyDisplay("1000000")).toBe("1.000.000");
  });

  it("handles comma as decimal separator", () => {
    expect(formatCurrencyDisplay("1000,50")).toBe("1.000,50");
  });

  it("truncates decimal to 2 places", () => {
    expect(formatCurrencyDisplay("100,999")).toBe("100,99");
  });

  it("handles trailing dot (user in process of typing decimal)", () => {
    expect(formatCurrencyDisplay("1000.")).toBe("1.000,");
  });

  it("strips leading zeros from integer part", () => {
    // formatCurrencyDisplay uses regex that strips dots/non-digits but not leading zeros
    // Input '007' → intPart '007' → trimmed '7' → formatted '7'
    expect(formatCurrencyDisplay("007")).toBe("7");
  });

  it("handles zero", () => {
    expect(formatCurrencyDisplay("0")).toBe("0");
  });

  it("handles already-formatted input with thousand dots", () => {
    // "1.000" → strips the dot as thousand separator → "1000" → "1.000"
    expect(formatCurrencyDisplay("1.000")).toBe("1.000");
  });

  it("handles decimal with no integer part (comma first)", () => {
    const result = formatCurrencyDisplay(",50");
    expect(result).toBe(",50");
  });
});

// ─── parseCurrencyDisplay ─────────────────────────────────────────────────────

describe("parseCurrencyDisplay", () => {
  it("parses standard Turkish formatted number", () => {
    expect(parseCurrencyDisplay("1.000,50")).toBe(1000.5);
  });

  it("parses integer string with thousand separator", () => {
    expect(parseCurrencyDisplay("1.000")).toBe(1000);
  });

  it("returns 0 for empty string", () => {
    expect(parseCurrencyDisplay("")).toBe(0);
  });

  it("returns 0 for comma-only string", () => {
    expect(parseCurrencyDisplay(",")).toBe(0);
  });

  it("returns 0 for non-numeric string", () => {
    expect(parseCurrencyDisplay("abc")).toBe(0);
  });

  it("handles simple integer string", () => {
    expect(parseCurrencyDisplay("500")).toBe(500);
  });

  it("round-trips: formatCurrencyDisplay → parseCurrencyDisplay", () => {
    const original = 1234.5;
    const formatted = formatCurrencyDisplay(original.toString().replace(".", ","));
    const parsed = parseCurrencyDisplay(formatted);
    expect(parsed).toBe(original);
  });

  it("round-trips large integer", () => {
    const formatted = formatCurrencyDisplay("1000000");
    expect(parseCurrencyDisplay(formatted)).toBe(1000000);
  });

  it("parses two decimal places correctly", () => {
    expect(parseCurrencyDisplay("9.999,99")).toBeCloseTo(9999.99, 5);
  });

  it("returns 0 for whitespace string", () => {
    expect(parseCurrencyDisplay("   ")).toBe(0);
  });
});
