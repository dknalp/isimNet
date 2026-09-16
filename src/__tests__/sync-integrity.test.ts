import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/localdb", () => ({
  readLocalData:  vi.fn(),
  writeLocalData: vi.fn(),
}));

import { GET, POST } from "@/app/api/sync/route";
import { auth } from "@/lib/auth";
import { readLocalData, writeLocalData } from "@/lib/localdb";
import type { Customer, Sale, Payment, Debt, SaleItem } from "@/lib/customers";
import type { Product } from "@/lib/products";
import type { AppData } from "@/lib/github";

const mockAuth  = auth          as ReturnType<typeof vi.fn>;
const mockRead  = readLocalData  as ReturnType<typeof vi.fn>;
const mockWrite = writeLocalData as ReturnType<typeof vi.fn>;

// ── Sabitler ──────────────────────────────────────────────────────────────────

const COUNTS = {
  customers: 100,
  products:  150,
  debts:     100,
  payments:  110,
  sales:     150,
};

const NOW = "2026-07-15T12:00:00.000Z";

// ── Veri üretimi ──────────────────────────────────────────────────────────────

function makeCustomers(): Customer[] {
  return Array.from({ length: COUNTS.customers }, (_, i) => ({
    id:        `c_${i + 1}`,
    name:      `Müşteri ${i + 1}`,
    phone:     `555-${String(i + 1).padStart(4, "0")}`,
    note:      i % 5 === 0 ? `Not ${i + 1}` : undefined,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

function makeProducts(): Product[] {
  return Array.from({ length: COUNTS.products }, (_, i) => ({
    id:          `p_${i + 1}`,
    name:        `Ürün ${i + 1}`,
    description: `Açıklama ${i + 1}`,
    price:       (i + 1) * 10,
    stock:       (i % 50) + 1,
    createdAt:   NOW,
    updatedAt:   NOW,
  }));
}

function makeDebts(customers: Customer[]): Debt[] {
  return Array.from({ length: COUNTS.debts }, (_, i) => ({
    id:          `d_${i + 1}`,
    customerId:  customers[i % customers.length].id,
    date:        NOW,
    amount:      (i + 1) * 25,
    description: `Borç ${i + 1}`,
  }));
}

function makePayments(customers: Customer[]): Payment[] {
  return Array.from({ length: COUNTS.payments }, (_, i) => ({
    id:          `pay_${i + 1}`,
    customerId:  customers[i % customers.length].id,
    date:        NOW,
    amount:      (i + 1) * 15,
    description: `Tahsilat ${i + 1}`,
  }));
}

function makeSales(customers: Customer[], products: Product[]): Sale[] {
  const vatRates: (0 | 10 | 20)[] = [0, 10, 20];
  return Array.from({ length: COUNTS.sales }, (_, i) => {
    const itemCount = (i % 3) + 1;
    const items: SaleItem[] = Array.from({ length: itemCount }, (_, j) => {
      const prod = products[(i * 3 + j) % products.length];
      return {
        productId:   prod.id,
        productName: prod.name,
        quantity:    j + 1,
        unitPrice:   prod.price,
      };
    });
    const vatRate  = vatRates[i % 3];
    const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
    const vatAmount = Math.round(subtotal * vatRate / 100);
    return {
      id:         `s_${i + 1}`,
      customerId: customers[i % customers.length].id,
      date:       NOW,
      items,
      vatRate,
      subtotal,
      vatAmount,
      total: subtotal + vatAmount,
    };
  });
}

// ── Veri seti ─────────────────────────────────────────────────────────────────

const customers = makeCustomers();
const products  = makeProducts();
const debts     = makeDebts(customers);
const payments  = makePayments(customers);
const sales     = makeSales(customers, products);
const inputData: AppData = { customers, products, debts, payments, sales };

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Sync Integrity — 100 müşteri, 150 ürün, 100 borç, 110 tahsilat, 150 satış", () => {
  // capturedData: writeLocalData'ya iletilen veriler
  let capturedData: AppData | null = null;
  let writeCallCount = 0;

  beforeAll(async () => {
    capturedData  = null;
    writeCallCount = 0;

    mockAuth.mockResolvedValue({ userId: "sim_user_1" });

    // writeLocalData çağrısını yakala — gönderilen verinin kopyasını sakla
    mockWrite.mockImplementation((_userId: string, data: AppData) => {
      writeCallCount++;
      capturedData = JSON.parse(JSON.stringify(data)) as AppData;
      return Promise.resolve();
    });

    // GET'in döneceği veriyi hazırla (round-trip testi için)
    mockRead.mockImplementation(() => {
      return Promise.resolve(capturedData);
    });

    const req = new NextRequest("http://localhost/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputData),
    });

    const res = await POST(req);
    if (res.status !== 200) {
      const err = await res.text();
      throw new Error(`POST /api/sync başarısız [${res.status}]: ${err}`);
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ── Sayısal doğruluk ──────────────────────────────────────────────────────

  it(`müşteri: beklenen ${COUNTS.customers}, gönderilen ${COUNTS.customers}`, () => {
    expect(capturedData?.customers).toHaveLength(COUNTS.customers);
  });

  it(`ürün: beklenen ${COUNTS.products}, gönderilen ${COUNTS.products}`, () => {
    expect(capturedData?.products).toHaveLength(COUNTS.products);
  });

  it(`borç: beklenen ${COUNTS.debts}, gönderilen ${COUNTS.debts}`, () => {
    expect(capturedData?.debts).toHaveLength(COUNTS.debts);
  });

  it(`tahsilat: beklenen ${COUNTS.payments}, gönderilen ${COUNTS.payments}`, () => {
    expect(capturedData?.payments).toHaveLength(COUNTS.payments);
  });

  it(`satış: beklenen ${COUNTS.sales}, gönderilen ${COUNTS.sales}`, () => {
    expect(capturedData?.sales).toHaveLength(COUNTS.sales);
  });

  // ── ID bütünlüğü ──────────────────────────────────────────────────────────

  it("tüm müşteri ID'leri eksiksiz aktarılmalı", () => {
    const sentIds  = new Set(capturedData?.customers.map(c => c.id) ?? []);
    const inputIds = customers.map(c => c.id);
    const missing  = inputIds.filter(id => !sentIds.has(id));
    expect(missing, `Eksik müşteri ID'leri: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("tüm ürün ID'leri eksiksiz aktarılmalı", () => {
    const sentIds  = new Set(capturedData?.products.map(p => p.id) ?? []);
    const inputIds = products.map(p => p.id);
    const missing  = inputIds.filter(id => !sentIds.has(id));
    expect(missing, `Eksik ürün ID'leri: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("tüm borç ID'leri eksiksiz aktarılmalı", () => {
    const sentIds  = new Set(capturedData?.debts.map(d => d.id) ?? []);
    const inputIds = debts.map(d => d.id);
    const missing  = inputIds.filter(id => !sentIds.has(id));
    expect(missing, `Eksik borç ID'leri: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("tüm tahsilat ID'leri eksiksiz aktarılmalı", () => {
    const sentIds  = new Set(capturedData?.payments.map(p => p.id) ?? []);
    const inputIds = payments.map(p => p.id);
    const missing  = inputIds.filter(id => !sentIds.has(id));
    expect(missing, `Eksik tahsilat ID'leri: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("tüm satış ID'leri eksiksiz aktarılmalı", () => {
    const sentIds  = new Set(capturedData?.sales.map(s => s.id) ?? []);
    const inputIds = sales.map(s => s.id);
    const missing  = inputIds.filter(id => !sentIds.has(id));
    expect(missing, `Eksik satış ID'leri: ${missing.join(", ")}`).toHaveLength(0);
  });

  // ── Referans bütünlüğü ────────────────────────────────────────────────────

  it("satışlardaki customerId'ler geçerli müşterilere işaret etmeli", () => {
    const custIds = new Set(capturedData?.customers.map(c => c.id) ?? []);
    const invalid = (capturedData?.sales ?? []).filter(s => !custIds.has(s.customerId));
    expect(invalid).toHaveLength(0);
  });

  it("satışlardaki productId'ler geçerli ürünlere işaret etmeli", () => {
    const prodIds = new Set(capturedData?.products.map(p => p.id) ?? []);
    const invalid = (capturedData?.sales ?? [])
      .flatMap(s => s.items)
      .filter(it => !prodIds.has(it.productId));
    expect(invalid).toHaveLength(0);
  });

  // ── Yazma sayısı ──────────────────────────────────────────────────────────

  it("writeLocalData tam olarak 1 kez çağrılmalı (atomik yazma)", () => {
    expect(writeCallCount).toBe(1);
  });

  // ── Round-trip doğruluğu ──────────────────────────────────────────────────

  it("GET ile geri okunan kayıt sayıları yazılanla eşleşmeli", async () => {
    const res  = await GET();
    const body = await res.json() as AppData;
    expect(body.customers).toHaveLength(COUNTS.customers);
    expect(body.products).toHaveLength(COUNTS.products);
    expect(body.debts).toHaveLength(COUNTS.debts);
    expect(body.payments).toHaveLength(COUNTS.payments);
    expect(body.sales).toHaveLength(COUNTS.sales);
  });

  it("GET ile geri okunan veriler içerik olarak yazılanla birebir eşleşmeli", async () => {
    const res  = await GET();
    const body = await res.json() as AppData;
    expect(body).toEqual(capturedData);
  });

  // ── Tanı ──────────────────────────────────────────────────────────────────

  it("Tanı: eksik kayıt varsa hangileri ve olası sebep raporla", () => {
    const checks = [
      { key: "customers", sent: capturedData?.customers.map(c => c.id) ?? [], input: customers.map(c => c.id) },
      { key: "products",  sent: capturedData?.products.map(p => p.id)  ?? [], input: products.map(p => p.id)  },
      { key: "debts",     sent: capturedData?.debts.map(d => d.id)     ?? [], input: debts.map(d => d.id)     },
      { key: "payments",  sent: capturedData?.payments.map(p => p.id)  ?? [], input: payments.map(p => p.id)  },
      { key: "sales",     sent: capturedData?.sales.map(s => s.id)     ?? [], input: sales.map(s => s.id)     },
    ];
    const violations: string[] = [];
    for (const { key, sent, input } of checks) {
      const sentSet = new Set(sent);
      const missing = input.filter(id => !sentSet.has(id));
      if (missing.length > 0) {
        violations.push(key);
        console.error(
          `[${key}]\n  Eksik (${missing.length}): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` (+${missing.length - 10} daha)` : ""}\n  Olası sebep: payload truncation veya JSON serializasyon hatası`
        );
      }
    }
    if (violations.length > 0) {
      console.error(`\n=== SYNC INTEGRITY RAPORU — VERİ KAYBI TESPİT EDİLDİ ===\nİhlaller: ${violations.join(", ")}\n===========================================================\n`);
    }
    expect(violations, `Veri bütünlüğü ihlali: ${violations.join(", ")}`).toHaveLength(0);
  });
});
