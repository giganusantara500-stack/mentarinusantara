import { useMemo, useState } from "react";
import { dbRoleToAppRole, useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/nav";
import {
  useTransactions,
  useMyWallet,
  useProfiles,
  useAnnouncements,
  type TransactionRow,
} from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatRupiah, formatWaktu, formatTanggal, initials } from "@/lib/format";
import { belongsToNetwork, profilesWithSelf } from "@/lib/network";
import { cn } from "@/lib/utils";
import { LineChart, type LineSeries } from "@/components/dashboard/LineChart";
import {
  Store, Wallet, TrendingUp, ShoppingCart,
  ArrowUpRight, Megaphone, Users, Package,
  Phone, UserCircle, BadgeCheck, Copy, CheckCircle2,
  Ban, ArrowDownToLine, ArrowUpFromLine,
  CalendarDays, Coins, Receipt, Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const txStatusTone: Record<string, "success" | "warning" | "danger" | "info"> = {
  success: "success",
  pending: "warning",
  failed: "danger",
  refunded: "info",
};
const txStatusLabel: Record<string, string> = {
  success: "Berhasil",
  pending: "Pending",
  failed: "Gagal",
  refunded: "Refund",
};

function BannerInfoItem({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
        <Icon size={15} className="text-purple-200" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-purple-300/80 uppercase tracking-wide">{label}</div>
        <div className="text-sm font-semibold text-white truncate">{value}</div>
      </div>
    </div>
  );
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <button onClick={copy} className="flex items-center gap-1.5 text-purple-200/80 hover:text-white transition group">
      {copied ? <CheckCircle2 size={13} className="text-emerald-300" /> : <Copy size={13} />}
      <span className="text-[11px] group-hover:underline">Salin</span>
    </button>
  );
}

interface MetricCardProps {
  label: string;
  amount: number;
  count: number;
  icon: LucideIcon;
  gradient: string;
  iconBg: string;
  loading?: boolean;
}

function MetricCard({ label, amount, count, icon: Icon, gradient, iconBg, loading }: MetricCardProps) {
  return (
    <div className={cn("rounded-2xl p-5 shadow-sm relative overflow-hidden", gradient)}>
      <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/8" />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-white/90 uppercase tracking-wide">{label}</span>
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", iconBg)}>
            <Icon size={18} className="text-white" />
          </div>
        </div>
        <div className="text-2xl font-bold text-white tracking-tight">
          {loading ? "—" : formatRupiah(amount)}
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-white/70">
          <Receipt size={13} />
          <span className="text-xs font-medium">{loading ? "—" : `${count} transaksi`}</span>
        </div>
      </div>
    </div>
  );
}

function buildDailySeries(transactions: TransactionRow[], months: number) {
  const now = new Date();
  const labels: string[] = [];
  const currentMonthValues: number[] = [];
  const prevMonth1Values: number[] = [];
  const prevMonth2Values: number[] = [];

  const daysInCurrent = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  for (let d = 1; d <= daysInCurrent; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), d);
    if (date > now) break;
    labels.push(`${d}/${now.getMonth() + 1}`);

    // Current month
    const dayStart = new Date(now.getFullYear(), now.getMonth(), d, 0, 0, 0);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), d, 23, 59, 59);
    const currentTotal = transactions
      .filter((t) => t.status === "success" && new Date(t.created_at) >= dayStart && new Date(t.created_at) <= dayEnd)
      .reduce((sum, t) => sum + Number(t.amount), 0);
    currentMonthValues.push(currentTotal);

    // Previous month 1 (same day offset)
    const pm1Date = new Date(now.getFullYear(), now.getMonth() - 1, d);
    if (pm1Date <= now) {
      const pm1Start = new Date(now.getFullYear(), now.getMonth() - 1, d, 0, 0, 0);
      const pm1End = new Date(now.getFullYear(), now.getMonth() - 1, d, 23, 59, 59);
      const pm1Total = transactions
        .filter((t) => t.status === "success" && new Date(t.created_at) >= pm1Start && new Date(t.created_at) <= pm1End)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      prevMonth1Values.push(pm1Total);
    } else {
      prevMonth1Values.push(0);
    }

    // Previous month 2
    const pm2Date = new Date(now.getFullYear(), now.getMonth() - 2, d);
    if (pm2Date <= now) {
      const pm2Start = new Date(now.getFullYear(), now.getMonth() - 2, d, 0, 0, 0);
      const pm2End = new Date(now.getFullYear(), now.getMonth() - 2, d, 23, 59, 59);
      const pm2Total = transactions
        .filter((t) => t.status === "success" && new Date(t.created_at) >= pm2Start && new Date(t.created_at) <= pm2End)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      prevMonth2Values.push(pm2Total);
    } else {
      prevMonth2Values.push(0);
    }
  }

  const monthName = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return d.toLocaleDateString("id-ID", { month: "short" });
  };

  const series: LineSeries[] = [
    { name: monthName(0) + " (berjalan)", color: "#7c3aed", values: currentMonthValues },
    { name: monthName(-1), color: "#06b6d4", values: prevMonth1Values },
    { name: monthName(-2), color: "#f59e0b", values: prevMonth2Values },
  ];

  return { labels, series };
}

