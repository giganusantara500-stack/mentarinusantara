import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}

export function Table<T>({ columns, data, rowKey, empty, onRowClick }: Props<T>) {
  if (data.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        {empty ?? "Tidak ada data."}
      </div>
    );
  }
  return (
    <div className="w-full max-w-full">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-y border-slate-100">
            {columns.map((c) => (
              <th key={c.key} className={cn("px-2.5 py-2 font-semibold break-words", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((row, i) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={cn(
                "hover:bg-slate-50/70 transition-colors",
                onRowClick && "cursor-pointer"
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-2.5 py-2 text-slate-700 align-middle break-words", c.className)}>
                  {c.render ? c.render(row, i) : (row as any)[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
