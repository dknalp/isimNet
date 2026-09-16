"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import CustomerDetailStats from "@/components/musteriler/CustomerDetailStats";
import ActivityFeed from "@/components/musteriler/ActivityFeed";
import DetailFAB from "@/components/musteriler/DetailFAB";
import NewSaleModal from "@/components/musteriler/NewSaleModal";
import NewPaymentModal from "@/components/musteriler/NewPaymentModal";
import NewCustomerModal from "@/components/musteriler/NewCustomerModal";
import NewDebtModal from "@/components/musteriler/NewDebtModal";
import EditSaleModal from "@/components/musteriler/EditSaleModal";
import EditPaymentModal from "@/components/musteriler/EditPaymentModal";
import EditDebtModal from "@/components/musteriler/EditDebtModal";
import { Sale, Payment, Debt, ActivityItem, buildActivityFeed, NewCustomerFormData } from "@/lib/customers";
import { useData } from "@/context/DataContext";
import { buildCustomerStatement, openWhatsAppStatement } from "@/lib/whatsapp";

export default function MusteriDetayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { customers, sales, payments, debts, addSale, updateSale, addPayment, updatePayment, addDebt, updateDebt, getCustomerTotals, updateCustomer, deleteCustomer } = useData();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const customer = customers.find((c) => c.id === id) ?? null;
  const customerSales    = sales.filter((s) => s.customerId === id);
  const customerPayments = payments.filter((p) => p.customerId === id);
  const customerDebts    = debts.filter((d) => d.customerId === id);

  const [isSaleModalOpen, setIsSaleModalOpen]     = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isDebtModalOpen, setIsDebtModalOpen]       = useState(false);
  const [isEditModalOpen, setIsEditModalOpen]       = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm]   = useState(false);
  const [editTarget, setEditTarget] = useState<ActivityItem | null>(null);

  const { totalRevenue, totalCollected, currentDebt, myDebt } = getCustomerTotals(id);

  const activityFeed = useMemo(
    () => buildActivityFeed(customerSales, customerPayments, customerDebts),
    [customerSales, customerPayments, customerDebts]
  );

  function handleAddSale(data: Omit<Sale, "id" | "customerId">) {
    addSale({ ...data, customerId: id });
  }

  function handleAddPayment(data: { amount: number; description: string }) {
    addPayment({ ...data, customerId: id, date: new Date().toISOString() });
  }

  function handleAddDebt(data: { amount: number; description: string }) {
    addDebt({ ...data, customerId: id, date: new Date().toISOString() } as Omit<Debt, "id">);
  }

  function handleEditCustomer(data: NewCustomerFormData) {
    updateCustomer(id, data);
  }

  function handleDeleteCustomer() {
    deleteCustomer(id);
    router.push("/dashboard/musteriler");
  }

  if (!mounted || !customer) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          {mounted && !customer ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-gray-400 text-lg mb-4">Müşteri bulunamadı</p>
              <Link href="/dashboard/musteriler" className="text-indigo-600 font-medium text-sm">← Müşteri Listesine Dön</Link>
            </div>
          ) : (
            <div className="animate-pulse space-y-4 mt-4">
              <div className="h-20 bg-gray-200 rounded-2xl" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-16 bg-gray-200 rounded-2xl" />
                <div className="h-16 bg-gray-200 rounded-2xl" />
                <div className="h-16 bg-gray-200 rounded-2xl" />
                <div className="h-16 bg-gray-200 rounded-2xl" />
              </div>
              <div className="h-24 bg-gray-200 rounded-2xl" />
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-24">
        <Link href="/dashboard/musteriler" className="inline-flex items-center gap-1.5 text-indigo-600 text-sm font-medium mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Müşteriler
        </Link>

        <div className="bg-white rounded-2xl p-5 mb-4" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.07)" }}>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#EEF2FF" }}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="#4F46E5" className="w-7 h-7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 leading-tight">{customer.name}</h1>
              {customer.phone && <p className="text-gray-400 text-sm mt-0.5">{customer.phone}</p>}
              {customer.note && <p className="text-gray-500 text-xs mt-1 italic">{customer.note}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-indigo-50 transition-colors"
                aria-label="Düzenle"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#4F46E5" className="w-4.5 h-4.5 w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
              <button
                onClick={() => openWhatsAppStatement(
                  customer.phone,
                  buildCustomerStatement(customer, customerSales, customerPayments, customerDebts, currentDebt)
                )}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-green-50 transition-colors"
                aria-label="WhatsApp Hesap Özeti"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#22C55E" className="w-5 h-5">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.121 1.532 5.849L.057 23.25l5.542-1.454A11.953 11.953 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.652-.518-5.17-1.418l-.37-.22-3.291.864.878-3.205-.24-.389A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-red-50 transition-colors"
                aria-label="Sil"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#EF4444" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="mb-5">
          <CustomerDetailStats totalRevenue={totalRevenue} totalCollected={totalCollected} currentDebt={currentDebt} myDebt={myDebt} />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Hareket Geçmişi</h2>
          <ActivityFeed items={activityFeed} onEdit={item => setEditTarget(item)} customer={customer ?? undefined} />
        </div>
      </main>

      <DetailFAB onNewSale={() => setIsSaleModalOpen(true)} onNewPayment={() => setIsPaymentModalOpen(true)} onNewDebt={() => setIsDebtModalOpen(true)} />

      <NewSaleModal open={isSaleModalOpen} onClose={() => setIsSaleModalOpen(false)} onSubmit={handleAddSale} />
      <NewPaymentModal open={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} onSubmit={handleAddPayment} maxAmount={currentDebt} />
      <NewDebtModal open={isDebtModalOpen} onClose={() => setIsDebtModalOpen(false)} onSubmit={handleAddDebt} />

      <NewCustomerModal
        open={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={handleEditCustomer}
        initialData={{ name: customer.name, phone: customer.phone, note: customer.note }}
        title="Müşteriyi Düzenle"
      />

      {editTarget?.type === "sale" && (
        <EditSaleModal
          open
          onClose={() => setEditTarget(null)}
          initialSale={editTarget.data as Sale}
          onSubmit={data => { updateSale((editTarget.data as Sale).id, data); setEditTarget(null); }}
        />
      )}
      {editTarget?.type === "payment" && (
        <EditPaymentModal
          open
          onClose={() => setEditTarget(null)}
          initialPayment={editTarget.data as Payment}
          maxAmount={currentDebt}
          onSubmit={data => { updatePayment((editTarget.data as Payment).id, data); setEditTarget(null); }}
        />
      )}
      {editTarget?.type === "debt" && (
        <EditDebtModal
          open
          onClose={() => setEditTarget(null)}
          initialDebt={editTarget.data as Debt}
          onSubmit={data => { updateDebt((editTarget.data as Debt).id, data); setEditTarget(null); }}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 px-4 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Müşteriyi Sil</h2>
            <p className="text-sm text-gray-500 mb-6">
              <span className="font-medium text-gray-700">{customer.name}</span> ve bu müşteriye ait tüm satış ve tahsilat kayıtları silinecek. Bu işlem geri alınamaz.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-600 border border-gray-200"
              >
                İptal
              </button>
              <button
                onClick={handleDeleteCustomer}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: "#EF4444" }}
              >
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}