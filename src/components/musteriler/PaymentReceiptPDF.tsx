"use client";

import dynamic from "next/dynamic";
import { Payment, Customer } from "@/lib/customers";
import { formatCurrency } from "@/lib/format";

// react-pdf requires dynamic import — no SSR
const PDFDownloadLink = dynamic(
  () => import("@react-pdf/renderer").then((m) => m.PDFDownloadLink),
  { ssr: false, loading: () => null }
);

import { Document, Page, Text, View, StyleSheet, Image, Font } from "@react-pdf/renderer";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "/fonts/Roboto-Regular.ttf", fontWeight: "normal" },
    { src: "/fonts/Roboto-Bold.ttf", fontWeight: "bold" },
  ],
});

const ONES = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"];
const TENS = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"];

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  let s = "";
  if (h === 1) s += "YÜZ";
  else if (h > 1) s += ONES[h] + " YÜZ";
  if (t) s += (s ? " " : "") + TENS[t];
  if (o) s += (s ? " " : "") + ONES[o];
  return s;
}

function amountToWords(amount: number): string {
  const total = Math.round(amount);
  if (total === 0) return "SIFIR";
  const billions = Math.floor(total / 1_000_000_000);
  const millions = Math.floor((total % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((total % 1_000_000) / 1_000);
  const remainder = total % 1_000;
  const parts: string[] = [];
  if (billions) parts.push(threeDigits(billions) + " MİLYAR");
  if (millions) parts.push(threeDigits(millions) + " MİLYON");
  if (thousands === 1) parts.push("BİN");
  else if (thousands > 1) parts.push(threeDigits(thousands) + " BİN");
  if (remainder) parts.push(threeDigits(remainder));
  return parts.join(" ") + " TÜRK LİRASI";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const METHOD_LABELS: Record<string, string> = {
  nakit: "Nakit",
  cek: "Çek",
  havale: "Havale / EFT",
  kredi_karti: "Kredi Kartı",
};

const s = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 10, padding: 36, backgroundColor: "#FFFFFF", color: "#111827" },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  logo: { width: 72, height: 72, objectFit: "contain" },
  titleBlock: { alignItems: "center" },
  title: { fontSize: 15, fontWeight: "bold", color: "#111827", letterSpacing: 1 },
  receiptNo: { fontSize: 8, color: "#6B7280", marginTop: 2 },
  dateBlock: { alignItems: "flex-end" },
  dateLabel: { fontSize: 8, color: "#6B7280" },
  dateValue: { fontSize: 10, fontWeight: "bold" },
  divider: { borderBottom: "1pt solid #E5E7EB", marginVertical: 10 },
  bodyText: { fontSize: 11, lineHeight: 1.8, marginBottom: 6 },
  bold: { fontWeight: "bold" },
  methodRow: { flexDirection: "row", gap: 8, marginVertical: 10 },
  methodBox: { borderRadius: 4, paddingVertical: 4, paddingHorizontal: 10, border: "1pt solid #E5E7EB", fontSize: 9 },
  methodBoxActive: { backgroundColor: "#059669", border: "1pt solid #059669" },
  methodTextActive: { color: "#FFFFFF", fontWeight: "bold" },
  methodText: { color: "#6B7280" },
  wordsBox: { backgroundColor: "#F0FDF4", borderRadius: 6, padding: "8pt 12pt", marginVertical: 8 },
  wordsText: { fontSize: 9, fontWeight: "bold", color: "#065F46" },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 24 },
  footerBlock: { alignItems: "center", flex: 1 },
  footerLabel: { fontSize: 8, color: "#6B7280", marginBottom: 16 },
  footerLine: { borderBottom: "0.5pt solid #9CA3AF", width: "80%" },
  footerName: { fontSize: 8, color: "#374151", marginTop: 4 },
});

interface Props {
  payment: Payment;
  customer: Customer;
  userName: string;
}

function ReceiptDocument({ payment, customer, userName }: Props) {
  const method = payment.method ?? "nakit";
  const methodLabel = METHOD_LABELS[method] ?? "Nakit";
  const allMethods: (keyof typeof METHOD_LABELS)[] = ["nakit", "cek", "havale", "kredi_karti"];

  return (
    <Document>
      <Page size="A5" style={s.page}>
        {/* Top row: logo | title | date */}
        <View style={s.topRow}>
          <Image src="/logo.png" style={s.logo} />
          <View style={s.titleBlock}>
            <Text style={s.title}>TAHSİLAT MAKBUZU</Text>
            <Text style={s.receiptNo}>No: #{payment.id.slice(-6).toUpperCase()}</Text>
          </View>
          <View style={s.dateBlock}>
            <Text style={s.dateLabel}>Tarih</Text>
            <Text style={s.dateValue}>{formatDate(payment.date)}</Text>
          </View>
        </View>

        <View style={s.divider} />

        {/* Body */}
        <Text style={s.bodyText}>
          Sayın <Text style={s.bold}>{customer.name}</Text>'dan{"\n"}
          <Text style={s.bold}>{formatCurrency(payment.amount)}</Text> bedeli olarak yalnız
        </Text>

        {/* Method checkboxes */}
        <View style={s.methodRow}>
          {allMethods.map((m) => (
            <View key={m} style={[s.methodBox, m === method ? s.methodBoxActive : {}]}>
              <Text style={m === method ? s.methodTextActive : s.methodText}>
                {m === method ? "✓ " : ""}{METHOD_LABELS[m]}
              </Text>
            </View>
          ))}
        </View>

        <Text style={s.bodyText}>tahsil edilmiştir.</Text>

        <View style={s.divider} />

        {/* Amount in words */}
        <View style={s.wordsBox}>
          <Text style={s.wordsText}>Yalnız: {amountToWords(payment.amount)}</Text>
        </View>

        <View style={s.divider} />

        {/* Description */}
        {payment.description ? (
          <Text style={{ fontSize: 9, color: "#374151", marginBottom: 4 }}>
            Açıklama: {payment.description}
          </Text>
        ) : null}

        {/* Footer */}
        <View style={s.footerRow}>
          <View style={s.footerBlock}>
            <Text style={s.footerLabel}>Teslim Eden</Text>
            <View style={s.footerLine} />
            <Text style={s.footerName}>{userName}</Text>
          </View>
          <View style={s.footerBlock}>
            <Text style={s.footerLabel}>Teslim Alan</Text>
            <View style={s.footerLine} />
            <Text style={s.footerName}>{customer.name}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export default function PaymentReceiptDownloadButton({ payment, customer, userName }: Props) {
  const fileName = `makbuz-${customer.name.replace(/\s+/g, "-")}-${payment.date.slice(0, 10)}.pdf`;

  return (
    <PDFDownloadLink
      document={<ReceiptDocument payment={payment} customer={customer} userName={userName} />}
      fileName={fileName}
    >
      {({ loading }) => (
        <button
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
          aria-label="Makbuz İndir"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {loading ? "Hazırlanıyor…" : "Makbuz"}
        </button>
      )}
    </PDFDownloadLink>
  );
}
