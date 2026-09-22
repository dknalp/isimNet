"use client";

import dynamic from "next/dynamic";
import { Sale, Customer } from "@/lib/customers";
import { formatCurrency } from "@/lib/format";

// react-pdf requires dynamic import — no SSR
const PDFDownloadLink = dynamic(
  () => import("@react-pdf/renderer").then((m) => m.PDFDownloadLink),
  { ssr: false, loading: () => null }
);

import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

Font.register({
  family: "Roboto",
  fonts: [
    { src: "/fonts/Roboto-Regular.ttf", fontWeight: "normal" },
    { src: "/fonts/Roboto-Bold.ttf", fontWeight: "bold" },
  ],
});

const styles = StyleSheet.create({
  page: {
    fontFamily: "Roboto",
    fontSize: 10,
    padding: 32,
    backgroundColor: "#FFFFFF",
    color: "#111827",
  },
  header: { marginBottom: 20 },
  title: { fontSize: 18, fontWeight: "bold", marginBottom: 4, color: "#4F46E5" },
  subtitle: { fontSize: 10, color: "#6B7280" },
  divider: { borderBottom: "1pt solid #E5E7EB", marginVertical: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { color: "#6B7280" },
  value: { fontWeight: "bold" },
  table: { marginTop: 8 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    padding: "4pt 6pt",
    borderRadius: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    padding: "3pt 6pt",
    borderBottom: "0.5pt solid #F3F4F6",
  },
  col1: { flex: 3 },
  col2: { flex: 1, textAlign: "right" },
  col3: { flex: 1, textAlign: "right" },
  col4: { flex: 1.5, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    padding: "6pt 6pt",
    backgroundColor: "#EEF2FF",
    borderRadius: 4,
  },
  totalLabel: { fontSize: 11, fontWeight: "bold", marginRight: 16, color: "#4F46E5" },
  totalValue: { fontSize: 11, fontWeight: "bold", color: "#4F46E5" },
  footer: { marginTop: 24, fontSize: 8, color: "#9CA3AF", textAlign: "center" },
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

interface Props {
  sale: Sale;
  customer: Customer;
}

function ReceiptDocument({ sale, customer }: Props) {
  const vatLabel = sale.vatRate === 0 ? "KDV'siz" : `KDV %${sale.vatRate}`;

  return (
    <Document>
      <Page size="A5" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>İşimNet</Text>
          <Text style={styles.subtitle}>Satış Fişi</Text>
        </View>

        <View style={styles.divider} />

        {/* Meta */}
        <View style={styles.row}>
          <Text style={styles.label}>Müşteri</Text>
          <Text style={styles.value}>{customer.name}</Text>
        </View>
        {customer.phone && (
          <View style={styles.row}>
            <Text style={styles.label}>Telefon</Text>
            <Text>{customer.phone}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.label}>Tarih</Text>
          <Text>{formatDate(sale.date)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Fiş No</Text>
          <Text style={{ fontSize: 8, color: "#9CA3AF" }}>{sale.id}</Text>
        </View>

        <View style={styles.divider} />

        {/* Items table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.col1, { fontWeight: "bold" }]}>Ürün</Text>
            <Text style={[styles.col2, { fontWeight: "bold" }]}>Adet</Text>
            <Text style={[styles.col3, { fontWeight: "bold" }]}>Birim</Text>
            <Text style={[styles.col4, { fontWeight: "bold" }]}>Tutar</Text>
          </View>
          {sale.items.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.col1}>{item.productName}</Text>
              <Text style={styles.col2}>{item.quantity}</Text>
              <Text style={styles.col3}>{formatCurrency(item.unitPrice)}</Text>
              <Text style={styles.col4}>{formatCurrency(item.unitPrice * item.quantity)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {/* Totals */}
        <View style={styles.row}>
          <Text style={styles.label}>Ara Toplam</Text>
          <Text>{formatCurrency(sale.subtotal)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{vatLabel}</Text>
          <Text>{formatCurrency(sale.vatAmount)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOPLAM</Text>
          <Text style={styles.totalValue}>{formatCurrency(sale.total)}</Text>
        </View>

        <Text style={styles.footer}>
          Bu fiş İşimNet tarafından oluşturulmuştur. • {formatDate(new Date().toISOString())}
        </Text>
      </Page>
    </Document>
  );
}

export default function SaleReceiptDownloadButton({ sale, customer }: Props) {
  const fileName = `fis-${customer.name.replace(/\s+/g, "-")}-${sale.date.slice(0, 10)}.pdf`;

  return (
    <PDFDownloadLink
      document={<ReceiptDocument sale={sale} customer={customer} />}
      fileName={fileName}
    >
      {({ loading }) => (
        <button
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50"
          aria-label="PDF Fişi İndir"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {loading ? "Hazırlanıyor…" : "PDF Fiş"}
        </button>
      )}
    </PDFDownloadLink>
  );
}
