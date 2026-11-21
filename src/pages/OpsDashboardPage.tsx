import { useEffect, useMemo, useState } from "react";
import { dbRoleToAppRole, useAuth } from "@/lib/auth";
import { useNetworkLoketSales, useProfiles, useTransactions, type TransactionRow } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { PageContainer } from "@/components/PageContainer";
import { CapaianChart } from "@/components/dashboard/CapaianChart";
import { WelcomeGreeting } from "@/components/dashboard/WelcomeGreeting";
import { buildThreeMonthSheets, isCountedSale } from "@/lib/sheetChart";
import { formatRupiah } from "@/lib/format";
import { ticketPhase } from "@/lib/depositStatus";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Activity, CalendarDays, Landmark, BadgeAlert, Wallet } from "lucide-react";

interface CmsTicket {
  id?: string;
  loketId?: string;
  loketName?: string;
  amount: number;
  baseAmount?: number;
  transferAmount?: number;
  uniqueCode?: string;
  applicantRole?: string;
  route?: "pusat" | "jaringan";
  status: "pending" | "approved" | "cancelled" | "reversed";
  expiresAt?: string;
  claimedAt?: string | null;
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

function DepositTasks({ tickets, onChanged }: { tickets: CmsTicket[]; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const tasks = tickets.filter((ticket) => ticket.status === "pending" && ticketPhase(ticket).label !== "Kedaluwarsa");
  const decide = async (id: string, action: "approve" | "cancel") => {
    setBusy(id + action);
    setNote("");
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits/decide", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const body = await response.json().catch(() => null);
    setBusy("");
    if (!response.ok) { setNote(body?.error || "Tiket gagal diproses."); return; }
    setNote(action === "approve" ? "Tiket disetujui. Saldo Utama berkurang dan pindah ke pemohon satu kali." : "Tiket dibatalkan.");
    onChanged();
  };
  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Tugas deposit</h2>
        <span className="text-xs text-slate-500">{tasks.length} tiket perlu diperiksa</span>
      </div>
      {note && <p className="mb-2 text-sm text-slate-700">{note}</p>}
      {tasks.length === 0 && <p className="text-sm text-slate-500">Belum ada tiket yang menunggu pemeriksaan.</p>}
      <div className="space-y-2">
        {tasks.map((ticket) => (
          <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">{ticket.loketName || "Pemohon"} · {ticket.applicantRole === "mitra" ? "Mitra" : ticket.applicantRole === "submitra" ? "Sub Mitra" : "Loket"} · {formatRupiah(ticket.transferAmount ?? ticket.amount)}</div>
              <div className="text-xs text-slate-500">Kode unik {ticket.uniqueCode || "-"} · saldo yang pindah {formatRupiah(ticket.baseAmount ?? ticket.amount)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={ticketPhase(ticket).tone}>{ticketPhase(ticket).label}</Badge>
              {ticket.route === "jaringan" ? (
                <Badge tone="info">Jaringan</Badge>
              ) : (
                <>
                  <Button size="sm" disabled={!ticket.id || busy === `${ticket.id}approve`} onClick={() => ticket.id && decide(ticket.id, "approve")}>Setujui</Button>
                  <Button size="sm" variant="outline" disabled={!ticket.id || busy === `${ticket.id}cancel`} onClick={() => ticket.id && decide(ticket.id, "cancel")}>Tolak</Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OpsDashboardPage() {
  const { profile } = useAuth();
  const { transactions, loading } = useTransactions();
  const { profiles, loading: profilesLoading } = useProfiles();
  const loketRows = useNetworkLoketSales();
  const [tickets, setTickets] = useState<CmsTicket[]>([]);
  const [cmsReady, setCmsReady] = useState(false);
  const [mainBalance, setMainBalance] = useState<number | null>(null);
  const role = profile ? dbRoleToAppRole(profile.role) : "pending";
  const networkView = role === "mitra" || role === "submitra";
  const networkLoketIds = useMemo(
    () => new Set(profiles.filter((row) => row.role === "loket").map((row) => row.id)),
    [profiles],
  );
  const archive = loketRows;
  const chart = useMemo(() => buildThreeMonthSheets(archive.map((row) => ({ at: row.created_at, ok: isCountedSale(row.status) }))), [archive]);
  const scopedTickets = useMemo(() => {
    if (!networkView) return tickets;
    return tickets.filter((ticket) => !!ticket.loketId && networkLoketIds.has(ticket.loketId));
  }, [tickets, networkView, networkLoketIds]);

  useEffect(() => {
    let stop = false;
    (async () => {
      const session = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
      const [depositRes, walletRes] = await Promise.all([
        fetch("/api/deposits", { headers }),
        fetch("/api/wallet", { headers }),
      ]);
      const body = depositRes.ok ? await depositRes.json() : null;
      const wallet = walletRes.ok ? await walletRes.json() : null;
      if (stop) return;
      setTickets((body?.tickets ?? []) as CmsTicket[]);
      setMainBalance(Number(wallet?.mainBalance ?? wallet?.balance ?? 0));
      setCmsReady(true);
    })();
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const session = await supabase.auth.getSession();
        const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
        const [walletRes, depositRes] = await Promise.all([
          fetch("/api/wallet", { headers }),
          fetch("/api/deposits", { headers }),
        ]);
        if (walletRes.ok) {
          const wallet = await walletRes.json();
          setMainBalance(Number(wallet?.mainBalance ?? wallet?.balance ?? 0));
        }
        if (depositRes.ok) {
          const body = await depositRes.json();
          setTickets((body?.tickets ?? []) as CmsTicket[]);
        }
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (!profile) return null;
  if (role === "pending" || role === "loket") return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = archive.filter((row) => row.status === "success" && new Date(row.created_at) >= todayStart);
  const month = archive.filter((row) => row.status === "success" && new Date(row.created_at) >= monthStart);
  const outstanding = transactions.filter((row) => row.status === "pending" && (!networkView || networkLoketIds.has(row.user_id))).reduce((sum, row) => sum + Number(row.amount), 0);
  const approved = scopedTickets.filter((ticket) => ticket.status === "approved");
  const cmsToday = approved.filter((ticket) => cmsWhen(ticket) >= todayStart);
  const cmsMonth = approved.filter((ticket) => cmsWhen(ticket) >= monthStart);
  const cmsTotal = approved.reduce((sum, ticket) => sum + cmsAmount(ticket), 0);
  const sum = (rows: TransactionRow[]) => rows.reduce((total, row) => total + Number(row.amount), 0);
  const sumCms = (rows: CmsTicket[]) => rows.reduce((total, ticket) => total + cmsAmount(ticket), 0);
  const txWaiting = loketRows.length === 0 && (loading || profilesLoading);
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
      <div className="mb-3 flex shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-950 px-3.5 py-2 text-white">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-400 text-slate-950">
          <Wallet size={16} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200">{role === "submitra" ? "Saldo" : "Saldo Utama"}</div>
          <div className="text-lg font-bold leading-none tabular-nums">{mainBalance === null ? "—" : formatRupiah(mainBalance)}</div>
        </div>
        {role === "mitra" && tickets.some((ticket) => ticket.loketId === profile.id) && (
          <button type="button" onClick={() => { window.location.hash = "/deposit"; }} className="hidden rounded-lg bg-white/10 px-3 py-1 text-left text-[11px] leading-snug sm:block">
            {(() => {
              const mine = tickets.find((ticket) => ticket.loketId === profile.id);
              if (!mine) return null;
              return ticketPhase(mine).label;
            })()}
          </button>
        )}
        <div className="ml-auto hidden max-w-[46%] text-right text-[11px] leading-snug text-white/70 sm:block">
          {role === "superadmin"
            ? "Menyetujui tiket memindahkan Saldo Utama ke pemohon, satu kali."
            : role === "mitra"
              ? "Sisa saldo mandiri untuk dibagikan ke loket jaringan Anda."
              : "Saldo akun untuk operasional jaringan Anda."}
        </div>
      </div>
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
      {role === "superadmin" && <DepositTasks tickets={tickets} onChanged={() => {
        void (async () => {
          const session = await supabase.auth.getSession();
          const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
          const [depositRes, walletRes] = await Promise.all([
            fetch("/api/deposits", { headers }),
            fetch("/api/wallet", { headers }),
          ]);
          const body = depositRes.ok ? await depositRes.json() : null;
          const wallet = walletRes.ok ? await walletRes.json() : null;
          setTickets((body?.tickets ?? []) as CmsTicket[]);
          setMainBalance(Number(wallet?.mainBalance ?? wallet?.balance ?? 0));
        })();
      }} />}
      <div className="relative mt-3 flex min-h-0 flex-1 flex-col">
        <CapaianChart
          labels={chart.labels}
          series={chart.series}
          emptyText="Kurva menunggu data transaksi."
          caption={role === "superadmin" ? "Seluruh transaksi jaringan" : role === "mitra" ? "Sub Mitra dan loket di jaringan Anda" : "Loket di bawah Sub Mitra ini"}
          fill
          className="relative z-0 min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm"
        />
        <WelcomeGreeting className="top-14" />
      </div>
    </PageContainer>
  );
}
