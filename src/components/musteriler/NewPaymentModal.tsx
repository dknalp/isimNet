"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { parseCurrencyDisplay } from "@/lib/currencyInput";
import CurrencyInput from "@/components/ui/CurrencyInput";

type PaymentMethod = "nakit" | "cek" | "havale" | "kredi_karti";

interface NewPaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { amount: number; description: string; method: PaymentMethod }) => void;
  maxAmount?: number;
}

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "nakit", label: "Nakit" },
  { key: "cek", label: "Çek" },
  { key: "havale", label: "Havale" },
  { key: "kredi_karti", label: "Krt." },
];

export default function NewPaymentModal({ open, onClose, onSubmit, maxAmount }: NewPaymentModalProps) {
  const [amountDisplay, setAmountDisplay] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("nakit");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setAmountDisplay(""); setDescription(""); setMethod("nakit"); setError(""); }
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  const numAmount = parseCurrencyDisplay(amountDisplay);
  const isOverMax = maxAmount !== undefined && numAmount > maxAmount && numAmount > 0;

  function handleSubmit() {
    if (numAmount <= 0) { setError("Geçerli tutar giriniz"); return; }
    setError("");
    onSubmit({ amount: numAmount, description: description.trim(), method });
    setAmountDisplay("");
    setDescription("");
    setMethod("nakit");
    onClose();
  }

  const inputClass =
    "w-full bg-gray-50 rounded-xl px-4 py-3 text-gray-900 text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-400";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-3xl px-5 pt-5 pb-8">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <h2 className="text-lg font-semibold text-gray-900 mb-5">Tahsilat Al</h2>
        <div className="flex flex-col gap-3">
          <div>
            <CurrencyInput
              value={amountDisplay}
              onChange={(display) => setAmountDisplay(display)}
              placeholder="Tutar (₺) *"
              className={inputClass}
            />
            {error && <p className="text-red-500 text-xs mt-1 ml-1">{error}</p>}
            {isOverMax && (
              <p className="text-amber-600 text-xs mt-1 ml-1">
                Bu tutar mevcut borcu ({formatCurrency(maxAmount!)}) aşıyor. Devam edebilirsiniz.
              </p>
            )}
          </div>

          {/* Ödeme yöntemi */}
          <div className="flex gap-2">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                  method === m.key
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-gray-50 text-gray-600 border-gray-200"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <input type="text" placeholder="Açıklama (opsiyonel)"
            value={description} onChange={(e) => setDescription(e.target.value)}
            className={inputClass} />
        </div>
        <button onClick={handleSubmit}
          className="mt-5 w-full py-4 rounded-2xl font-semibold text-white text-base transition-all active:scale-[0.98]"
          style={{ background: "#059669" }}>
          Tahsilatı Kaydet
        </button>
      </div>
    </>
  );
}
