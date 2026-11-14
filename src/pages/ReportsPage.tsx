import { useMemo } from "react";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { useNetworkLoketSales, useTransactions, useProfiles, useWallets, type TransactionRow } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatRupiah } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORY_COLORS, type ProductCategory, type Role } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/nav";
import { networkOwners, profileLabel, profilesWithSelf } from "@/lib/network";
import { TrendingUp, BarChart3, PieChart, Wallet } from "lucide-react";

export function ReportsPage() {
  const { profile } = useAuth();
  const { transactions, loading } = useTransactions();
  const networkSales = useNetworkLoketSales();
  const { profiles } = useProfiles();
  const { wallets } = useWallets();
  if (!profile) return null;
  const role = dbRoleToAppRole(profile.role);
  const directory = profilesWithSelf(profiles, profile);

  const visibleTx = [...transactions, ...networkSales.filter((row) => !transactions.some((item) => item.id === row.id))].filter((t) => t.status === "success");

  const byCategory = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    Object.keys(CATEGORY_LABELS).forEach((c) => { map[c] = { count: 0, total: 0 }; });
    visibleTx.forEach((t) => {
      const cat = t.category_slug_snapshot;
      if (!map[cat]) map[cat] = { count: 0, total: 0 };
      map[cat].count += 1;
      map[cat].total += Number(t.amount);
    });
    return map;
  }, [visibleTx]);

  const totalRevenue = visibleTx.reduce((s, t) => s + Number(t.amount), 0);
  const maxCat = Math.max(1, ...Object.values(byCategory).map((v) => v.total));

  const byRole = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    visibleTx.forEach((t) => {
      const u = directory.find((x) => x.id === t.user_id);
      const r = u ? dbRoleToAppRole(u.role) : "unknown";
      if (!map[r]) map[r] = { count: 0, total: 0 };
      map[r].count += 1;
      map[r].total += Number(t.amount);
    });
    return map;
  }, [visibleTx, directory]);

  const last7 = useMemo(() => {
    const days: { label: string; total: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      const dayTx = visibleTx.filter((t) => new Date(t.created_at).toDateString() === key);
      days.push({
        label: d.toLocaleDateString("id-ID", { weekday: "short", day: "2-digit" }),
        total: dayTx.reduce((s, t) => s + Number(t.amount), 0),
        count: dayTx.length,
      });
    }
    return days;
  }, [visibleTx]);
  const maxDay = Math.max(1, ...last7.map((d) => d.total));

  const topLokets = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    visibleTx.forEach((t) => {
      if (!map[t.user_id]) map[t.user_id] = { count: 0, total: 0 };
      map[t.user_id].count += 1;
      map[t.user_id].total += Number(t.amount);
    });
    return Object.entries(map)
      .map(([uid, v]) => ({ user: directory.find((p) => p.id === uid), ...v }))
      .filter((x) => x.user)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [visibleTx, directory]);

  const networkRecap = useMemo(() => {
    const map = new Map<string, { label: string; detail: string; count: number; total: number }>();
    visibleTx.forEach((t) => {
      const owners = networkOwners(t.user_id, directory);
      let key = t.user_id;
      let label = profileLabel(owners.account);
      let detail = "Akun pelaku";
      if (role === "superadmin") {
        key = owners.mitra?.id ?? "tanpa-mitra";
        label = owners.mitra ? profileLabel(owners.mitra) : "Belum tertaut ke Mitra";
        detail = "Seluruh Sub Mitra dan Loket di jaringan mitra";
      } else if (role === "mitra") {
        const direct = owners.submitra && owners.submitra.parent_id === profile.id
          ? owners.submitra
          : owners.account?.parent_id === profile.id
            ? owners.account
            : null;
        key = direct?.id ?? t.user_id;
        label = profileLabel(direct ?? owners.account);
        detail = (direct?.role as string) === "submitra" || (direct?.role as string) === "sub_mitra"
          ? "Rekap Sub Mitra beserta loket di bawahnya"
          : "Loket langsung di bawah Mitra";
      } else if (role === "submitra") {
        key = owners.account?.id ?? t.user_id;
        label = profileLabel(owners.account);
        detail = "Loket di bawah Sub Mitra";
      }
      const current = map.get(key) ?? { label, detail, count: 0, total: 0 };
      current.count += 1;
      current.total += Number(t.amount);
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [visibleTx, directory, role, profile.id]);

  const totalWalletBalance = wallets.reduce((s, w) => s + Number(w.balance), 0);

  const userName = (uid: string) => {
    const p = directory.find((x) => x.id === uid);
    return p ? (p.full_name || p.email) : "—";
  };

  return (
    <PageContainer>
      <PageHeader
        title="Laporan"
        description={
          role === "superadmin"
            ? "Muara data seluruh jaringan: Mitra, Sub Mitra, dan Loket."
            : role === "mitra"
              ? "Rekap Sub Mitra dan Loket di jaringan Anda."
              : role === "submitra"
                ? "Rekap semua loket yang berada di bawah Anda."
                : "Ringkasan transaksi akun Anda."
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs text-slate-500 uppercase">Total Transaksi</span><BarChart3 size={18} className="text-blue-500" /></div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{loading ? "—" : visibleTx.length}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs text-slate-500 uppercase">Nilai Transaksi</span><TrendingUp size={18} className="text-emerald-500" /></div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">{loading ? "—" : formatRupiah(totalRevenue)}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs text-slate-500 uppercase">Rata-rata / Transaksi</span><PieChart size={18} className="text-amber-500" /></div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{loading ? "—" : formatRupiah(visibleTx.length ? Math.round(totalRevenue / visibleTx.length) : 0)}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs text-slate-500 uppercase">Total Saldo Jaringan</span><Wallet size={18} className="text-cyan-500" /></div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{formatRupiah(totalWalletBalance)}</div>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title={role === "superadmin" ? "Rekap per Mitra" : role === "mitra" ? "Rekap Jaringan" : "Rekap Loket"}
          subtitle="Transaksi berhasil naik dari loket ke atasan di jaringannya"
        />
        <div className="divide-y divide-slate-100">
          {networkRecap.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Belum ada data.</div>}
          {networkRecap.map((row) => (
            <div key={`${row.label}-${row.detail}`} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{row.label}</div>
                <div className="text-xs text-slate-500">{row.detail} • {row.count} transaksi</div>
              </div>
              <div className="text-sm font-semibold text-slate-800">{formatRupiah(row.total)}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader title="Transaksi 7 Hari Terakhir" subtitle="Nilai transaksi berhasil per hari" />
          <CardBody>
            <div className="flex h-64 max-h-80 w-full items-end justify-between gap-2 overflow-hidden">
              {last7.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="text-[10px] text-slate-500 font-medium">{formatRupiah(d.total).replace("Rp", "")}</div>
                  <div className="relative h-40 w-full rounded-t-lg bg-slate-100">
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg transition-all"
                      style={{ height: `${(d.total / maxDay) * 100}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">{d.label}</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Transaksi per Kategori" subtitle="Distribusi nilai transaksi" />
          <CardBody className="space-y-3">
            {(Object.entries(byCategory) as [string, { count: number; total: number }][])
              .sort((a, b) => b[1].total - a[1].total)
              .map(([cat, v]) => (
                <div key={cat}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CATEGORY_COLORS[cat as ProductCategory] || "bg-slate-100 text-slate-600"}`}>{CATEGORY_LABELS[cat as ProductCategory] || cat}</span>
                      <span className="text-slate-500">{v.count} transaksi</span>
                    </span>
                    <span className="font-semibold text-slate-800">{formatRupiah(v.total)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(v.total / maxCat) * 100}%` }} />
                  </div>
                </div>
              ))}
            {totalRevenue === 0 && <div className="text-center text-sm text-slate-500 py-4">Belum ada data transaksi.</div>}
          </CardBody>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Loket Teraktif" subtitle="Berdasarkan nilai transaksi" />
          <div className="divide-y divide-slate-100">
            {topLokets.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Belum ada data.</div>}
            {topLokets.map((l, i) => (
              <div key={l.user!.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{userName(l.user!.id)}</div>
                  <div className="text-xs text-slate-500">{l.count} transaksi • {ROLE_LABELS[dbRoleToAppRole(l.user!.role) as Role]}</div>
                </div>
                <div className="text-sm font-semibold text-slate-800">{formatRupiah(l.total)}</div>
              </div>
            ))}
          </div>
        </Card>

        {(role === "superadmin" || role === "mitra") && (
          <Card>
            <CardHeader title="Transaksi per Tingkat Pengguna" />
            <div className="divide-y divide-slate-100">
              {Object.entries(byRole).map(([r, v]) => (
                <div key={r} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone="blue">{ROLE_LABELS[r as Role] ?? r}</Badge>
                    <span className="text-xs text-slate-500">{v.count} transaksi</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-800">{formatRupiah(v.total)}</span>
                </div>
              ))}
              {Object.keys(byRole).length === 0 && <div className="p-8 text-center text-sm text-slate-500">Belum ada data.</div>}
            </div>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
