import { describe, it, expect } from "vitest";
import { formatCurrency } from "@/lib/format";
import { formatCurrencyDisplay, parseCurrencyDisplay } from "@/lib/currencyInput";

describe("formatCurrency", () => {
  it("formats zero", () => {
    const result = formatCurrency(0);
    expect(result).toMatch(/0/);
  });

  it("formats a positive integer in TRY locale", () => {
    const result = formatCurrency(1000);
    expect(result).toMatch(/1[.,]000/);
    expect(result).toContain("₺");
  });

  it("formats large amount", () => {
    const result = formatCurrency(1500000);
    expect(result).toMatch(/1[.,]500[.,]000/);
  });
});

describe("formatCurrencyDisplay", () => {
  it("returns empty string for empty input", () => {
    expect(formatCurrencyDisplay("")).toBe("");
  });

  it("formats integer without decimal", () => {
    expect(formatCurrencyDisplay("1000")).toBe("1.000");
  });

  it("formats integer with comma decimal separator", () => {
    expect(formatCurrencyDisplay("1000,50")).toBe("1.000,50");
  });

  it("handles trailing dot as decimal separator start", () => {
    expect(formatCurrencyDisplay("1000.")).toBe("1.000,");
  });

  it("strips existing thousand separators before re-formatting", () => {
    expect(formatCurrencyDisplay("1.000")).toBe("1.000");
  });

  it("formats five-digit number", () => {
    expect(formatCurrencyDisplay("10000")).toBe("10.000");
  });

  it("truncates decimal to 2 places", () => {
    expect(formatCurrencyDisplay("100,999")).toBe("100,99");
  });
});

describe("parseCurrencyDisplay", () => {
  it("returns 0 for empty string", () => {
    expect(parseCurrencyDisplay("")).toBe(0);
  });

  it("returns 0 for bare comma", () => {
    expect(parseCurrencyDisplay(",")).toBe(0);
  });

  it("parses integer display", () => {
    expect(parseCurrencyDisplay("1.000")).toBe(1000);
  });

  it("parses decimal display", () => {
    expect(parseCurrencyDisplay("1.000,50")).toBe(1000.5);
  });

  it("round-trips with formatCurrencyDisplay for integer", () => {
    const display = formatCurrencyDisplay("2500");
    expect(parseCurrencyDisplay(display)).toBe(2500);
  });

  it("round-trips with formatCurrencyDisplay for decimal", () => {
    const display = formatCurrencyDisplay("2500,75");
    expect(parseCurrencyDisplay(display)).toBe(2500.75);
  });

  it("parses large formatted amount", () => {
    expect(parseCurrencyDisplay("1.500.000")).toBe(1500000);
  });
});
