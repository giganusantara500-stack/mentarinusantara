import { useEffect, useMemo, useState } from "react";
import { dbRoleToAppRole, useAuth } from "@/lib/auth";
import { useNetworkLoketSales, useProfiles, useTransactions, type TransactionRow } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { PageContainer } from "@/components/PageContainer";
import { CapaianChart } from "@/components/dashboard/CapaianChart";
import { buildThreeMonthSheets } from "@/lib/sheetChart";
import { formatRupiah } from "@/lib/format";
import { Activity, CalendarDays, Landmark, BadgeAlert, Wallet } from "lucide-react";

interface CmsTicket {
  loketId?: string;
  amount: number;
  baseAmount?: number;
  status: string;
  transferAt?: string;
  createdAt?: string;
  decidedAt?: string | null;
}

function cmsWhen(ticket: CmsTicket) {
  return new Date(ticket.decidedAt || ticket.transferAt || ticket.createdAt || 0);
}

function cmsAmount(ticket: CmsTicket) {
  return Number(ticket.baseAmount ?? ticket.amount) || 0;
}

export function OpsDashboardPage() {
  const { profile } = useAuth();
  const { transactions, loading } = useTransactions();
  const { profiles, loading: profilesLoading } = useProfiles();
  const loketRows = useNetworkLoketSales();
  const [tickets, setTickets] = useState<CmsTicket[]>([]);
  const [cmsReady, setCmsReady] = useState(false);
  const role = profile ? dbRoleToAppRole(profile.role) : "pending";
  const networkView = role === "mitra" || role === "submitra";
  const networkLoketIds = useMemo(
    () => new Set(profiles.filter((row) => row.role === "loket").map((row) => row.id)),
    [profiles],
  );
  const combined = useMemo(() => {
    const rows = [...transactions, ...loketRows];
    if (!networkView || profilesLoading) return rows;
    return rows.filter((row) => networkLoketIds.has(row.user_id));
  }, [transactions, loketRows, networkView, profilesLoading, networkLoketIds]);
  const chart = useMemo(() => buildThreeMonthSheets(combined.map((row) => ({ at: row.created_at, ok: row.status === "success" }))), [combined]);
  const scopedTickets = useMemo(() => {
    if (!networkView) return tickets;
    return tickets.filter((ticket) => !!ticket.loketId && networkLoketIds.has(ticket.loketId));
  }, [tickets, networkView, networkLoketIds]);

  useEffect(() => {
    let stop = false;
    (async () => {
      const session = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
      const depositRes = await fetch("/api/deposits", { headers });
      const body = depositRes.ok ? await depositRes.json() : null;
      if (stop) return;
      setTickets((body?.tickets ?? []) as CmsTicket[]);
      setCmsReady(true);
    })();
    return () => { stop = true; };
  }, []);

  if (!profile) return null;
  if (role === "pending" || role === "loket") return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = combined.filter((row) => row.status === "success" && new Date(row.created_at) >= todayStart);
  const month = combined.filter((row) => row.status === "success" && new Date(row.created_at) >= monthStart);
  const outstanding = combined.filter((row) => row.status === "pending").reduce((sum, row) => sum + Number(row.amount), 0);
  const approved = scopedTickets.filter((ticket) => ticket.status === "approved");
  const cmsToday = approved.filter((ticket) => cmsWhen(ticket) >= todayStart);
  const cmsMonth = approved.filter((ticket) => cmsWhen(ticket) >= monthStart);
  const cmsTotal = approved.reduce((sum, ticket) => sum + cmsAmount(ticket), 0);
  const sum = (rows: TransactionRow[]) => rows.reduce((total, row) => total + Number(row.amount), 0);
  const sumCms = (rows: CmsTicket[]) => rows.reduce((total, ticket) => total + cmsAmount(ticket), 0);
  const txWaiting = (loading && loketRows.length === 0) || (networkView && profilesLoading);
  const cmsWaiting = !cmsReady || (networkView && profilesLoading);
  const cards = networkView
    ? [
        { label: "Transaksi Hari Ini", value: txWaiting ? "—" : formatRupiah(sum(today)), hint: `${today.length} transaksi jaringan`, href: "/transaksi", icon: Activity, tone: "from-sky-500 to-cyan-600" },
        { label: "Transaksi Bulan Ini", value: txWaiting ? "—" : formatRupiah(sum(month)), hint: `${month.length} transaksi jaringan`, href: "/rekap", icon: CalendarDays, tone: "from-violet-600 to-purple-700" },
        { label: "CMS Hari Ini", value: cmsWaiting ? "—" : formatRupiah(sumCms(cmsToday)), hint: `${cmsToday.length} setoran disetujui`, href: "/setoran", icon: Landmark, tone: "from-amber-500 to-orange-600" },
        { label: "CMS Bulan Ini", value: cmsWaiting ? "—" : formatRupiah(sumCms(cmsMonth)), hint: `${cmsMonth.length} setoran disetujui`, href: "/setoran", icon: Wallet, tone: "from-emerald-500 to-teal-600" },
        { label: "Total Outstanding", value: txWaiting ? "—" : formatRupiah(outstanding), hint: "Transaksi pending jaringan", href: "/outstanding", icon: BadgeAlert, tone: "from-rose-500 to-pink-600" },
      ]
    : [
        { label: "Transaksi Hari Ini", value: txWaiting ? "—" : formatRupiah(sum(today)), hint: `${today.length} transaksi`, href: "/transaksi", icon: Activity, tone: "from-sky-500 to-cyan-600" },
        { label: "Transaksi Bulan Ini", value: txWaiting ? "—" : formatRupiah(sum(month)), hint: `${month.length} transaksi`, href: "/rekap", icon: CalendarDays, tone: "from-violet-600 to-purple-700" },
        { label: "CMS", value: cmsWaiting ? "—" : formatRupiah(cmsTotal), hint: "Setoran disetujui", href: "/setoran", icon: Landmark, tone: "from-amber-500 to-orange-600" },
        { label: "Total Outstanding", value: txWaiting ? "—" : formatRupiah(outstanding), hint: "Transaksi pending", href: "/outstanding", icon: BadgeAlert, tone: "from-rose-500 to-pink-600" },
      ];
  return (
    <PageContainer className="flex h-full min-h-0 flex-1 flex-col">
      <div className={`grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 ${networkView ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className={`flex flex-col rounded-xl bg-gradient-to-br ${card.tone} px-3.5 py-2.5 text-white shadow-sm`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/80">{card.label}</span>
                <Icon size={16} />
              </div>
              <div className="mt-1 text-xl font-bold leading-tight">{card.value}</div>
              <div className="mt-0.5 truncate text-[11px] text-white/80">{card.hint}</div>
              <button type="button" onClick={() => { window.location.hash = card.href; }} className="mt-1.5 self-start text-[11px] font-bold underline decoration-white/50 underline-offset-2">Selengkapnya</button>
            </article>
          );
        })}
      </div>
      <CapaianChart
        labels={chart.labels}
        series={chart.series}
        emptyText="Kurva menunggu data transaksi."
        fill
        className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm"
      />
    </PageContainer>
  );
}
