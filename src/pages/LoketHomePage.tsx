import { useEffect, useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DEPOSIT_ACCOUNTS } from "@/lib/banks";
import { useLoketRefresh } from "@/components/layout/LoketShell";
import { LineChart } from "@/components/dashboard/LineChart";
import { buildThreeMonthSheets } from "@/lib/sheetChart";

interface SalePoint { amount: number; createdAt: string }

export function LoketHomePage() {
  const account = DEPOSIT_ACCOUNTS[0];
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
    <div className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-amber-600">
          <Landmark size={18} />
          <span className="text-sm font-bold">{account.bank}</span>
        </div>
        <div className="mt-3 font-mono text-xl font-semibold tracking-wide text-slate-900">{account.accountNumber}</div>
        <div className="mt-1 text-sm text-slate-500">a.n. {account.holder}</div>
      </article>
      <section className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-end justify-between gap-3">
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
          height={288}
          emptyText="Kurva menunggu transaksi."
        />
      </section>
    </div>
  );
}
