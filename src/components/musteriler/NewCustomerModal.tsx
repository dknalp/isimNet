"use client";

import { useEffect, useState } from "react";
import { NewCustomerFormData } from "@/lib/customers";

interface NewCustomerModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: NewCustomerFormData) => void;
  initialData?: NewCustomerFormData;
  title?: string;
}

const emptyForm: NewCustomerFormData = { name: "", phone: "", note: "" };

export default function NewCustomerModal({ open, onClose, onSubmit, initialData, title }: NewCustomerModalProps) {
  const [form, setForm] = useState<NewCustomerFormData>(initialData ?? emptyForm);
  const [errors, setErrors] = useState<{ name?: string }>({});

  useEffect(() => {
    if (open) setForm(initialData ?? emptyForm);
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function validate(): boolean {
    const newErrors: { name?: string } = {};
    if (!form.name.trim()) newErrors.name = "Ad soyad zorunludur";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    onSubmit({ name: form.name.trim(), phone: form.phone?.trim() || undefined, note: form.note?.trim() || undefined });
    setForm(emptyForm);
    setErrors({});
    onClose();
  }

  const inputClass =
    "w-full bg-gray-50 rounded-xl px-4 py-3 text-gray-900 text-sm border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-400";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-3xl px-5 pt-5 pb-8">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{title ?? "Yeni Müşteri"}</h2>
        <div className="flex flex-col gap-3">
          <div>
            <input type="text" placeholder="Ad Soyad *" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass} />
            {errors.name && <p className="text-red-500 text-xs mt-1 ml-1">{errors.name}</p>}
          </div>
          <div>
            <input type="tel" inputMode="numeric" placeholder="Telefon (opsiyonel)" value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={inputClass} />
          </div>
          <textarea placeholder="Not (opsiyonel)" value={form.note ?? ""}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            rows={2} className={`${inputClass} resize-none`} />
        </div>
        <button onClick={handleSubmit}
          className="mt-5 w-full py-4 rounded-2xl font-semibold text-white text-base transition-all active:scale-[0.98]"
          style={{ background: "#4F46E5" }}>
          Kaydet
        </button>
      </div>
    </>
  );
}