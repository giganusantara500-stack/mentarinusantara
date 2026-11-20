import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useLedger, useMyWallet, useProfiles, type LedgerRow } from "@/lib/hooks";
import { HierarchyPanel, useDrill } from "@/lib/hierarchy";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader, SearchInput } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Form";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { ArrowDownCircle, ArrowUpCircle, Wallet, AlertCircle } from "lucide-react";

const refLabel: Record<string, string> = {
  topup: "Top Up",
  transaction: "Pembelian",
  refund: "Refund",
  adjustment: "Penyesuaian",
  fee: "Biaya",
  deposit_pusat: "Deposit Pusat",
  deposit_jaringan: "Deposit Jaringan",
  distribusi: "Distribusi Saldo",
};

export function MutationsPage() {
  const { profile, isSuperAdmin } = useAuth();
  const { ledger, loading } = useLedger();
  const { wallet, refresh: refreshWallet } = useMyWallet();
  const { profiles } = useProfiles();
  const drill = useDrill(profiles);
  const [nodeSearch, setNodeSearch] = useState("");
  const [search, setSearch] = useState("");
  const [dirFilter, setDirFilter] = useState<string>("semua");
  const [showTopup, setShowTopup] = useState(false);
  const [topupTarget, setTopupTarget] = useState("");
  const [topupAmount, setTopupAmount] = useState("");
  const [topupDesc, setTopupDesc] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!profile) return null;
  const balance = wallet ? Number(wallet.balance) : 0;

  const filtered = useMemo(() => {
    return ledger.filter((m) => {
      if (dirFilter !== "semua" && m.entry_type !== (dirFilter === "masuk" ? "credit" : "debit")) return false;
      if (!isSuperAdmin && profiles.length > 0 && !drill.loketIds.includes(m.user_id) && m.user_id !== profile.id) return false;
      if (isSuperAdmin && (drill.canBack || drill.showNodes) && !drill.loketIds.includes(m.user_id) && m.user_id !== profile.id) return false;
      if (search) {
        const q = search.toLowerCase();
        return (m.description || "").toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
      }
      return true;
    });
  }, [ledger, dirFilter, search, drill.loketIds, drill.canBack, drill.showNodes, isSuperAdmin, profiles.length, profile.id]);

  const totalMasuk = filtered.filter((m) => m.entry_type === "credit").reduce((s, m) => s + Number(m.amount), 0);
  const totalKeluar = filtered.filter((m) => m.entry_type === "debit").reduce((s, m) => s + Number(m.amount), 0);
  const panelRows = drill.nodes.map((node) => {
    const matched = filtered.filter((row) => node.loketIds.includes(row.user_id));
    return { ...node, count: matched.length, amount: matched.reduce((sum, row) => sum + (row.entry_type === "credit" ? Number(row.amount) : -Number(row.amount)), 0) };
  });

  const userName = (uid: string) => {
    if (uid === "__pusat__") return "Kas Pusat";
    const p = profiles.find((x) => x.id === uid);
    return p ? (p.full_name || p.email) : "—";
  };

  const doTopup = async () => {
    const amount = Number(topupAmount) || 0;
    if (amount <= 0) { setError("Jumlah harus positif"); return; }
    if (!topupTarget) { setError("Pilih pengguna tujuan"); return; }
    setBusy(true);
    setError("");
    const { error: rpcErr } = await supabase.rpc("admin_topup_wallet", {
      p_target_uid: topupTarget,
      p_amount: amount,
      p_description: topupDesc || "Top up saldo",
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setShowTopup(false);
    setTopupAmount("");
    setTopupDesc("");
    refreshWallet();
  };

  const columns: Column<LedgerRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      render: (m) => <span className="text-xs text-slate-600">{formatWaktu(m.created_at)}</span>,
    },
    {
      key: "description",
      header: "Keterangan",
      render: (m) => (
        <div className="flex items-center gap-2.5">
          {m.entry_type === "credit"
            ? <ArrowDownCircle size={18} className="text-emerald-500 shrink-0" />
            : <ArrowUpCircle size={18} className="text-rose-500 shrink-0" />}
          <div>
            <div className="text-sm font-medium text-slate-800">{m.description || "—"}</div>
            <div className="text-xs text-slate-500">{refLabel[m.reference_type ?? ""] || m.reference_type || "—"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "user",
      header: "Pengguna",
      render: (m) => <span className="text-sm text-slate-600">{userName(m.user_id)}</span>,
    },
    {
      key: "amount",
      header: "Jumlah",
      render: (m) => (
        <span className={`text-sm font-semibold ${m.entry_type === "credit" ? "text-emerald-600" : "text-rose-600"}`}>
          {m.entry_type === "credit" ? "+" : "-"}{formatRupiah(Number(m.amount))}
        </span>
      ),
      className: "text-right",
    },
    {
      key: "balanceAfter",
      header: "Saldo Setelah",
      render: (m) => <span className="text-sm text-slate-700">{formatRupiah(Number(m.balance_after))}</span>,
    },
  ];

  return (
    <PageContainer>
      <PageHeader title="Mutasi Saldo" description="Riwayat perubahan saldo di jaringan Anda.">
        {isSuperAdmin && <Button onClick={() => { setTopupTarget(""); setTopupAmount(""); setTopupDesc(""); setError(""); setShowTopup(true); }}><Wallet size={16} /> Top Up Saldo</Button>}
      </PageHeader>

      <HierarchyPanel drill={drill} rows={panelRows} search={nodeSearch} onSearch={setNodeSearch} />

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
              <Wallet size={20} />
            </div>
            <div>
              <div className="text-xs text-slate-300 uppercase tracking-wide">Saldo Anda</div>
              <div className="text-2xl font-bold">{formatRupiah(balance)}</div>
            </div>
          </div>
          <div className="flex gap-6">
            <div>
              <div className="text-xs text-slate-300">Total Masuk</div>
              <div className="text-lg font-semibold text-emerald-400">{formatRupiah(totalMasuk)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-300">Total Keluar</div>
              <div className="text-lg font-semibold text-rose-400">{formatRupiah(totalKeluar)}</div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="mb-4 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Cari keterangan..." />
          <Select value={dirFilter} onChange={(e) => setDirFilter(e.target.value)} className="w-auto">
            <option value="semua">Semua arah</option>
            <option value="masuk">Masuk</option>
            <option value="keluar">Keluar</option>
          </Select>
        </div>
      </Card>

      {drill.showNodes ? null : <Card>
        <CardHeader title="Riwayat Mutasi" subtitle={loading ? "Memuat..." : `${filtered.length} mutasi`} />
        <Table columns={columns} data={filtered} rowKey={(m) => m.id} empty={loading ? "Memuat data..." : "Belum ada mutasi."} />
      </Card>}

      <Modal
        open={showTopup}
        onClose={() => { setShowTopup(false); setError(""); }}
        title="Top Up Saldo Pengguna"
        subtitle="Tambah saldo untuk mitra/sub mitra/loket di jaringan Anda."
        footer={<><Button variant="outline" onClick={() => { setShowTopup(false); setError(""); }}>Batal</Button><Button onClick={doTopup} disabled={busy}>{busy ? "Memproses..." : "Top Up"}</Button></>}
      >
        <div className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <Field label="Pengguna Tujuan">
            <Select value={topupTarget} onChange={(e) => setTopupTarget(e.target.value)}>
              <option value="">— Pilih —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
              ))}
            </Select>
          </Field>
          <Field label="Jumlah Top Up (Rp)"><Input type="number" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} placeholder="cth: 500000" /></Field>
          <Field label="Keterangan"><Input value={topupDesc} onChange={(e) => setTopupDesc(e.target.value)} placeholder="cth: Top up saldo operasional" /></Field>
        </div>
      </Modal>
    </PageContainer>
  );
}
