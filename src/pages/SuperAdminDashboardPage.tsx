import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/brand";
import { useAllProfiles } from "@/lib/hooks";
import { useSuperAdminDashboard } from "@/lib/superadminDashboard";
import { StatCard } from "@/components/StatCard";
import { PageContainer } from "@/components/PageContainer";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { AccountReportTable, ACCOUNT_ROLE_LABEL } from "@/components/dashboard/AccountReportTable";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Select } from "@/components/ui/Form";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { txStatusLabel, txStatusTone } from "@/pages/DashboardPage";
import {
  ArrowDownToLine,
  CircleDollarSign,
  Coins,
  ShieldCheck,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  Network,
} from "lucide-react";

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const ROLE_ORDER = ["mitra", "submitra", "loket"];

function jakartaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function presetRange(days: number) {
  const end = jakartaToday();
  return { start: shiftDays(end, -(days - 1)), end };
}

const PRESETS = [
  { label: "7 hari", days: 7 },
  { label: "30 hari", days: 30 },
  { label: "90 hari", days: 90 },
];

export function SuperAdminDashboardPage() {
  const { profile } = useAuth();
  const { profiles } = useAllProfiles();
  const [range, setRange] = useState(() => presetRange(30));
  const [rootId, setRootId] = useState("");

  const inOrder = range.start <= range.end;
  const start = inOrder ? range.start : range.end;
  const end = inOrder ? range.end : range.start;
  const { data, loading, error } = useSuperAdminDashboard(start, end, rootId || null);

  if (!profile) return null;

  const networkOptions = profiles
    .filter((p) => ROLE_ORDER.includes(p.role))
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        (a.full_name || a.email).localeCompare(b.full_name || b.email),
    );

  const s = data?.summary;
  const waiting = loading || !s;
  const count = (n?: number) => (waiting ? "—" : (n ?? 0));
  const rupiah = (n?: number) => (waiting ? "—" : formatRupiah(n ?? 0));

  const dailyPoints = (data?.daily ?? []).map((d) => ({
    label: `${d.date.slice(8)}/${d.date.slice(5, 7)}`,
    value: d.volume,
  }));
  const monthlyPoints = (data?.monthly ?? []).map((m) => ({
    label: `${MONTHS_ID[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(2, 4)}`,
    value: m.volume,
  }));
  const growthPoints = (data?.network_growth ?? []).map((g) => ({
    label: `${MONTHS_ID[Number(g.month.slice(5, 7)) - 1]} ${g.month.slice(2, 4)}`,
    value: g.mitra + g.submitra + g.loket,
  }));
  const topDeposit = [...(data?.accounts ?? [])]
    .filter((a) => a.deposit > 0)
    .sort((a, b) => b.deposit - a.deposit)
    .slice(0, 5);

  return (
    <PageContainer>
      <PageHeader title="Dashboard Super Admin" description={`${profile.full_name} memantau seluruh jaringan ${PLATFORM_NAME}.`}>
        <Badge tone="success"><ShieldCheck size={11} /> Terverifikasi</Badge>
      </PageHeader>

      <Card className="mb-6">
        <CardBody className="grid gap-4 md:grid-cols-3">
          <Field label="Dari tanggal">
            <Input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
          </Field>
          <Field label="Sampai tanggal">
            <Input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
          </Field>
          <Field label="Jaringan (Mitra, Sub Mitra, atau Loket)">
            <Select value={rootId} onChange={(e) => setRootId(e.target.value)}>
              <option value="">Seluruh jaringan</option>
              {networkOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {ACCOUNT_ROLE_LABEL[p.role as "mitra" | "submitra" | "loket"]} • {p.business_name || p.full_name || p.email}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-3 flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setRange(presetRange(p.days))}
                className="px-3 py-1.5 text-xs font-medium rounded-full border border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700 transition"
              >
                {p.label}
              </button>
            ))}
            {!inOrder && (
              <span className="text-xs text-amber-700">Tanggal akhir lebih awal dari tanggal awal, rentang dibalik otomatis.</span>
            )}
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">
          Data dashboard gagal dimuat: {error}
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-700 mb-3">Hari Ini dan Rentang Terpilih</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          label="Transaksi Hari Ini"
          value={count(s?.today_tx)}
          icon={ShoppingCart}
          tone="slate"
          hint={waiting ? undefined : `Nilai sukses ${formatRupiah(s.today_volume)}`}
        />
        <StatCard label="CMS Hari Ini" value={rupiah(s?.today_cms)} icon={Coins} tone="emerald" />
        <StatCard
          label="Deposit"
          value={rupiah(s?.deposit_total)}
          icon={ArrowDownToLine}
          tone="blue"
          hint={waiting ? undefined : `Saldo jaringan ${formatRupiah(s.total_balance)}`}
        />
        <StatCard
          label="Nilai Transaksi Berhasil"
          value={rupiah(s?.volume)}
          icon={CircleDollarSign}
          tone="rose"
          hint={waiting ? undefined : `${s.success_tx} transaksi sukses, ${s.failed_tx} gagal`}
        />
      </div>

      <h2 className="text-sm font-semibold text-slate-700 mb-3">Jaringan</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Mitra" value={count(s?.total_mitra)} icon={Users} tone="blue" />
        <StatCard label="Total Sub Mitra" value={count(s?.total_submitra)} icon={Network} tone="cyan" />
        <StatCard label="Total Loket" value={count(s?.total_loket)} icon={Store} tone="emerald" />
        <StatCard label="Akun Aktif" value={count(s?.active_accounts)} icon={Wallet} tone="amber" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader title="Transaksi Harian" subtitle="Nilai transaksi sukses per hari pada rentang terpilih" />
          <CardBody className="w-full overflow-hidden">
            {loading ? (
              <p className="py-10 text-center text-sm text-slate-500">Memuat grafik...</p>
            ) : (
              <TrendChart data={dailyPoints} formatValue={formatRupiah} emptyText="Tidak ada transaksi pada rentang ini." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Transaksi Bulanan" subtitle="Nilai transaksi sukses, 12 bulan terakhir" />
          <CardBody className="w-full overflow-hidden">
            {loading ? (
              <p className="py-10 text-center text-sm text-slate-500">Memuat grafik...</p>
            ) : (
              <TrendChart data={monthlyPoints} formatValue={formatRupiah} emptyText="Belum ada transaksi." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Perkembangan Jaringan" subtitle="Akun Mitra, Sub Mitra, dan Loket baru per bulan" />
          <CardBody className="w-full overflow-hidden">
            {loading ? (
              <p className="py-10 text-center text-sm text-slate-500">Memuat grafik...</p>
            ) : (
              <TrendChart data={growthPoints} formatValue={(n) => `${n} akun`} emptyText="Belum ada akun." />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ringkasan Deposit" subtitle="Lima akun dengan deposit terbesar pada rentang terpilih" />
          <div className="divide-y divide-slate-100">
            {loading && <div className="p-6 text-center text-sm text-slate-500">Memuat...</div>}
            {!loading && topDeposit.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">Belum ada deposit pada rentang ini.</div>
            )}
            {!loading &&
              topDeposit.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{a.name}</div>
                    <div className="text-xs text-slate-500">{ACCOUNT_ROLE_LABEL[a.role]}</div>
                  </div>
                  <div className="text-sm font-semibold text-slate-800">{formatRupiah(a.deposit)}</div>
                </div>
              ))}
          </div>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Laporan Mitra, Sub Mitra, dan Loket" subtitle="Data pada rentang tanggal dan jaringan terpilih" />
        <AccountReportTable rows={data?.accounts ?? []} loading={loading} />
      </Card>

      <Card>
        <CardHeader title="Transaksi Terbaru" subtitle="10 transaksi terakhir pada rentang terpilih" />
        <div className="divide-y divide-slate-100">
          {loading && <div className="p-8 text-center text-sm text-slate-500">Memuat transaksi...</div>}
          {!loading && (data?.recent.length ?? 0) === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">Belum ada transaksi pada rentang ini.</div>
          )}
          {!loading &&
            data?.recent.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold bg-slate-100 text-slate-600">
                  {t.product.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{t.product}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {t.user_name} • {t.customer}
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
    </PageContainer>
  );
}
