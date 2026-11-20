import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { DepositInfo } from "@/components/layout/DepositInfo";
import { useLoketRefresh } from "@/components/layout/LoketShell";
import { CapaianChart } from "@/components/dashboard/CapaianChart";
import { WelcomeGreeting } from "@/components/dashboard/WelcomeGreeting";
import { buildThreeMonthSheets } from "@/lib/sheetChart";

interface SalePoint { amount: number; createdAt: string }

export function LoketHomePage() {
  const { tick } = useLoketRefresh();
  const { profile } = useAuth();
  const [sales, setSales] = useState<SalePoint[]>([]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const session = await supabase.auth.getSession();
      const response = await fetch("/api/loket-sales", {
        headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      });
      const body = response.ok ? await response.json() : { sales: [] };
      if (!stop) setSales(body.sales ?? []);
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [tick]);

  const curve = useMemo(
    () => buildThreeMonthSheets(sales.map((sale) => ({ at: sale.createdAt })), profile?.created_at || null),
    [sales, profile?.created_at],
  );

  return (
    <div>
      <DepositInfo />
      <div className="relative">
        <CapaianChart
          labels={curve.labels}
          series={curve.series}
          emptyText="Kurva menunggu transaksi."
          caption="Hanya transaksi loket ini"
          className="relative z-0 mr-auto mt-[4.5rem] w-[min(100%,calc(50vw+7.5rem))] overflow-visible rounded-lg border border-slate-200 bg-white p-3 text-left"
        />
        <WelcomeGreeting className="top-2" />
      </div>
    </div>
  );
}
