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
    <div className="flex items-end gap-1.5 h-56">
      {data.map((p, i) => {
        const pct = max > 0 ? (p.value / max) * 100 : 0;
        return (
          <div
            key={`${p.label}-${i}`}
            className="group flex-1 min-w-0 flex flex-col items-center"
            title={`${p.label}: ${formatValue(p.value)}`}
          >
            <div className="w-full h-44 flex items-end">
              <div
                className="w-full rounded-t-md bg-blue-500 group-hover:bg-blue-600 transition-all duration-500"
                style={{ height: `${p.value > 0 ? Math.max(pct, 3) : 0}%` }}
              />
            </div>
            <div className="h-5 mt-2 text-[10px] text-slate-500 truncate w-full text-center">
              {i % labelStep === 0 ? p.label : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
