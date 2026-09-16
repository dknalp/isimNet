import { Customer } from "./customers";
import { Sale, Payment, Debt } from "./customers";
import { formatCurrency } from "./format";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function buildCustomerStatement(
  customer: Customer,
  sales: Sale[],
  payments: Payment[],
  debts: Debt[],
  currentDebt: number
): string {
  const lines: string[] = [];

  lines.push(`📋 *${customer.name}* — Hesap Özeti`);
  lines.push(`📅 ${formatDate(new Date().toISOString())}`);
  lines.push("─────────────────");

  const allItems = [
    ...sales.map((s) => ({ date: s.date, type: "sale" as const, data: s })),
    ...payments.map((p) => ({ date: p.date, type: "payment" as const, data: p })),
    ...debts.map((d) => ({ date: d.date, type: "debt" as const, data: d })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  for (const item of allItems) {
    if (item.type === "sale") {
      const s = item.data as Sale;
      lines.push(`🛒 ${formatDate(s.date)} — Satış: *${formatCurrency(s.total)}*`);
    } else if (item.type === "payment") {
      const p = item.data as Payment;
      const note = p.description ? ` (${p.description})` : "";
      lines.push(`✅ ${formatDate(p.date)} — Tahsilat: *${formatCurrency(p.amount)}*${note}`);
    } else {
      const d = item.data as Debt;
      const note = d.description ? ` (${d.description})` : "";
      lines.push(`📌 ${formatDate(d.date)} — Borç: *${formatCurrency(d.amount)}*${note}`);
    }
  }

  lines.push("─────────────────");

  if (currentDebt > 0) {
    lines.push(`💰 *Güncel Bakiye: ${formatCurrency(currentDebt)} borçlusunuz*`);
  } else if (currentDebt < 0) {
    lines.push(`💰 *Güncel Bakiye: ${formatCurrency(Math.abs(currentDebt))} alacaklısınız*`);
  } else {
    lines.push(`✔️ *Hesabınız sıfır*`);
  }

  lines.push("\nİşimNet ile gönderildi.");

  return lines.join("\n");
}

export function openWhatsAppStatement(
  phone: string | undefined,
  text: string
): void {
  const encoded = encodeURIComponent(text);
  const url = phone
    ? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