export function MitraDashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { profile } = useAuth();
  const { transactions, loading: txLoading } = useTransactions();
  const { announcements, loading: annLoading } = useAnnouncements();
  const { profiles, loading: profLoading } = useProfiles();
  const { wallet, loading: walletLoading } = useMyWallet();

  if (!profile) return null;
  const appRole = dbRoleToAppRole(profile.role);
  const isMitra = appRole === "mitra";
  const roleLabel = appRole === "pending" ? "Akun" : ROLE_LABELS[appRole];
  const firstName = (profile.full_name || profile.email).split(" ")[0];
  const isBlocked = profile.status === "suspended";

  const mySaldo = wallet ? Number(wallet.balance) : 0;
  const pendingSaldo = wallet ? Number(wallet.pending_balance) : 0;
  const network = profilesWithSelf(profiles, profile);
  const subMitraCount = profiles.filter((p) => ((p.role as string) === "submitra" || (p.role as string) === "sub_mitra") && p.parent_id === profile.id).length;
  const loketCount = profiles.filter((p) => p.role === "loket" && belongsToNetwork(p.id, profile.id, network)).length;

  // Calculate metrics from transactions
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

  const successTx = transactions.filter((t) => t.status === "success");

  const todayTx = successTx.filter((t) => new Date(t.created_at) >= todayStart);
  const monthTx = successTx.filter((t) => new Date(t.created_at) >= monthStart);

  const todayVolume = todayTx.reduce((sum, t) => sum + Number(t.amount), 0);
  const monthVolume = monthTx.reduce((sum, t) => sum + Number(t.amount), 0);
  const todayFee = todayTx.reduce((sum, t) => sum + Number(t.profit), 0);
  const monthFee = monthTx.reduce((sum, t) => sum + Number(t.profit), 0);

  const chartData = useMemo(() => buildDailySeries(transactions, 3), [transactions]);

  const recentTx = transactions.slice(0, 6);
  const myAnnouncements = announcements.slice(0, 3);
  const profileName = (uid: string) => profiles.find((p) => p.id === uid)?.full_name || profiles.find((p) => p.id === uid)?.email || "—";
  const mySubMitra = profiles.filter((p) => ((p.role as string) === "submitra" || (p.role as string) === "sub_mitra") && p.parent_id === profile.id).slice(0, 5);

  const quickActions: { label: string; icon: LucideIcon; path: string; tone: string }[] = [
    ...(isMitra ? [{ label: "Sub Mitra", icon: Users, path: "/submitra", tone: "bg-purple-50 text-purple-700" }] : []),
    { label: "Loket", icon: Store, path: "/loket", tone: "bg-emerald-50 text-emerald-700" },
    { label: "Produk", icon: Package, path: "/produk", tone: "bg-amber-50 text-amber-700" },
    { label: "Transaksi", icon: ShoppingCart, path: "/transaksi", tone: "bg-rose-50 text-rose-700" },
    { label: "Mutasi Saldo", icon: Wallet, path: "/mutasi", tone: "bg-cyan-50 text-cyan-700" },
    { label: "Laporan", icon: TrendingUp, path: "/laporan", tone: "bg-slate-100 text-slate-700" },
  ];

  const monthNameFull = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <PageContainer>
      {/* ===== Profile Banner ===== */}
      <div className="rounded-2xl overflow-hidden shadow-lg mb-6 bg-gradient-to-br from-purple-950 via-violet-900 to-purple-800 relative">
        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 15% 25%, #a78bfa 0%, transparent 40%), radial-gradient(circle at 85% 75%, #7c3aed 0%, transparent 35%)",
        }} />
        <div className="relative p-6 sm:p-7">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-white text-xl font-bold shrink-0 backdrop-blur-sm">
              {initials(profile.full_name || profile.email)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <h1 className="text-xl font-bold text-white truncate">Selamat datang, {firstName}!</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                  isBlocked
                    ? "bg-rose-500/20 border-rose-400/30 text-rose-200"
                    : "bg-emerald-500/20 border-emerald-400/30 text-emerald-200"
                )}>
                  {isBlocked ? <Ban size={13} /> : <BadgeCheck size={13} />}
                  {isBlocked ? "Status Aktif: Nonaktif" : "Status Aktif: Aktif"}
                </span>
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                  isBlocked
                    ? "bg-rose-500/20 border-rose-400/30 text-rose-200"
                    : "bg-purple-500/20 border-purple-400/30 text-purple-200"
                )}>
                  <Ban size={13} />
                  {isBlocked ? "Status Blokir: Diblokir" : "Status Blokir: Tidak"}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-5 border-t border-white/10">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px] text-purple-300/80 uppercase tracking-wide">ID {roleLabel}</span>
                <CopyableId value={profile.username || profile.id.slice(0, 8)} />
              </div>
              <div className="text-sm font-semibold text-white font-mono">{profile.username || profile.id.slice(0, 8)}</div>
            </div>
            <BannerInfoItem icon={UserCircle} label={`Nama ${roleLabel}`} value={profile.full_name || "—"} />
            <BannerInfoItem icon={Phone} label="Nomor Telepon" value={profile.phone || "—"} />
            <BannerInfoItem icon={BadgeCheck} label="Nama Usaha" value={profile.business_name || "—"} />
          </div>
        </div>
      </div>

      {/* ===== 4 Stat Cards ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Transaksi Hari Ini"
          amount={todayVolume}
          count={todayTx.length}
          icon={Activity}
          gradient="bg-gradient-to-br from-purple-600 to-violet-700"
          iconBg="bg-white/15"
          loading={txLoading}
        />
        <MetricCard
          label={`Transaksi ${monthNameFull}`}
          amount={monthVolume}
          count={monthTx.length}
          icon={CalendarDays}
          gradient="bg-gradient-to-br from-teal-500 to-cyan-600"
          iconBg="bg-white/15"
          loading={txLoading}
        />
        <MetricCard
          label="Komisi/Fee Hari Ini"
          amount={todayFee}
          count={todayTx.length}
          icon={Coins}
          gradient="bg-gradient-to-br from-amber-500 to-orange-600"
          iconBg="bg-white/15"
          loading={txLoading}
        />
        <MetricCard
          label={`Komisi/Fee ${monthNameFull}`}
          amount={monthFee}
          count={monthTx.length}
          icon={TrendingUp}
          gradient="bg-gradient-to-br from-rose-500 to-pink-600"
          iconBg="bg-white/15"
          loading={txLoading}
        />
      </div>

      {/* ===== Transaction Trend Chart ===== */}
      <Card className="mb-6">
        <CardHeader
          title="Tren Transaksi Harian"
          subtitle="Perbandingan 3 bulan terakhir (hanya transaksi berhasil)"
          action={
            <div className="flex items-center gap-3">
              {chartData.series.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-xs text-slate-600 font-medium">{s.name}</span>
                </div>
              ))}
            </div>
          }
        />
        <div className="w-full overflow-visible px-5 pb-5">
          <LineChart
            labels={chartData.labels}
            series={chartData.series}
            formatValue={(n) => formatRupiah(n)}
            height={288}
            emptyText="Belum ada transaksi pada 3 bulan terakhir."
          />
        </div>
      </Card>

      {/* ===== Saldo + Quick Actions ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 rounded-2xl bg-gradient-to-br from-purple-600 to-violet-700 p-6 shadow-md relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/5" />
          <div className="absolute -right-4 -bottom-12 w-32 h-32 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={18} className="text-purple-200" />
              <span className="text-sm text-purple-100 font-medium">Saldo Deposit {roleLabel}</span>
            </div>
            <div className="text-4xl font-bold text-white tracking-tight mt-2">
              {walletLoading ? "—" : formatRupiah(mySaldo)}
            </div>
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/15">
              <div>
                <div className="text-[11px] text-purple-200/80 uppercase tracking-wide">Saldo Pending</div>
                <div className="text-sm font-semibold text-white">{walletLoading ? "—" : formatRupiah(pendingSaldo)}</div>
              </div>
              <div className="h-8 w-px bg-white/15" />
              <div>
                <div className="text-[11px] text-purple-200/80 uppercase tracking-wide">Status Wallet</div>
                <div className="text-sm font-semibold text-white">{wallet?.status === "active" ? "Aktif" : wallet?.status ?? "—"}</div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" size="sm" onClick={() => onNavigate("/mutasi")} className="border-white/30 text-white hover:bg-white/10">
                <ArrowDownToLine size={14} /> Mutasi Saldo
              </Button>
              <Button variant="outline" size="sm" onClick={() => onNavigate("/transaksi")} className="border-white/30 text-white hover:bg-white/10">
                <ArrowUpFromLine size={14} /> Riwayat Transaksi
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Users size={18} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Ringkasan Jaringan</span>
          </div>
          <div className="space-y-3">
            {isMitra && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Users size={15} className="text-emerald-600" />
                </div>
                <span className="text-sm text-slate-600">Sub Mitra</span>
              </div>
              <span className="text-lg font-bold text-slate-900">{profLoading ? "—" : subMitraCount}</span>
            </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                  <Store size={15} className="text-cyan-600" />
                </div>
                <span className="text-sm text-slate-600">Loket</span>
              </div>
              <span className="text-lg font-bold text-slate-900">{profLoading ? "—" : loketCount}</span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                  <TrendingUp size={15} className="text-rose-600" />
                </div>
                <span className="text-sm text-slate-600">Nilai Berhasil</span>
              </div>
              <span className="text-sm font-bold text-slate-900">{txLoading ? "—" : formatRupiah(monthVolume)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Quick Actions ===== */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
        {quickActions.map((q) => {
          const Icon = q.icon;
          return (
            <button
              key={q.path}
              onClick={() => onNavigate(q.path)}
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white border border-slate-200 hover:border-purple-400 hover:shadow-md transition group"
            >
              <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center transition group-hover:scale-105", q.tone)}>
                <Icon size={20} />
              </div>
              <span className="text-xs font-medium text-slate-700 text-center">{q.label}</span>
            </button>
          );
        })}
      </div>

      {/* ===== Recent Transactions + Announcements + Sub Mitra ===== */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Transaksi Terbaru"
            subtitle="Transaksi di jaringan Anda"
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("/transaksi")}>
                Lihat semua <ArrowUpRight size={14} />
              </Button>
            }
          />
          <div className="divide-y divide-slate-100">
            {txLoading && <div className="p-8 text-center text-sm text-slate-500">Memuat transaksi...</div>}
            {!txLoading && recentTx.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">Belum ada transaksi.</div>
            )}
            {!txLoading && recentTx.map((t: TransactionRow) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold bg-slate-100 text-slate-600">
                  {t.product_name_snapshot.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{t.product_name_snapshot}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {profileName(t.user_id)} • {t.customer_number}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-800">{formatRupiah(t.amount)}</div>
                  <div className="text-[11px] text-slate-400">{formatWaktu(t.created_at)}</div>
                </div>
                <Badge tone={txStatusTone[t.status]}>{txStatusLabel[t.status]}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Pengumuman"
              action={
                <Button variant="ghost" size="sm" onClick={() => onNavigate("/pengumuman")}>
                  Semua
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {annLoading && <p className="text-sm text-slate-500">Memuat...</p>}
              {!annLoading && myAnnouncements.length === 0 && (
                <p className="text-sm text-slate-500">Belum ada pengumuman.</p>
              )}
              {myAnnouncements.map((a) => (
                <div key={a.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60">
                  <div className="flex items-center gap-2 mb-1">
                    <Megaphone size={14} className="text-purple-600" />
                    <span className="text-sm font-semibold text-slate-800">{a.title}</span>
                    {a.pinned && <Badge tone="info">Disematkan</Badge>}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{a.body}</p>
                  <div className="text-[11px] text-slate-400 mt-2">{formatTanggal(a.created_at)}</div>
                </div>
              ))}
            </CardBody>
          </Card>

          {isMitra && <Card>
            <CardHeader
              title="Sub Mitra Saya"
              subtitle={profLoading ? "Memuat..." : `${subMitraCount} sub mitra`}
              action={
                <Button variant="ghost" size="sm" onClick={() => onNavigate("/submitra")}>
                  Kelola <ArrowUpRight size={14} />
                </Button>
              }
            />
            <div className="divide-y divide-slate-100">
              {profLoading && <div className="p-5 text-center text-sm text-slate-500">Memuat...</div>}
              {!profLoading && mySubMitra.length === 0 && (
                <div className="p-5 text-center text-sm text-slate-500">Belum ada sub mitra.</div>
              )}
              {!profLoading && mySubMitra.map((s) => {
                const sLoketCount = profiles.filter((p) => p.role === "loket" && p.parent_id === s.id).length;
                return (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/60">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ backgroundColor: "#0f766e" }}>
                      {initials(s.full_name || s.email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{s.full_name || s.email}</div>
                      <div className="text-xs text-slate-500 truncate">{s.business_name || s.username || "—"}</div>
                    </div>
                    <Badge tone="blue">{sLoketCount} loket</Badge>
                  </div>
                );
              })}
            </div>
          </Card>}
        </div>
      </div>
    </PageContainer>
  );
}
