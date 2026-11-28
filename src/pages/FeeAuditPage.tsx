import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { apiUrl } from "@/lib/apiBase";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { formatRupiah, formatWaktu } from "@/lib/format";

interface FeeRow {
  id: string;
  at: string;
  loketId: string;
  loketName: string;
  loketCode: string;
  product: string;
  customerNumber: string;
  customerName: string;
  status: string;
  sn: string;
  nominal: number;
  modal: number;
  h2hFee: number;
  mentariFee: number;
  amount: number;
}

interface FeeTotals {
  count: number;
  nominal: number;
  modal: number;
  h2hFee: number;
  mentariFee: number;
  amount: number;
}

interface LoketOption {
  id: string;
  name: string;
  code: string;
}

const emptyTotals: FeeTotals = { count: 0, nominal: 0, modal: 0, h2hFee: 0, mentariFee: 0, amount: 0 };

function thisMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date());
}

const statusLabel: Record<string, string> = {
  success: "Sukses",
  pending: "Pending",
  failed: "Gagal",
  refunded: "Refund",
};

async function authHeader() {
  const session = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session.data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

export function FeeAuditPage() {
  const { isSuperAdmin } = useAuth();
  const [month, setMonth] = useState(thisMonth);
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState("success");
  const [loket, setLoket] = useState("semua");
  const [lokets, setLokets] = useState<LoketOption[]>([]);
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [totals, setTotals] = useState<FeeTotals>(emptyTotals);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async (announce = true) => {
    if (!isSuperAdmin) return;
    if (announce) setLoading(true);
    setError("");
    const params = new URLSearchParams({ month, status, product: product.trim(), loket: loket === "semua" ? "" : loket });
    try {
      const response = await fetch(apiUrl(`/api/fee-audit?${params.toString()}`), { headers: await authHeader() });
      const body = await response.json().catch(() => ({})) as { error?: string; rows?: FeeRow[]; totals?: FeeTotals; lokets?: LoketOption[] };
      if (!response.ok) {
        setError(body.error || "Rincian fee belum dapat dimuat.");
        return;
      }
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setTotals(body.totals || emptyTotals);
      if (Array.isArray(body.lokets)) setLokets(body.lokets);
    } catch {
      setError("Rincian fee belum mendapat jawaban.");
    } finally {
      if (announce) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [month, status, loket, isSuperAdmin]);

  const sync = async () => {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/fee-audit/sync"), { method: "POST", headers: await authHeader(), body: "{}" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(body.error || "Sinkronisasi status belum selesai.");
        return;
      }
      await load(false);
    } catch {
      setError("Sinkronisasi status belum mendapat jawaban.");
    } finally {
      setSyncing(false);
    }
  };

  if (!isSuperAdmin) return null;

  const cards = [
    ["Transaksi sukses", String(totals.count)],
    ["Nominal", formatRupiah(totals.nominal)],
    ["Modal", formatRupiah(totals.modal)],
    ["Fee H2H", formatRupiah(totals.h2hFee)],
    ["Fee Mentari", formatRupiah(totals.mentariFee)],
    ["Harga jual", formatRupiah(totals.amount)],
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Audit Fee"
        description="Rincian bulanan khusus Super Admin: nominal, modal, fee penyedia H2H, dan fee internal Mentari."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {cards.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-black text-slate-900">{value}</div>
          </Card>
        ))}
      </div>
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Bulan">
            <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </Field>
          <Field label="Produk">
            <Input value={product} placeholder="PLN, PDAM, pulsa..." onChange={(event) => setProduct(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="success">Sukses</option>
              <option value="pending">Pending</option>
              <option value="failed">Gagal</option>
              <option value="refunded">Refund</option>
              <option value="semua">Semua</option>
            </Select>
          </Field>
          <Field label="Loket">
            <Select value={loket} onChange={(event) => setLoket(event.target.value)}>
              <option value="semua">Semua loket</option>
              {lokets.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} - ${item.name}` : item.name}</option>)}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading || syncing}>{loading ? "Memuat..." : "Tampilkan"}</Button>
            <Button onClick={() => void sync()} disabled={loading || syncing}>{syncing ? "Menyinkronkan..." : "Sinkronkan"}</Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Nominal adalah nilai tagihan atau token. Modal adalah biaya pokok. Fee H2H adalah bagian penyedia. Fee Mentari adalah margin internal dan tidak mengurangi saldo DigiFlazz. Harga jual dipotong dari saldo loket hanya saat status Sukses. Ringkasan menjumlahkan transaksi Sukses pada bulan yang dipilih.</p>
        {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
      </Card>
      <Card>
        <CardHeader title="Rincian transaksi" subtitle={loading ? "Memuat..." : `${rows.length} baris`} />
        <div className="w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {["Waktu", "Loket", "Produk", "ID", "Status", "Token/SN", "Nominal", "Modal", "Fee H2H", "Fee Mentari", "Harga jual"].map((head) => (
                  <th key={head} className="px-2.5 py-2 whitespace-nowrap">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500">Tidak ada transaksi pada filter ini.</td></tr>}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-2.5 py-2 whitespace-nowrap">{formatWaktu(row.at)}</td>
                  <td className="px-2.5 py-2"><div className="font-semibold text-slate-900">{row.loketName}</div>{row.loketCode && <div className="text-xs text-slate-500">{row.loketCode}</div>}</td>
                  <td className="px-2.5 py-2">{row.product}</td>
                  <td className="px-2.5 py-2 font-mono text-xs">{row.customerNumber}<div className="text-slate-500">{row.customerName}</div></td>
                  <td className="px-2.5 py-2"><Badge tone={row.status === "success" ? "success" : row.status === "pending" ? "warning" : "danger"}>{statusLabel[row.status] || row.status}</Badge></td>
                  <td className="px-2.5 py-2 font-mono text-[11px] break-all">{row.sn || "—"}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{formatRupiah(row.nominal)}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{formatRupiah(row.modal)}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{formatRupiah(row.h2hFee)}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap font-semibold text-emerald-700">{formatRupiah(row.mentariFee)}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap font-semibold">{formatRupiah(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}
