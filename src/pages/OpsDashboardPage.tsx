import { useEffect, useMemo, useState } from "react";
import { dbRoleToAppRole, useAuth } from "@/lib/auth";
import { useNetworkLoketSales, useProfiles, useTransactions, type TransactionRow } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { PageContainer } from "@/components/PageContainer";
import { CapaianChart } from "@/components/dashboard/CapaianChart";
import { WelcomeGreeting } from "@/components/dashboard/WelcomeGreeting";
import { isLivePending } from "@/lib/saleWindow";
import { formatRupiah } from "@/lib/format";
import { apiUrl } from "@/lib/apiBase";
import { buildThreeMonthSheets, buildThreeMonthSums, isCountedSale } from "@/lib/sheetChart";
import { depositRequest } from "@/lib/depositApi";
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
  if (ticket.status === "approved" || ticket.status === "reversed") return Number(ticket.amount) || Number(ticket.transferAmount) || 0;
  return Number(ticket.transferAmount) || Number(ticket.amount) || 0;
}

function DepositTasks({ tickets, onChanged }: { tickets: CmsTicket[]; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const tasks = tickets.filter((ticket) => ticket.status === "pending" && ticketPhase(ticket, Date.now(), "admin").label !== "Kedaluwarsa");
  const decide = async (id: string, action: "approve" | "cancel") => {
    setBusy(id + action);
    setNote("");
    setProblem("");
    const session = await supabase.auth.getSession();
    const result = await depositRequest("/api/deposits/decide", "POST", session.data.session?.access_token ?? "", { id, action });
    setBusy("");
    const ticket = result.body.ticket as { status?: string; amount?: number; transferAmount?: number } | undefined;
    if (!result.ok || (action === "approve" && ticket?.status !== "approved")) {
      setProblem(String(result.body.error || "Persetujuan gagal. Saldo tidak berubah."));
      return;
    }
    setNote(action === "approve" ? `Deposit disetujui. ${formatRupiah(Number(ticket?.amount) || Number(ticket?.transferAmount) || 0)} berpindah dari Saldo Utama ke pemohon.` : "Tiket dibatalkan.");
    onChanged();
  };
  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Tugas deposit</h2>
        <span className="text-xs text-slate-500">{tasks.length} tiket perlu diperiksa</span>
      </div>
      {problem && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{problem}</p>}
      {note && <p className="mb-2 text-sm text-emerald-700">{note}</p>}
      {tasks.length === 0 && <p className="text-sm text-slate-500">Belum ada tiket yang menunggu pemeriksaan.</p>}
      <div className="space-y-2">
        {tasks.map((ticket) => (
          <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">{ticket.loketName || "Pemohon"} · {ticket.applicantRole === "mitra" ? "Mitra" : ticket.applicantRole === "submitra" ? "Sub Mitra" : "Loket"} · {formatRupiah(ticket.transferAmount ?? ticket.amount)}</div>
              <div className="text-xs text-slate-500">Kode {ticket.uniqueCode || "-"} · {formatRupiah(cmsAmount(ticket))}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={ticketPhase(ticket, Date.now(), "admin").tone}>{ticketPhase(ticket, Date.now(), "admin").label}</Badge>
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
  const [providerBalance, setProviderBalance] = useState<number | null>(null);
  const [feeBalance, setFeeBalance] = useState(0);
  const [reconciledGap, setReconciledGap] = useState<number | null>(null);
  const [aligning, setAligning] = useState(false);
  const [alignNote, setAlignNote] = useState("");
  const [feeChart, setFeeChart] = useState(() => buildThreeMonthSums([]));
  const role = profile ? dbRoleToAppRole(profile.role) : "pending";
  const networkView = role === "mitra" || role === "submitra";
  const networkLoketIds = useMemo(
    () => new Set(profiles.filter((row) => row.role === "loket").map((row) => row.id)),
    [profiles],
  );
  const networkAccountIds = useMemo(() => {
    const ids = new Set(profiles.map((row) => row.id));
    if (profile?.id) ids.add(profile.id);
    return ids;
  }, [profiles, profile?.id]);
  const archive = loketRows;
  const chart = useMemo(() => buildThreeMonthSheets(archive.map((row) => ({ at: row.created_at, ok: isCountedSale(row.status) }))), [archive]);
  useEffect(() => {
    if (role !== "superadmin") return;
    let stop = false;
    (async () => {
      const session = await supabase.auth.getSession();
      const response = await fetch(apiUrl("/api/fee-report"), { headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
      const body = await response.json().catch(() => null);
      if (stop || !response.ok || !Array.isArray(body?.days)) return;
      setFeeChart(buildThreeMonthSums((body.days as { date: string; total: number }[]).map((day) => ({ at: day.date, amount: Number(day.total) || 0 }))));
    })();
    return () => { stop = true; };
  }, [role]);
  const scopedTickets = useMemo(() => {
    if (!networkView) return tickets;
    return tickets.filter((ticket) => !!ticket.loketId && networkAccountIds.has(ticket.loketId));
  }, [tickets, networkView, networkAccountIds]);

  useEffect(() => {
    let stop = false;
    (async () => {
      const session = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
      const [depositRes, walletRes] = await Promise.all([
        depositRequest("/api/deposits", "GET", session.data.session?.access_token ?? ""),
        fetch("/api/wallet", { headers }),
      ]);
      const body = depositRes.ok ? depositRes.body : null;
      const wallet = walletRes.ok ? await walletRes.json() : null;
      if (stop) return;
      setTickets((body?.tickets ?? []) as CmsTicket[]);
      setMainBalance(Number(wallet?.mainBalance ?? wallet?.balance ?? 0));
      setProviderBalance(wallet?.providerBalance == null ? null : Number(wallet.providerBalance));
      setFeeBalance(Number(wallet?.feeBalance) || 0);
      setReconciledGap(wallet?.reconciledGap == null ? null : Number(wallet.reconciledGap));
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
          depositRequest("/api/deposits", "GET", session.data.session?.access_token ?? ""),
        ]);
        if (walletRes.ok) {
          const wallet = await walletRes.json();
          setMainBalance(Number(wallet?.mainBalance ?? wallet?.balance ?? 0));
          setProviderBalance(wallet?.providerBalance == null ? null : Number(wallet.providerBalance));
          setFeeBalance(Number(wallet?.feeBalance) || 0);
          setReconciledGap(wallet?.reconciledGap == null ? null : Number(wallet.reconciledGap));
        }
        if (depositRes.ok) setTickets((depositRes.body.tickets ?? []) as CmsTicket[]);
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
  const outstanding = transactions.filter((row) => isLivePending(row.status, row.created_at) && (!networkView || networkLoketIds.has(row.user_id))).reduce((sum, row) => sum + Number(row.amount), 0);
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
        { label: "CMS Hari Ini", value: cmsWaiting ? "—" : formatRupiah(sumCms(cmsToday)), hint: `${cmsToday.length} setoran disetujui`, href: "/deposit", icon: Landmark, tone: "from-amber-500 to-orange-600" },
        { label: "CMS Bulan Ini", value: cmsWaiting ? "—" : formatRupiah(sumCms(cmsMonth)), hint: `${cmsMonth.length} setoran disetujui`, href: "/deposit", icon: Wallet, tone: "from-emerald-500 to-teal-600" },
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
          {role === "superadmin" && <div className="mt-1 text-[11px] text-amber-100/80">{providerBalance == null ? "DigiFlazz belum terbaca" : `DigiFlazz ${formatRupiah(providerBalance)}`} · Fee internal {formatRupiah(feeBalance)}{reconciledGap == null ? "" : reconciledGap > 1000 ? ` · Kelebihan tercatat ${formatRupiah(reconciledGap)}` : reconciledGap < -1000 ? ` · Belum ditarik ${formatRupiah(-reconciledGap)}` : " · Selaras"}{alignNote ? ` · ${alignNote}` : ""}</div>}
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
        {role === "superadmin" && (
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => { window.location.hash = "/laporan-fee"; }} className="rounded-lg bg-white/10 px-3 py-1 text-[11px] font-bold">Laporan Fee</button>
            <button
              type="button"
              disabled={aligning}
              onClick={() => {
                if (providerBalance == null || mainBalance == null) { setAlignNote("Saldo DigiFlazz belum terbaca."); return; }
                const gap = Math.round(mainBalance) - Math.round(providerBalance);
                if (Math.abs(gap) <= 1) { setAlignNote("Saldo Utama sudah mengikuti DigiFlazz."); return; }
                const warning = gap > 0
                  ? `Saldo Utama ${formatRupiah(mainBalance)} akan menjadi ${formatRupiah(providerBalance)} agar mengikuti DigiFlazz. Dompet loket tidak dikurangi. Lanjutkan?`
                  : `Saldo Utama ${formatRupiah(mainBalance)} akan naik menjadi ${formatRupiah(providerBalance)} agar mengikuti DigiFlazz. Lanjutkan?`;
                if (!window.confirm(warning)) return;
                void (async () => {
                  setAligning(true);
                  setAlignNote("");
                  const session = await supabase.auth.getSession();
                  const response = await fetch(apiUrl("/api/wallet/normalize"), { method: "POST", headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
                  const body = await response.json().catch(() => null);
                  setAligning(false);
                  if (!response.ok) { setAlignNote(String(body?.error || "Penyetaraan gagal.")); return; }
                  setMainBalance(Number(body.balance) || 0);
                  setProviderBalance(body.providerBalance == null ? null : Number(body.providerBalance));
                  setFeeBalance(Number(body.feeBalance) || 0);
                  setReconciledGap(body.reconciledGap == null ? null : Number(body.reconciledGap));
                  setAlignNote(String(body.message || "Saldo disetarakan."));
                })();
              }}
              className="rounded-lg bg-amber-400 px-3 py-1 text-[11px] font-bold text-slate-950 disabled:opacity-60"
            >{aligning ? "Menormalkan..." : "Normalisasi saldo"}</button>
          </div>
        )}
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
            depositRequest("/api/deposits", "GET", session.data.session?.access_token ?? ""),
            fetch("/api/wallet", { headers }),
          ]);
          const body = depositRes.ok ? depositRes.body : null;
          const wallet = walletRes.ok ? await walletRes.json() : null;
          setTickets((body?.tickets ?? []) as CmsTicket[]);
          setMainBalance(Number(wallet?.mainBalance ?? wallet?.balance ?? 0));
          setProviderBalance(wallet?.providerBalance == null ? null : Number(wallet.providerBalance));
          setFeeBalance(Number(wallet?.feeBalance) || 0);
          setReconciledGap(wallet?.reconciledGap == null ? null : Number(wallet.reconciledGap));
        })();
      }} />}
      {role === "superadmin" ? (
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="relative flex min-h-[220px] flex-col">
            <CapaianChart
              labels={chart.labels}
              series={chart.series}
              emptyText="Kurva menunggu data transaksi."
              caption="Seluruh transaksi jaringan"
              fill
              className="relative z-0 min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm"
            />
            <WelcomeGreeting className="top-12" />
          </div>
          <div className="flex min-h-[220px] flex-col">
            <CapaianChart
              title="Capaian Fee"
              labels={feeChart.labels}
              series={feeChart.series}
              emptyText="Kurva fee menunggu transaksi sukses."
              caption="Fee DigiFlazz + Mentari, 3 bulan berjalan"
              formatValue={(value) => formatRupiah(value)}
              axisFormat={(value) => new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(value)}
              integerScale={false}
              emptyMax={100000}
              fill
              className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm"
            />
          </div>
        </div>
      ) : (
        <div className="relative mt-3 flex min-h-0 flex-1 flex-col">
          <CapaianChart
            labels={chart.labels}
            series={chart.series}
            emptyText="Kurva menunggu data transaksi."
            caption={role === "mitra" ? "Sub Mitra dan loket di jaringan Anda" : "Loket di bawah Sub Mitra ini"}
            fill
            className="relative z-0 min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm"
          />
          <WelcomeGreeting className="top-14" />
        </div>
      )}
    </PageContainer>
  );
}
