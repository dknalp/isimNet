/**
 * Formats a raw input string into Turkish currency display format.
 * "1000.5" → "1.000,5"   "10000,20" → "10.000,20"
 */
export function formatCurrencyDisplay(raw: string): string {
  if (!raw) return "";

  let intPart: string;
  let decPart: string | null = null;

  const commaIdx = raw.indexOf(",");

  if (commaIdx !== -1) {
    // Comma is the decimal separator
    intPart = raw.slice(0, commaIdx).replace(/\./g, "").replace(/\D/g, "");
    decPart = raw.slice(commaIdx + 1).replace(/\D/g, "").slice(0, 2);
  } else if (raw.endsWith(".")) {
    // User just typed a dot → treat as decimal separator start
    intPart = raw.slice(0, -1).replace(/\./g, "").replace(/\D/g, "");
    decPart = "";
  } else {
    // Integer only — strip all dots (they were thousand separators)
    intPart = raw.replace(/\./g, "").replace(/\D/g, "");
    decPart = null;
  }

  // Strip leading zeros (e.g. "007" → "7"), preserving single "0"
  const trimmedInt = intPart.replace(/^0+(?=\d)/, "");
  const formattedInt = trimmedInt
    ? trimmedInt.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    : "";

  return decPart !== null ? `${formattedInt},${decPart}` : formattedInt;
}

/** Parses a formatted display string back to a number. "1.000,50" → 1000.5 */
export function parseCurrencyDisplay(display: string): number {
  if (!display || display === ",") return 0;
  const normalized = display.replace(/\./g, "").replace(",", ".");
  return parseFloat(normalized) || 0;
}