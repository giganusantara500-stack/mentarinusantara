import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DepositInfo } from "@/components/layout/DepositInfo";
import { useLoketRefresh } from "@/components/layout/LoketShell";
import { LineChart } from "@/components/dashboard/LineChart";
import { buildThreeMonthSheets } from "@/lib/sheetChart";

interface SalePoint { amount: number; createdAt: string }

export function LoketHomePage() {
  const { tick } = useLoketRefresh();
  const [sales, setSales] = useState<SalePoint[]>([]);

  useEffect(() => {
    (async () => {
      const session = await supabase.auth.getSession();
      const response = await fetch("/api/loket-sales", {
        headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      });
      const body = response.ok ? await response.json() : { sales: [] };
      setSales(body.sales ?? []);
    })();
  }, [tick]);

  const curve = useMemo(() => buildThreeMonthSheets(sales.map((sale) => ({ at: sale.createdAt }))), [sales]);
  const current = curve.series[2];
  const monthTotal = current.values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

  return (
    <div>
      <DepositInfo />
      <section className="mr-auto mt-28 w-[min(100%,calc(50vw+7.5rem))] overflow-visible rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm">
        <div className="mb-2 flex items-end justify-start gap-8">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Capaian Transaksi</h2>
            <p className="text-xs text-slate-500">Tiga bulan terakhir, per tanggal</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Total lembar bulan ini</div>
            <div className="text-sm font-bold text-sky-600">{monthTotal} lembar</div>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap gap-3">
          {curve.series.map((item) => (
            <span key={item.name} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
          ))}
        </div>
        <LineChart
          labels={curve.labels}
          series={curve.series}
          formatValue={(value) => `${Math.round(value)} lembar`}
          height={340}
          emptyText="Kurva menunggu transaksi."
        />
      </section>
    </div>
  );
}
