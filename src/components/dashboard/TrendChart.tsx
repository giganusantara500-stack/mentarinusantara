interface Point {
  label: string;
  value: number;
}

interface Props {
  data: Point[];
  formatValue: (n: number) => string;
  emptyText?: string;
}

export function TrendChart({ data, formatValue, emptyText = "Belum ada data." }: Props) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">{emptyText}</p>;
  }

  const max = Math.max(...data.map((p) => p.value), 0);
  const labelStep = Math.ceil(data.length / 8);

  return (
    <div className="w-full overflow-visible">
      <div className="mb-1 text-xs font-medium text-slate-700">Jumlah Transaksi (Lembar)</div>
      <div className="flex h-64 max-h-80 w-full items-end gap-1.5 overflow-visible">
      {data.map((p, i) => {
        const pct = max > 0 ? (p.value / max) * 100 : 0;
        return (
          <div
            key={`${p.label}-${i}`}
            className="group flex-1 min-w-0 flex flex-col items-center"
            title={`${p.label}: ${formatValue(p.value)}`}
          >
            <div className="flex h-52 w-full items-end">
              <div
                className="w-full rounded-t-md bg-blue-500 group-hover:bg-blue-600 transition-all duration-500"
                style={{ height: `${p.value > 0 ? Math.max(pct, 3) : 0}%` }}
              />
            </div>
            <div className="mt-2 h-5 w-full truncate text-center text-xs font-medium text-slate-700">
              {i % labelStep === 0 ? p.label : ""}
            </div>
          </div>
        );
      })}
      </div>
      <div className="mt-1 text-center text-xs font-medium text-slate-700">Tanggal (Hari ke-)</div>
    </div>
  );
}
