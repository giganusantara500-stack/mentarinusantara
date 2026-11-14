import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const pages = getVisiblePages(page, totalPages);

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
      <span className="text-xs text-slate-500">
        Halaman {page} dari {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Halaman pertama"
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Sebelumnya"
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`gap-${i}`} className="px-2 text-xs text-slate-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition ${
                p === page
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-200"
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Berikutnya"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
          title="Halaman terakhir"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  );
}

function getVisiblePages(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("...");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("...");
  pages.push(total);
  return pages;
}
