"use client";

import { useEffect } from "react";
import { useData } from "@/context/DataContext";

export default function UndoToast() {
  const { canUndo, undoLastAction } = useData();

  // Accessibility: close on Escape
  useEffect(() => {
    if (!canUndo) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") undoLastAction();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndo, undoLastAction]);

  if (!canUndo) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg bg-gray-900 text-white text-sm"
    >
      <span>Kayıt silindi.</span>
      <button
        onClick={undoLastAction}
        className="font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        Geri Al
      </button>
    </div>
  );
}
