import { useAuth } from "@/lib/auth";
import {
  useNetworkSummary,
  useTransactions,
  useAnnouncements,
  useProfiles,
  roleToUi,
  type TransactionRow,
} from "@/lib/hooks";
import { StatCard } from "@/components/StatCard";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatRupiah, formatWaktu, formatTanggal } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import {
  Users, Network, Store, Wallet, TrendingUp, ShoppingCart,
  ArrowUpRight, Megaphone, Package, Tags, ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const txStatusTone: Record<string, "success" | "warning" | "danger" | "info"> = {
  success: "success",
  pending: "warning",
  failed: "danger",
  refunded: "info",
};
export const txStatusLabel: Record<string, string> = {
  success: "Berhasil",
  pending: "Pending",
  failed: "Gagal",
  refunded: "Refund",
};

export function DashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { profile } = useAuth();
  const { summary, loading: sumLoading } = useNetworkSummary();
  const { transactions, loading: txLoading } = useTransactions();
  const { announcements, loading: annLoading } = useAnnouncements();
  const { profiles, loading: profLoading } = useProfiles();

  if (!profile) return null;
  const role = roleToUi(profile.role);
  const firstName = (profile.full_name || profile.email).split(" ")[0];

  const stats: { label: string; value: React.ReactNode; icon: LucideIcon; tone: any; hint?: string }[] = [];

  if (role === "mitra" || role === "submitra") {
    stats.push(
      ...(role === "mitra"
        ? [{ label: "Total Sub Mitra", value: sumLoading ? "—" : (summary?.sub_mitra_count ?? 0), icon: Network, tone: "blue" }]
        : []),
      { label: "Total Loket", value: sumLoading ? "—" : (summary?.loket_count ?? 0), icon: Store, tone: "emerald" },
      { label: "Jaringan", value: sumLoading ? "—" : (summary?.descendants ?? 0), icon: Users, tone: "cyan" },
      { label: "Saldo Jaringan", value: sumLoading ? "—" : formatRupiah(Number(summary?.total_balance ?? 0)), icon: Wallet, tone: "amber" },
      { label: "Total Transaksi", value: sumLoading ? "—" : (summary?.total_tx ?? 0), icon: ShoppingCart, tone: "slate" },
      { label: "Nilai Berhasil", value: sumLoading ? "—" : formatRupiah(Number(summary?.tx_volume ?? 0)), icon: TrendingUp, tone: "rose" },
      { label: "Sukses", value: sumLoading ? "—" : (summary?.success_tx ?? 0), icon: TrendingUp, tone: "cyan" },
    );
  } else {
    stats.push(
      { label: "Saldo", value: sumLoading ? "—" : formatRupiah(Number(summary?.total_balance ?? 0)), icon: Wallet, tone: "blue" },
      { label: "Total Transaksi", value: sumLoading ? "—" : (summary?.total_tx ?? 0), icon: ShoppingCart, tone: "emerald" },
      { label: "Nilai Berhasil", value: sumLoading ? "—" : formatRupiah(Number(summary?.tx_volume ?? 0)), icon: TrendingUp, tone: "rose" },
    );
  }

  const recentTx = transactions.slice(0, 6);
  const myAnnouncements = announcements.slice(0, 3);

  const quickLinks: Record<string, { label: string; icon: LucideIcon; path: string; tone: string }[]> = {
    mitra: [
      { label: "Sub Mitra", icon: Network, path: "/submitra", tone: "bg-blue-50 text-blue-700" },
      { label: "Loket", icon: Store, path: "/loket", tone: "bg-emerald-50 text-emerald-700" },
      { label: "Atur Harga", icon: Tags, path: "/harga", tone: "bg-amber-50 text-amber-700" },
      { label: "Laporan", icon: TrendingUp, path: "/laporan", tone: "bg-cyan-50 text-cyan-700" },
    ],
    submitra: [
      { label: "Loket", icon: Store, path: "/loket", tone: "bg-blue-50 text-blue-700" },
      { label: "Produk", icon: Package, path: "/produk", tone: "bg-emerald-50 text-emerald-700" },
      { label: "Transaksi", icon: ShoppingCart, path: "/transaksi", tone: "bg-amber-50 text-amber-700" },
      { label: "Laporan", icon: TrendingUp, path: "/laporan", tone: "bg-cyan-50 text-cyan-700" },
    ],
    loket: [
      { label: "Beli Produk", icon: ShoppingCart, path: "/beli", tone: "bg-blue-50 text-blue-700" },
      { label: "Katalog", icon: Package, path: "/produk", tone: "bg-emerald-50 text-emerald-700" },
      { label: "Mutasi Saldo", icon: Wallet, path: "/mutasi", tone: "bg-amber-50 text-amber-700" },
      { label: "Pengumuman", icon: Megaphone, path: "/pengumuman", tone: "bg-cyan-50 text-cyan-700" },
    ],
  };

  const profileName = (uid: string) => profiles.find((p) => p.id === uid)?.full_name || profiles.find((p) => p.id === uid)?.email || "—";

  return (
    <PageContainer>
      <PageHeader title={`Selamat datang, ${firstName}!`} description={`Anda masuk sebagai ${ROLE_LABELS[role]}.`}>
        <Badge tone="success"><ShieldCheck size={11} /> Terverifikasi</Badge>
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {stats.map((s, i) => (
          <StatCard key={i} {...s} />
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent transactions */}
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

        {/* Announcements */}
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
                  <Megaphone size={14} className="text-blue-600" />
                  <span className="text-sm font-semibold text-slate-800">{a.title}</span>
                  {a.pinned && <Badge tone="info">Disematkan</Badge>}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">{a.body}</p>
                <div className="text-[11px] text-slate-400 mt-2">{formatTanggal(a.created_at)}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* Quick links */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Akses Cepat</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickLinks[role]?.map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.path}
                onClick={() => onNavigate(q.path)}
                className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md transition text-left"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${q.tone}`}>
                  <Icon size={18} />
                </div>
                <span className="text-sm font-medium text-slate-700">{q.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}
