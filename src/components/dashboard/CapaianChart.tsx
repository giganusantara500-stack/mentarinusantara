import { useEffect, useRef, useState } from "react";
import { LineChart, type LineSeries } from "@/components/dashboard/LineChart";
import { cn } from "@/lib/utils";

function sheetTotal(series: LineSeries) {
  return series.values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function CapaianChart({
  labels,
  series,
  emptyText,
  caption,
  className,
  fill = false,
}: {
  labels: string[];
  series: LineSeries[];
  emptyText: string;
  caption?: string;
  className?: string;
  fill?: boolean;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotHeight, setPlotHeight] = useState(240);
  useEffect(() => {
    if (!fill) return;
    const node = plotRef.current;
    if (!node) return;
    const update = () => setPlotHeight(Math.max(140, Math.floor(node.clientHeight)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fill]);

  const current = series[series.length - 1]?.name ?? "";
  return (
    <section className={cn(className, fill && "flex min-h-0 flex-col")}>
      <div className={cn("relative flex items-center justify-center px-28", fill ? "mb-1 min-h-6 shrink-0" : "mb-2 min-h-7")}>
        <div className="text-center">
          <h2 className={cn("font-black text-slate-950", fill ? "text-sm" : "text-base")}>Capaian Transaksi</h2>
          {caption && <div className="text-[11px] font-semibold text-slate-500">{caption}</div>}
        </div>
        {current && (
          <div className={cn("absolute right-0 top-1/2 max-w-[11rem] -translate-y-1/2 text-right font-semibold leading-tight text-sky-700", fill ? "text-[11px]" : "text-xs")}>
            {current}
          </div>
        )}
      </div>
      <div className={cn("flex flex-wrap items-start justify-center", fill ? "mb-1 shrink-0 gap-x-5 gap-y-0.5" : "mb-2 gap-x-5 gap-y-1")}>
        {series.map((item) => (
          <div key={item.name} className={cn("text-center", fill ? "min-w-[7rem]" : "min-w-[7.5rem]")}>
            <div className={cn("inline-flex items-center gap-1.5 font-black text-slate-800", fill ? "text-xs" : "text-sm")}>
              <span className={cn("rounded-full", fill ? "h-2 w-2" : "h-2.5 w-2.5")} style={{ backgroundColor: item.color }} />
              {item.name}
            </div>
            <div className={cn("font-black text-slate-700", fill ? "text-[11px]" : "text-xs")}>{sheetTotal(item)} lembar</div>
          </div>
        ))}
      </div>
      <div ref={plotRef} className={cn(fill ? "min-h-0 flex-1" : undefined)}>
        <LineChart
          labels={labels}
          series={series}
          formatValue={(value) => `${Math.round(value)} lembar`}
          height={fill ? plotHeight : 340}
          emptyText={emptyText}
        />
      </div>
    </section>
  );
}
