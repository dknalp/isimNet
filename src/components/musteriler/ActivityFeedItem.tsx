"use client";

import { useState } from "react";
import { BsDatabaseFillDash } from "react-icons/bs";
import { ActivityItem, Sale, Payment, Debt, Customer } from "@/lib/customers";
import SaleReceiptDownloadButton from "./SaleReceiptPDF";
import PaymentReceiptDownloadButton from "./PaymentReceiptPDF";
import { formatCurrency } from "@/lib/format";
import { useData } from "@/context/DataContext";
import { useSession } from "next-auth/react";

interface ActivityFeedItemProps {
  item: ActivityItem;
  onEdit?: (item: ActivityItem) => void;
  customer?: Customer;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ActivityFeedItem({ item, onEdit, customer }: ActivityFeedItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { deleteSale, deletePayment, deleteDebt } = useData();
  const { data: session } = useSession();

  const isSale    = item.type === "sale";
  const isPayment = item.type === "payment";
  const isDebt    = item.type === "debt";
  const sale    = isSale    ? (item.data as Sale)    : null;
  const payment = isPayment ? (item.data as Payment) : null;
  const debt    = isDebt    ? (item.data as Debt)    : null;

  const tutar = isSale ? sale!.total : isPayment ? payment!.amount : debt!.amount;
  const tutarRenk = isSale ? "#4F46E5" : isPayment ? "#059669" : "#EA580C";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setIsOpen((o) => !o)}
      onKeyDown={(e) => e.key === "Enter" && setIsOpen((o) => !o)}
      className="bg-white rounded-2xl p-4 w-full text-left transition-all active:scale-[0.98] cursor-pointer"
      style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.07)" }}
    >
      {/* Collapsed satır */}
      <div className="flex items-center gap-3">
        {/* İkon */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: isSale ? "#EEF2FF" : isPayment ? "#ECFDF5" : "#FFF7ED" }}
        >
          {isSale && (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="#4F46E5" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z" />
            </svg>
          )}
          {isPayment && (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="#059669" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
            </svg>
          )}
          {isDebt && <BsDatabaseFillDash size={20} color="#EA580C" />}
        </div>

        {/* Orta: tip + tarih */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm">{isSale ? "Satış" : isPayment ? "Tahsilat" : "Borç"}</p>
          <p className="text-gray-400 text-xs mt-0.5">{formatShortDate(item.date)}</p>
        </div>

        {/* Sağ: tutar + chevron */}
        <div className="flex items-center gap-2 shrink-0">
          <p className="font-semibold text-sm" style={{ color: tutarRenk }}>
            {formatCurrency(tutar)}
          </p>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.2}
            stroke="#94A3B8"
            className="w-4 h-4 transition-transform"
            style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </div>

      {/* Expanded detay */}
      {isOpen && (
        <div className="border-t border-gray-100 mt-3 pt-3 flex flex-col gap-1.5">
          {isSale && sale && (
            <>
              {/* Ürün satırları */}
              {sale.items.map((si, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-500">{si.productName} ×{si.quantity} ({formatCurrency(si.unitPrice)}/adet)</span>
                  <span className="font-medium text-gray-900 ml-2 shrink-0">{formatCurrency(si.quantity * si.unitPrice)}</span>
                </div>
              ))}

              {/* Ara toplam */}
              <div className="flex justify-between text-sm border-t border-gray-100 pt-1.5 mt-1">
                <span className="text-gray-400">Ara Toplam</span>
                <span className="text-gray-700">{formatCurrency(sale.subtotal)}</span>
              </div>

              {/* KDV */}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">KDV %{sale.vatRate}</span>
                <span style={{ color: "#D97706" }}>+{formatCurrency(sale.vatAmount)}</span>
              </div>

              {/* Toplam */}
              <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-1.5 mt-1">
                <span className="text-gray-900">Toplam</span>
                <span style={{ color: "#4F46E5" }}>{formatCurrency(sale.total)}</span>
              </div>
            </>
          )}

          {isPayment && payment && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Tutar</span>
                <span className="font-bold" style={{ color: "#059669" }}>{formatCurrency(payment.amount)}</span>
              </div>
              {payment.description && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Açıklama</span>
                  <span className="text-gray-700 text-right ml-4">{payment.description}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Tarih & Saat</span>
                <span className="text-gray-700">{formatDateTime(payment.date)}</span>
              </div>
            </>
          )}

          {isDebt && debt && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Tutar</span>
                <span className="font-bold" style={{ color: "#EA580C" }}>{formatCurrency(debt.amount)}</span>
              </div>
              {debt.description && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Açıklama</span>
                  <span className="text-gray-700 text-right ml-4">{debt.description}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Tarih & Saat</span>
                <span className="text-gray-700">{formatDateTime(debt.date)}</span>
              </div>
            </>
          )}

          {/* Düzenle / Sil butonları */}
          <div className="mt-3 pt-2 border-t border-gray-100">
            {!confirmDelete ? (
              <div className="flex items-center justify-between">
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit?.(item); }}
                  className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                  Düzenle
                </button>
                {isSale && sale && customer && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <SaleReceiptDownloadButton sale={sale} customer={customer} />
                  </span>
                )}
                {isPayment && payment && customer && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <PaymentReceiptDownloadButton
                      payment={payment}
                      customer={customer}
                      userName={session?.user?.name ?? "İşimNet"}
                    />
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  Kaydı sil
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Emin misin?</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSale && sale) deleteSale(sale.id);
                    else if (isPayment && payment) deletePayment(payment.id);
                    else if (isDebt && debt) deleteDebt(debt.id);
                  }}
                  className="text-xs font-semibold text-white px-3 py-1 rounded-lg"
                  style={{ background: "#EF4444" }}
                >
                  Sil
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                  className="text-xs text-gray-500 px-3 py-1 rounded-lg border border-gray-200"
                >
                  İptal
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}