import { useMemo, useState } from "react";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { useNetworkLoketSales, useTransactions, useProfiles, type TransactionRow } from "@/lib/hooks";
import { networkOwners, profileLabel, profilesWithSelf } from "@/lib/network";
import { HierarchyPanel, useDrill } from "@/lib/hierarchy";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader, SearchInput } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Select } from "@/components/ui/Form";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { CATEGORY_LABELS, CATEGORY_COLORS, type ProductCategory } from "@/lib/types";
import { Receipt } from "lucide-react";

const statusTone: Record<string, "success" | "warning" | "danger" | "info"> = {
  success: "success",
  pending: "warning",
  failed: "danger",
  refunded: "info",
  simulated: "info",
};
const statusLabel: Record<string, string> = {
  success: "Berhasil",
  pending: "Pending",
  failed: "Gagal",
  refunded: "Refund",
  simulated: "Simulasi",
};

export function TransactionsPage({ riwayat = false }: { riwayat?: boolean }) {
  const { profile } = useAuth();
  const { transactions, loading } = useTransactions();
  const networkSales = useNetworkLoketSales();
  const { profiles } = useProfiles();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("semua");
  const [catFilter, setCatFilter] = useState<string>("semua");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [mitraId, setMitraId] = useState("semua");
  const [loketId, setLoketId] = useState("semua");
  const [operatorId, setOperatorId] = useState("semua");
  const [product, setProduct] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const drill = useDrill(profiles);
  if (!profile) return null;
  const role = dbRoleToAppRole(profile.role);
  const directory = profilesWithSelf(profiles, profile);

  const filtered = useMemo(() => {
    const seen = new Set(networkSales.map((row) => row.id));
    const archive = role === "superadmin"
      ? [...networkSales, ...transactions.filter((row) => !seen.has(row.id))]
      : networkSales;
    const narrowed = drill.canBack;
    return archive.filter((t) => {
      if (narrowed && !drill.loketIds.includes(t.user_id)) return false;
      if (statusFilter !== "semua" && t.status !== statusFilter) return false;
      if (catFilter !== "semua" && t.category_slug_snapshot !== catFilter) return false;
      const day = t.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (loketId !== "semua" && t.user_id !== loketId) return false;
      if (operatorId !== "semua" && t.user_id !== operatorId) return false;
      if (product && !t.product_name_snapshot.toLowerCase().includes(product.toLowerCase())) return false;
      if (mitraId !== "semua") {
        const owners = networkOwners(t.user_id, directory);
        if (owners.mitra?.id !== mitraId && t.user_id !== mitraId) return false;
      }
      if (search) {
        const owners = networkOwners(t.user_id, directory);
        const q = search.toLowerCase();
        const names = [owners.account, owners.submitra, owners.mitra]
          .map((item) => profileLabel(item).toLowerCase());
        return t.invoice_code.toLowerCase().includes(q)
          || t.product_name_snapshot.toLowerCase().includes(q)
          || t.customer_number.includes(q)
          || names.some((name) => name.includes(q));
      }
      return true;
    });
  }, [transactions, networkSales, statusFilter, catFilter, search, directory, from, to, mitraId, loketId, operatorId, product, drill.loketIds, drill.canBack, role]);

  const totalBerhasil = filtered.filter((t) => t.status === "success").reduce((s, t) => s + Number(t.amount), 0);
  const totalGagal = filtered.filter((t) => t.status === "failed").length;
  const panelRows = drill.nodes.map((node) => {
    const matched = filtered.filter((row) => node.loketIds.includes(row.user_id));
    return { ...node, count: matched.length, amount: matched.filter((row) => row.status === "success").reduce((sum, row) => sum + Number(row.amount), 0) };
  });

  const columns: Column<TransactionRow>[] = [
    {
      key: "invoice",
      header: "Invoice",
      render: (t) => (
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${CATEGORY_COLORS[t.category_slug_snapshot as ProductCategory] || "bg-slate-100 text-slate-600"}`}>
            <Receipt size={14} />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-700">{t.invoice_code}</div>
            <div className="text-[11px] text-slate-400">{formatWaktu(t.created_at)}</div>
          </div>
        </div>
      ),
    },
    {
      key: "product",
      header: "Produk",
      render: (t) => (
        <div>
          <div className="text-sm font-medium text-slate-800">{t.product_name_snapshot}</div>
          <div className="text-xs text-slate-500">{CATEGORY_LABELS[t.category_slug_snapshot as ProductCategory] || t.category_slug_snapshot}</div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Nomor Tujuan",
      render: (t) => <span className="text-sm text-slate-600 font-mono">{t.customer_number}</span>,
    },
    {
      key: "user",
      header: "Pelaku",
      render: (t) => {
        const owners = networkOwners(t.user_id, directory);
        const upstream = [
          role === "superadmin" && owners.submitra ? `Sub Mitra ${profileLabel(owners.submitra)}` : null,
          role === "superadmin" && owners.mitra ? `Mitra ${profileLabel(owners.mitra)}` : null,
          role === "mitra" && owners.submitra ? `Sub Mitra ${profileLabel(owners.submitra)}` : null,
        ].filter(Boolean).join(" · ");
        return (
          <div>
            <div className="text-sm text-slate-700">{profileLabel(owners.account)}</div>
            {upstream && <div className="text-[11px] text-slate-400">{upstream}</div>}
          </div>
        );
      },
    },
    {
      key: "amount",
      header: "Jumlah",
      render: (t) => <span className="text-sm font-semibold text-slate-800">{formatRupiah(Number(t.amount))}</span>,
      className: "text-right",
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <Badge tone={statusTone[t.status]}>{statusLabel[t.status]}</Badge>,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={riwayat ? "Riwayat Transaksi" : "Detail Transaksi"}
        description={
          role === "superadmin"
            ? "Seluruh transaksi dari Mitra, Sub Mitra, dan Loket."
            : role === "mitra"
              ? "Transaksi Sub Mitra dan Loket di jaringan Anda, termasuk loket yang langsung di bawah Anda."
              : role === "submitra"
                ? "Transaksi semua loket yang berada di bawah Anda."
                : "Transaksi pada akun Anda."
        }
      />

      {role !== "loket" && <HierarchyPanel drill={drill} rows={panelRows} search={nodeSearch} onSearch={setNodeSearch} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card className="p-4">
          <div className="text-xs text-slate-500">Total Transaksi</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{filtered.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Nilai Berhasil</div>
          <div className="text-xl font-bold text-emerald-600 mt-1">{formatRupiah(totalBerhasil)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Transaksi Gagal</div>
          <div className="text-xl font-bold text-rose-600 mt-1">{totalGagal}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Tingkat Sukses</div>
          <div className="text-xl font-bold text-blue-600 mt-1">
            {filtered.length > 0 ? Math.round((filtered.filter(t => t.status === "success").length / filtered.length) * 100) : 0}%
          </div>
        </Card>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <Field label="Dari"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Sampai"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {role === "superadmin" && <Field label="Mitra">
            <Select value={mitraId} onChange={(e) => setMitraId(e.target.value)}>
              <option value="semua">Semua mitra</option>
              {directory.filter((item) => item.role === "mitra").map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}
            </Select>
          </Field>}
          <Field label="Loket">
            <Select value={loketId} onChange={(e) => setLoketId(e.target.value)}>
              <option value="semua">Semua loket</option>
              {directory.filter((item) => item.role === "loket").map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}
            </Select>
          </Field>
          <Field label="Operator">
            <Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
              <option value="semua">Semua operator</option>
              {directory.map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}
            </Select>
          </Field>
          <Field label="Produk"><Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Nama produk" /></Field>
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="semua">Semua status</option>
              <option value="success">Berhasil</option>
              <option value="pending">Pending</option>
              <option value="failed">Gagal</option>
              <option value="refunded">Refund</option>
            </Select>
          </Field>
          <Field label="Layanan">
            <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="semua">Semua layanan</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Cari invoice / nomor..." />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={riwayat ? "Riwayat Lengkap" : "Daftar Transaksi"} subtitle={loading && networkSales.length === 0 ? "Memuat..." : `${filtered.length} transaksi arsip server`} />
        <Table columns={columns} data={filtered} rowKey={(t) => t.id} empty={loading && networkSales.length === 0 ? "Memuat data..." : "Belum ada transaksi."} />
      </Card>
    </PageContainer>
  );
}
