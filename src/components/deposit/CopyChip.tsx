import { useState } from "react";

export async function copyText(value: string) {
  const text = value.trim();
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* beberapa webview menolak clipboard; lanjut ke salinan manual */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "0";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyChip({ value, done, disabled = false }: { value: string; done: string; disabled?: boolean }) {
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled || !value.trim()}
        onClick={async () => {
          const ok = await copyText(value);
          setFailed(!ok);
          setNote(ok ? done : "Gagal menyalin. Pilih angkanya, lalu salin manual.");
          window.setTimeout(() => {
            setNote("");
            setFailed(false);
          }, 1600);
        }}
        className="min-h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 disabled:opacity-40"
      >
        Salin
      </button>
      {note && <span className={`min-w-0 text-xs font-semibold ${failed ? "text-rose-600" : "text-emerald-700"}`}>{note}</span>}
    </span>
  );
}
