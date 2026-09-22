"use client";

import { useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { useData } from "@/context/DataContext";
import { useSession } from "next-auth/react";

function formatSyncTime(date: Date | null): string {
  if (!date) return "Henüz yedeklenmedi";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)   return "Az önce";
  if (mins < 60)  return `${mins} dakika önce`;
  if (hours < 24) return `${hours} saat önce`;
  if (days === 1) return "Dün";
  return date.toLocaleDateString("tr-TR", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function SenkronizasyonPage() {
  const { data: session } = useSession();
  const {
    customers, products, sales, payments, debts,
    isSyncing, lastSyncTime, syncError, isDirty,
    syncToDrive, restoreFromDrive,
    backupToGitHub, restoreFromGitHub,
    importFromFile,
  } = useData();

  const [syncStatus, setSyncStatus]           = useState<"idle" | "success" | "error">("idle");
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [isRestoring, setIsRestoring]         = useState(false);
  const [restoreStatus, setRestoreStatus]     = useState<"idle" | "success" | "error">("idle");
  const [isBackingUp, setIsBackingUp]         = useState(false);
  const [isGHRestoring, setIsGHRestoring]     = useState(false);
  const [backupMsg, setBackupMsg]             = useState<string | null>(null);

  const [importFile, setImportFile]           = useState<File | null>(null);
  const [importPreview, setImportPreview]     = useState<{customers:number;products:number;sales:number;payments:number;debts:number} | null>(null);
  const [importError, setImportError]         = useState<string | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [isImporting, setIsImporting]         = useState(false);
  const [importStatus, setImportStatus]       = useState<"idle"|"success"|"error">("idle");
  const [importData, setImportData]           = useState<import("@/lib/github").AppData | null>(null);

  const email = session?.user?.email ?? "";

  async function handleSync() {
    try {
      await syncToDrive();
      setSyncStatus("success");
      setTimeout(() => setSyncStatus("idle"), 4000);
    } catch {
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 4000);
    }
  }

  async function handleRestore() {
    setIsRestoring(true);
    setShowRestoreConfirm(false);
    try {
      await restoreFromDrive();
      setRestoreStatus("success");
      setTimeout(() => setRestoreStatus("idle"), 4000);
    } catch {
      setRestoreStatus("error");
      setTimeout(() => setRestoreStatus("idle"), 4000);
    } finally {
      setIsRestoring(false);
    }
  }


  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError(null);
    setImportPreview(null);
    setImportData(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setImportError("Dosya 10 MB'tan büyük olamaz.");
      return;
    }
    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (
          !parsed || typeof parsed !== "object" ||
          !Array.isArray(parsed.customers) ||
          !Array.isArray(parsed.products) ||
          !Array.isArray(parsed.sales) ||
          !Array.isArray(parsed.payments) ||
          !Array.isArray(parsed.debts)
        ) {
          setImportError("Geçersiz dosya formatı. Beklenen alanlar: customers, products, sales, payments, debts.");
          return;
        }
        setImportData(parsed);
        setImportPreview({
          customers: parsed.customers.length,
          products:  parsed.products.length,
          sales:     parsed.sales.length,
          payments:  parsed.payments.length,
          debts:     parsed.debts.length,
        });
      } catch {
        setImportError("JSON dosyası okunamadı. Dosyanın geçerli bir JSON olduğundan emin olun.");
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!importData) return;
    setIsImporting(true);
    setShowImportConfirm(false);
    try {
      await importFromFile(importData);
      setImportStatus("success");
      setImportFile(null);
      setImportPreview(null);
      setImportData(null);
      setTimeout(() => setImportStatus("idle"), 4000);
    } catch {
      setImportStatus("error");
      setTimeout(() => setImportStatus("idle"), 4000);
    } finally {
      setIsImporting(false);
    }
  }

  const stats = [
    { label: "Müşteriler",  count: customers.length,
      icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#4F46E5" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>,
      bg: "#EEF2FF" },
    { label: "Ürünler",     count: products.length,
      icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#059669" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>,
      bg: "#ECFDF5" },
    { label: "Satışlar",    count: sales.length,
      icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#D97706" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75" /></svg>,
      bg: "#FFFBEB" },
    { label: "Tahsilatlar", count: payments.length,
      icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#0891B2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185ZM9.75 9h.008v.008H9.75V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm4.125 4.5h.008v.008h-.008V13.5Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>,
      bg: "#ECFEFF" },
    { label: "Borçlar", count: debts.length,
      icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="#EA580C" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
      bg: "#FFF7ED" },
  ];

  async function handleBackupToGitHub() {
    setIsBackingUp(true);
    setBackupMsg(null);
    try {
      await backupToGitHub();
      setBackupMsg("GitHub yedekleme tamamlandı.");
    } catch {
      setBackupMsg("GitHub yedekleme başarısız oldu.");
    } finally {
      setIsBackingUp(false);
      setTimeout(() => setBackupMsg(null), 4000);
    }
  }

  async function handleRestoreFromGitHub() {
    setIsGHRestoring(true);
    setBackupMsg(null);
    try {
      await restoreFromGitHub();
      setBackupMsg("GitHub'dan geri yükleme tamamlandı.");
    } catch {
      setBackupMsg("GitHub geri yükleme başarısız oldu.");
    } finally {
      setIsGHRestoring(false);
      setTimeout(() => setBackupMsg(null), 4000);
    }
  }


  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-16">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-indigo-600 text-sm font-medium mb-6"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Ana Sayfa
        </Link>

        {/* Hero */}
        <div className="flex flex-col items-center pb-8 pt-2">
          <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.3} stroke="#4F46E5" className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">GitHub Yedekleme</h1>
          <p className="text-sm text-gray-500 text-center">Verileriniz GitHub repository&apos;sinde güvenle saklanır</p>
        </div>

        {/* Info card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
            <span className="text-sm text-gray-500">Son yedekleme</span>
            <span className={`text-sm font-medium ${lastSyncTime ? "text-gray-800" : "text-gray-400"}`}>
              {formatSyncTime(lastSyncTime)}
            </span>
          </div>
          {email && (
            <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
              <span className="text-sm text-gray-500">Google Hesabı (Giriş)</span>
              <span className="text-sm font-medium text-gray-800 truncate max-w-[200px]">{email}</span>
            </div>
          )}
          <div className="px-5 py-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">Otomatik yedekleme</span>
            <span className="text-xs bg-green-50 text-green-700 font-medium px-2.5 py-1 rounded-full">Her 10 dakikada bir</span>
          </div>
        </div>

        {/* Data summary */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-6 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Yedeklenecek Veriler</span>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.map((s) => (
              <div key={s.label} className="px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: s.bg }}>
                    {s.icon}
                  </div>
                  <span className="text-sm text-gray-700">{s.label}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">{s.count} kayıt</span>
              </div>
            ))}
          </div>
        </div>

        {/* Persistent sync error from context (auto-sync failures) */}
        {syncError && syncStatus !== "error" && (
          <div className="mb-4 flex items-start gap-2.5 bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#EA580C" className="w-5 h-5 shrink-0 mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-sm text-orange-700 font-medium">{syncError}</span>
          </div>
        )}

        {/* Status messages */}
        {syncStatus === "success" && (
          <div className="mb-4 flex items-center gap-2.5 bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#16A34A" className="w-5 h-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="text-sm text-green-700 font-medium">Veriler GitHub&apos;a yedeklendi.</span>
          </div>
        )}
        {syncStatus === "error" && (
          <div className="mb-4 flex items-center gap-2.5 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#DC2626" className="w-5 h-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-sm text-red-700 font-medium">Yedekleme başarısız. İnternet bağlantınızı kontrol edin.</span>
          </div>
        )}
        {restoreStatus === "success" && (
          <div className="mb-4 flex items-center gap-2.5 bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#16A34A" className="w-5 h-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="text-sm text-green-700 font-medium">Veriler GitHub&apos;dan başarıyla geri yüklendi.</span>
          </div>
        )}
        {restoreStatus === "error" && (
          <div className="mb-4 flex items-center gap-2.5 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#DC2626" className="w-5 h-5 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-sm text-red-700 font-medium">Geri yükleme başarısız. GitHub&apos;da veri bulunamadı.</span>
          </div>
        )}

        {/* Primary action */}
        <button
          onClick={handleBackupToGitHub}
          disabled={isBackingUp || isRestoring}
          className="w-full py-4 rounded-2xl text-white font-semibold text-base flex items-center justify-center gap-2.5 transition-opacity disabled:opacity-60"
          style={{ background: "#4F46E5" }}
        >
          {isBackingUp ? (
            <>
              <svg className="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
              </svg>
              Yedekleniyor…
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
              </svg>
              Şimdi Yedekle
            </>
          )}
        </button>

        {/* Secondary action */}
        <button
          onClick={() => setShowRestoreConfirm(true)}
          disabled={isSyncing || isRestoring}
          className="w-full mt-3 py-4 rounded-2xl text-gray-600 font-medium text-base flex items-center justify-center gap-2.5 border border-gray-200 bg-white transition-colors hover:bg-gray-50 disabled:opacity-60"
        >
          {isRestoring ? (
            <>
              <svg className="w-5 h-5 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
              </svg>
              Geri yükleniyor…
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              GitHub&apos;dan Geri Yükle
            </>
          )}
        </button>

        {/* ── JSON Dosyasından İçe Aktar ── */}
        <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Yerel Dosyadan Geri Yükle</p>

          <label className="block w-full cursor-pointer">
            <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-5 text-center hover:border-green-400 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mx-auto mb-2 text-gray-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {importFile ? importFile.name : "JSON dosyası seçin"}
              </p>
              <p className="text-xs text-gray-400 mt-1">.json · maks 10 MB</p>
            </div>
            <input type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
          </label>

          {importError && (
            <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#DC2626" className="w-4 h-4 shrink-0 mt-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span className="text-xs text-red-700">{importError}</span>
            </div>
          )}

          {importPreview && (
            <div className="mt-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-green-800 dark:text-green-300 mb-2">Dosya içeriği:</p>
              <div className="grid grid-cols-2 gap-1 text-xs text-green-700 dark:text-green-400">
                <span>Müşteriler: <b>{importPreview.customers}</b></span>
                <span>Ürünler: <b>{importPreview.products}</b></span>
                <span>Satışlar: <b>{importPreview.sales}</b></span>
                <span>Tahsilatlar: <b>{importPreview.payments}</b></span>
                <span>Borçlar: <b>{importPreview.debts}</b></span>
              </div>
            </div>
          )}

          {importStatus === "success" && (
            <div className="mt-3 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#16A34A" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span className="text-xs text-green-700 font-medium">Veriler başarıyla içe aktarıldı.</span>
            </div>
          )}
          {importStatus === "error" && (
            <div className="mt-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#DC2626" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              <span className="text-xs text-red-700">İçe aktarma başarısız oldu.</span>
            </div>
          )}

          <button
            onClick={() => setShowImportConfirm(true)}
            disabled={!importPreview || isImporting}
            className="mt-4 w-full py-4 rounded-2xl text-white font-semibold text-base flex items-center justify-center gap-2.5 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#16A34A" }}
          >
            {isImporting ? (
              <>
                <svg className="w-5 h-5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                </svg>
                İçe Aktarılıyor…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                JSON Dosyasından İçe Aktar
              </>
            )}
          </button>
        </div>
      </main>


      {/* Import confirmation modal */}
      {showImportConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 px-4 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Dosyadan İçe Aktar</h2>
            <p className="text-sm text-gray-500 mb-4">
              Mevcut verilerinizin üzerine seçilen dosyadaki veriler yazılacak. İşlem sonrası geri alabilirsiniz.
            </p>
            {isDirty && (
              <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#B45309" className="w-4 h-4 shrink-0 mt-0.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <span className="text-xs text-amber-800">Yedeklenmemiş değişiklikleriniz var.</span>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowImportConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-600 border border-gray-200"
              >
                İptal
              </button>
              <button
                onClick={handleImport}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: "#16A34A" }}
              >
                İçe Aktar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore confirmation modal */}
      {showRestoreConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 px-4 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-2">GitHub&apos;dan Geri Yükle</h2>
            <p className="text-sm text-gray-500 mb-4">
              Mevcut verilerinizin üzerine GitHub&apos;daki veriler yazılacak. Bu işlem geri alınamaz.
            </p>
            {isDirty && (
              <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#B45309" className="w-4 h-4 shrink-0 mt-0.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <span className="text-xs text-amber-800">Yedeklenmemiş değişiklikleriniz var. Geri yükleme bu değişiklikleri silecek.</span>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowRestoreConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-600 border border-gray-200"
              >
                İptal
              </button>
              <button
                onClick={handleRestore}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: "#4F46E5" }}
              >
                Geri Yükle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}