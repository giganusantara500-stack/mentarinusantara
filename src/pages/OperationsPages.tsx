import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useNetworkLoketSales, useProfiles, useTransactions, roleToUi } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Form";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { depositErrorText, depositRequest } from "@/lib/depositApi";
import { ticketPhase } from "@/lib/depositStatus";
import { ROLE_LABELS } from "@/lib/nav";
import { CATEGORY_LABELS, type ProductCategory } from "@/lib/types";
import { networkOwners, profileLabel, profilesWithSelf } from "@/lib/network";
import { HierarchyPanel, useDrill } from "@/lib/hierarchy";
import { Users, Pencil, Trash2, Plus } from "lucide-react";

async function authHeader() {
  const session = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session.data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

function Shell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      {children}
    </PageContainer>
  );
}

interface Ticket {
  id: string;
  loketId?: string;
  loketName: string;
  loketCode?: string;
  amount: number;
  baseAmount?: number;
  uniqueCode?: string;
  transferAmount?: number;
  bank: string;
  accountNumber: string;
  accountHolder: string;
  transferAt: string;
  expiresAt?: string;
  claimedAt?: string | null;
  createdAt?: string;
  decidedAt?: string | null;
  status: "pending" | "approved" | "cancelled" | "reversed";
  route?: "pusat" | "jaringan";
  approverId?: string | null;
  applicantRole?: string;
  uplineName?: string;
  uplineRole?: string;
}

interface FundMutation {
  id: string;
  at: string;
  ticketId: string;
  actorId: string;
  accountId: string;
  direction: "credit" | "debit";
  amount: number;
  balanceAfter: number;
  route: "pusat" | "jaringan";
  kind?: "distribusi";
  note: string;
}

const statusLabel: Record<Ticket["status"], string> = {
  pending: "Menunggu Transfer",
  approved: "Deposit Berhasil",
  cancelled: "Ditolak",
  reversed: "Dibatalkan",
};

const monitorLabel: Record<Ticket["status"], string> = {
  pending: "Menunggu Transfer",
  approved: "Deposit Berhasil",
  cancelled: "Ditolak",
  reversed: "Dibatalkan",
};

function roleText(role?: string) {
  if (role === "mitra") return "Mitra";
  if (role === "submitra" || role === "sub_mitra") return "Sub Mitra";
  if (role === "super_admin" || role === "superadmin") return "Pusat";
  return "Loket";
}

function cmsId(ticket: Ticket) {
  return ticket.id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function statusTrail(ticket: Ticket) {
  const opened = ticket.createdAt || ticket.transferAt;
  const decided = ticket.decidedAt || ticket.transferAt;
  const trail = [{ at: opened, label: "Pending" }];
  if (ticket.status === "approved") trail.push({ at: decided, label: "Approved" });
  if (ticket.status === "cancelled") trail.push({ at: decided, label: "Ditolak" });
  if (ticket.status === "reversed") trail.push({ at: decided, label: "Approved" }, { at: decided, label: "Dibatalkan" });
  return trail;
}

function DistributeBalance({ ownerId, profiles, balance, mutations, onRefresh }: {
  ownerId: string;
  profiles: { id: string; role: string; full_name?: string | null; username?: string | null; loket_code?: string | null; parent_id?: string | null; mitra_id?: string | null; created_by?: string | null }[];
  balance: number;
  mutations: FundMutation[];
  onRefresh: () => Promise<void>;
}) {
  const lokets = profiles.filter((item) => {
    if (item.role !== "loket") return false;
    if (item.mitra_id && item.mitra_id !== ownerId && item.created_by !== ownerId && item.parent_id !== ownerId) return false;
    if (item.created_by && item.parent_id && item.created_by !== ownerId && item.parent_id !== ownerId && item.mitra_id !== ownerId) return false;
    return true;
  });
  const [loketId, setLoketId] = useState(lokets[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const history = mutations.filter((row) => row.kind === "distribusi");
  const nameOf = (id: string) => {
    const match = profiles.find((item) => item.id === id);
    return match?.full_name || match?.username || "Loket";
  };
  const send = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/distribute", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({ loketId, amount: Number(amount) }),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { setError(body?.error || "Saldo gagal dikirim."); return; }
    setAmount("");
    setMessage(`Terkirim ke ${nameOf(loketId)}. Saldo Anda ${formatRupiah(Number(body.balance))}. Saldo loket ${formatRupiah(Number(body.loketBalance))}.`);
    await onRefresh();
  };
  return (
    <Shell title="Distribusi Saldo" description={`Kirim sebagian saldo utama ke loket di jaringan Anda. Saldo Anda saat ini ${formatRupiah(balance)}. Loket mitra lain tidak dapat dipilih.`}>
      <Card className="mb-4">
        <CardHeader title="Transfer ke loket" subtitle="Saldo Mitra terpotong dan saldo loket bertambah saat ini juga." />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Loket tujuan">
            <Select value={loketId} onChange={(event) => setLoketId(event.target.value)}>
              {lokets.length === 0 && <option value="">Belum ada loket</option>}
              {lokets.map((item) => <option key={item.id} value={item.id}>{item.loket_code ? `${item.loket_code} - ` : ""}{item.full_name || item.username || "Loket"}</option>)}
            </Select>
          </Field>
          <Field label="Nominal">
            <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} placeholder="100000" />
          </Field>
          <div className="flex items-end">
            <Button onClick={send} disabled={busy || !loketId || Number(amount) < 1000 || Number(amount) > balance}>{busy ? "Mengirim..." : "Kirim Saldo"}</Button>
          </div>
          {error && <div className="sm:col-span-3 text-sm text-rose-600">{error}</div>}
          {message && <div className="sm:col-span-3 text-sm text-emerald-700">{message}</div>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Riwayat distribusi" subtitle={`${history.length} mutasi pada akun Anda`} />
        <div className="divide-y divide-slate-100">
          {history.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-500">Belum ada pengiriman saldo.</div>}
          {history.slice(0, 20).map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-slate-800">{row.note}</div>
                <div className="text-xs text-slate-500">{formatWaktu(row.at)} · sisa {formatRupiah(row.balanceAfter)}</div>
              </div>
              <div className="font-semibold text-rose-700">-{formatRupiah(row.amount)}</div>
            </div>
          ))}
        </div>
      </Card>
    </Shell>
  );
}

export function ManageSetoranPage() {
  const { isSuperAdmin, profile } = useAuth();
  const { profiles } = useProfiles();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [mutations, setMutations] = useState<FundMutation[]>([]);
  const [status, setStatus] = useState("semua");
  const [bank, setBank] = useState("semua");
  const [date, setDate] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [pool, setPool] = useState(0);
  const [detail, setDetail] = useState<Ticket | null>(null);
  const globalQueue = isSuperAdmin;
  const role = profile?.role;
  const canRequest = role === "mitra" || role === "submitra";
  const networkIds = new Set(profiles.map((item) => item.id));

  const load = async () => {
    const headers = await authHeader();
    const session = await supabase.auth.getSession();
    const result = await depositRequest("/api/deposits", "GET", session.data.session?.access_token ?? "");
    if (!result.ok) { setError(depositErrorText(result.status, result.body, "Daftar setoran gagal dimuat.")); return; }
    setError("");
    setTickets((result.body.tickets ?? []) as Ticket[]);
    setMutations((result.body.mutations ?? []) as FundMutation[]);
    const wallet = await fetch("/api/wallet", { headers });
    if (wallet.ok) setPool(Number((await wallet.json()).balance) || 0);
  };
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, []);

  const decide = async (id: string, action: "approve" | "cancel" | "pending" | "void") => {
    setBusyId(id);
    setError("");
    const session = await supabase.auth.getSession();
    const result = await depositRequest("/api/deposits/decide", "POST", session.data.session?.access_token ?? "", { id, action });
    setBusyId("");
    if (!result.ok) { setError(depositErrorText(result.status, result.body, "Keputusan gagal disimpan.")); return; }
    await load();
  };

  const loketOf = (ticket: Ticket) => {
    const match = profiles.find((item) => item.id === ticket.loketId);
    return {
      name: match?.full_name || ticket.loketName || "Loket",
      code: match?.loket_code || ticket.loketCode || "",
    };
  };
  const banks = Array.from(new Set(tickets.map((ticket) => ticket.bank)));
  const routeOf = (ticket: Ticket) => ticket.route === "jaringan" ? "jaringan" : "pusat";
  const canDecide = (ticket: Ticket) => globalQueue && routeOf(ticket) === "pusat";
  const rows = tickets.filter((ticket) => {
    if (!globalQueue && ticket.loketId !== profile?.id && ticket.approverId !== profile?.id && (!ticket.loketId || !networkIds.has(ticket.loketId))) return false;
    if (status !== "semua" && ticket.status !== status) return false;
    if (bank !== "semua" && ticket.bank !== bank) return false;
    if (globalQueue && date && !ticket.transferAt.slice(0, 10).startsWith(date)) return false;
    if (query) {
      const loket = loketOf(ticket);
      const q = query.toLowerCase();
      const haystack = `${cmsId(ticket)} ${loket.name} ${loket.code} ${ticket.bank} ${ticket.uniqueCode ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const accountName = (id: string) => {
    if (id === "__pusat__") return "Kas Pusat";
    const match = profiles.find((item) => item.id === id);
    return match?.full_name || match?.username || id.slice(0, 8);
  };

  if (role === "mitra") {
    return <DistributeBalance ownerId={profile?.id ?? ""} profiles={profiles} balance={pool} mutations={mutations.filter((row) => row.accountId === profile?.id)} onRefresh={load} />;
  }

  return (
    <Shell
      title="Persetujuan Deposit"
      description={globalQueue
        ? `Antrean deposit Loket, Sub Mitra, dan Mitra. Menyetujui tiket memindahkan Saldo Utama ke pemohon tepat satu kali. Saldo Utama saat ini ${formatRupiah(pool)}.`
        : "Pantauan setoran di jaringan Anda. Persetujuan tiket rekening pusat dilakukan di pusat."}
    >
      {canRequest && (
        <Card className="mb-4">
          <CardHeader title="Ajukan tiket deposit" subtitle="Kode unik, hitung mundur, dan status ada di menu Tiket Deposit." />
          <div className="p-4">
            <Button onClick={() => { window.location.hash = "/deposit"; }}>Buka Tiket Deposit</Button>
          </div>
        </Card>
      )}
      {error && <div className="mb-3 text-sm text-rose-600">{error}</div>}
      <div className={`mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 ${globalQueue ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <Field label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="semua">Semua</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="cancelled">Ditolak</option>
            <option value="reversed">Dibatalkan</option>
          </Select>
        </Field>
        <Field label="Sumber bank">
          <Select value={bank} onChange={(event) => setBank(event.target.value)}>
            <option value="semua">Semua bank</option>
            {banks.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        {globalQueue && (
          <Field label="Tanggal transfer">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
        )}
        <Field label="Cari">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID CMS, loket, atau bank" />
        </Field>
      </div>
      <Card>
        <CardHeader title={globalQueue ? "Antrean rekening pusat" : "Antrean jaringan Anda"} subtitle={`${rows.length} tiket · ${profile?.full_name || profile?.username || "Jaringan"}`} />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {["Pemohon", "Peran", "Jaringan", "Bank", "Transfer", "Status", "Aksi"].map((head) => <th key={head} className="px-3 py-2">{head}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Belum ada setoran pada filter ini.</td></tr>}
              {rows.map((ticket) => {
                const loket = loketOf(ticket);
                const allowed = canDecide(ticket);
                return (
                  <tr key={ticket.id} className="border-t border-slate-100">
                    <td className="px-3 py-2"><div className="font-semibold text-slate-900">{loket.name}</div><div className="text-xs text-slate-500">{loket.code ? `Kode ${loket.code}` : formatWaktu(ticket.transferAt)}</div></td>
                    <td className="px-3 py-2">{roleText(ticket.applicantRole)}</td>
                    <td className="px-3 py-2">{!globalQueue && (ticket.uplineRole === "super_admin" || ticket.uplineRole === "superadmin") ? "Pusat" : (ticket.uplineName || "Pusat")}<div className="text-xs text-slate-500">{roleText(ticket.uplineRole)}</div></td>
                    <td className="px-3 py-2">{ticket.bank}<div className="text-xs text-slate-500">{ticket.accountNumber}</div></td>
                    <td className="px-3 py-2 font-semibold">{formatRupiah(ticket.transferAmount ?? ticket.amount)}<div className="font-mono text-xs text-slate-500">kode {ticket.uniqueCode || "—"} · masuk {formatRupiah(ticket.baseAmount ?? ticket.amount)}</div></td>
                    <td className="px-3 py-2"><Badge tone={ticketPhase(ticket).tone}>{ticketPhase(ticket).label}</Badge></td>
                    <td className="px-3 py-2">
                      {allowed ? (
                        <div className="flex flex-wrap gap-2">
                          {ticket.status === "pending" && <Button size="sm" disabled={busyId === ticket.id} onClick={() => decide(ticket.id, "approve")}>Approve</Button>}
                          {ticket.status === "pending" && <Button size="sm" variant="outline" disabled={busyId === ticket.id} onClick={() => decide(ticket.id, "cancel")}>Tolak</Button>}
                          {ticket.status === "approved" && <Button size="sm" variant="outline" disabled={busyId === ticket.id} onClick={() => decide(ticket.id, "pending")}>Kembalikan</Button>}
                          {ticket.status === "approved" && <Button size="sm" variant="danger" disabled={busyId === ticket.id} onClick={() => decide(ticket.id, "void")}>Tarik Kembali</Button>}
                          {(ticket.status === "cancelled" || ticket.status === "reversed") && <Button size="sm" variant="outline" disabled={busyId === ticket.id} onClick={() => decide(ticket.id, "pending")}>Kembalikan</Button>}
                        </div>
                      ) : (
                        <button type="button" className="text-xs font-semibold text-sky-700" onClick={() => setDetail(ticket)}>{routeOf(ticket) === "pusat" ? "Menunggu keputusan" : "Detail"}</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Riwayat mutasi dana" subtitle={globalQueue ? "Kas pusat dan saldo pemohon" : "Mutasi di jaringan Anda"} />
        <div className="divide-y divide-slate-100">
          {mutations.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-500">Belum ada mutasi deposit.</div>}
          {mutations.slice(0, 30).map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-slate-800">{row.note}</div>
                <div className="text-xs text-slate-500">{formatWaktu(row.at)} · {accountName(row.accountId)} · {row.route === "jaringan" ? "Jaringan" : "Pusat"}</div>
              </div>
              <div className={`font-semibold ${row.direction === "credit" ? "text-emerald-700" : "text-rose-700"}`}>{row.direction === "credit" ? "+" : "-"}{formatRupiah(row.amount)}</div>
            </div>
          ))}
        </div>
      </Card>
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detail Setoran" subtitle={detail ? cmsId(detail) : ""}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-slate-500">ID CMS</div><div className="font-mono font-semibold">{cmsId(detail)}</div></div>
              <div><div className="text-xs text-slate-500">Waktu mutasi bank</div><div>{formatWaktu(detail.transferAt)}</div></div>
              <div><div className="text-xs text-slate-500">Loket</div><div className="font-semibold">{loketOf(detail).name}</div><div className="text-xs text-slate-500">{loketOf(detail).code ? `Kode ${loketOf(detail).code}` : ""}</div></div>
              <div><div className="text-xs text-slate-500">Sumber</div><div>{detail.bank}</div><div className="text-xs text-slate-500">{detail.accountNumber}</div></div>
              <div><div className="text-xs text-slate-500">Nominal</div><div className="font-semibold">{formatRupiah(detail.baseAmount ?? detail.amount)}</div></div>
              <div><div className="text-xs text-slate-500">Status</div><Badge tone={detail.status === "approved" ? "success" : detail.status === "pending" ? "warning" : detail.status === "reversed" ? "info" : "danger"}>{monitorLabel[detail.status]}</Badge></div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Riwayat status</div>
              <ol className="space-y-2">
                {statusTrail(detail).map((item, index) => (
                  <li key={`${item.label}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="font-medium text-slate-800">{item.label}</span>
                    <span className="text-xs text-slate-500">{formatWaktu(item.at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

export function BalanceAllocationPage() {
  const { profiles } = useProfiles();
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const targets = profiles.filter((profile) => profile.role !== "super_admin");
  const save = async () => {
    const response = await fetch("/api/allocate", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({ userId, amount: Number(amount) }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error || "Saldo gagal dibagikan."); setMessage(""); return; }
    setError("");
    setMessage(`Saldo diperbarui menjadi ${formatRupiah(Number(body.balance))}.`);
    setAmount("");
  };
  return (
    <Shell title="Pembagian Saldo" description="Modal dan saldo jaringan hanya dapat ditambah oleh Super Admin.">
      <Card>
        <CardHeader title="Tambah saldo akun" subtitle="Nominal positif menambah saldo. Nominal minus mengurangi saldo." />
        <div className="space-y-3 p-4">
          {error && <div className="text-sm text-rose-600">{error}</div>}
          {message && <div className="text-sm text-emerald-600">{message}</div>}
          <Field label="Akun tujuan">
            <Select value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">Pilih akun</option>
              <option value="__pusat__">Saldo Utama (modal H2H)</option>
              {[...targets].sort((a, b) => (a.role === "loket" ? 0 : 1) - (b.role === "loket" ? 0 : 1)).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.role === "loket" && profile.loket_code ? `${profile.loket_code} - ${profileLabel(profile)}` : `${profileLabel(profile)} · ${ROLE_LABELS[roleToUi(profile.role)]}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nominal">
            <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d-]/g, ""))} placeholder="100000" />
          </Field>
          <Button onClick={save} disabled={!userId || !amount || Number(amount) === 0}>Simpan Saldo</Button>
        </div>
      </Card>
    </Shell>
  );
}

export function BalanceMonitorPage() {
  const { profiles, loading } = useProfiles();
  const drill = useDrill(profiles);
  const [nodeSearch, setNodeSearch] = useState("");
  const [wallets, setWallets] = useState<Record<string, number>>({});
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const response = await fetch("/api/balances", { headers: await authHeader() });
      const body = response.ok ? await response.json() : null;
      if (!stop) setWallets(body?.wallets ?? {});
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => { stop = true; window.clearInterval(timer); };
  }, []);
  const scoped = profiles.filter((profile) => drill.loketIds.includes(profile.id) || (drill.leaf !== null && profile.id === drill.leaf));
  const panelRows = drill.nodes.map((node) => ({
    ...node,
    count: node.loketIds.length,
    amount: (node.role === "loket" ? [node.id] : node.loketIds).reduce((sum, id) => sum + Number(wallets[id] ?? 0), 0),
  }));
  return (
    <Shell title="Saldo Mitra/Loket" description="Saldo operasional akun di jaringan Anda.">
      <HierarchyPanel drill={drill} rows={panelRows} search={nodeSearch} onSearch={setNodeSearch} />
      {drill.showNodes ? null : <Card>
        <CardHeader title="Daftar saldo" subtitle={loading ? "Memuat..." : `${scoped.length} akun`} />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Nama", "Peran", "Username", "Saldo"].map((head) => <th key={head} className="px-2.5 py-2 break-words">{head}</th>)}</tr>
            </thead>
            <tbody>
              {scoped.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Belum ada akun jaringan.</td></tr>}
              {scoped.map((profile) => (
                <tr key={profile.id} className="border-t border-slate-100">
                  <td className="px-2.5 py-2 break-words"><div className="font-semibold text-slate-900">{profileLabel(profile)}</div>{profile.role === "loket" && profile.loket_code ? <div className="text-xs text-slate-500">Kode {profile.loket_code}</div> : null}</td>
                  <td className="px-2.5 py-2 break-words">{ROLE_LABELS[roleToUi(profile.role)]}</td>
                  <td className="px-2.5 py-2 break-words font-mono text-xs">{profile.username || "—"}</td>
                  <td className="px-2.5 py-2 break-words font-semibold">{formatRupiah(Number(wallets[profile.id] ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}
    </Shell>
  );
}

export function OutstandingPage() {
  const { transactions, loading } = useTransactions();
  const { profiles } = useProfiles();
  const drill = useDrill(profiles);
  const [nodeSearch, setNodeSearch] = useState("");
  const rows = useMemo(() => {
    const pending = transactions.filter((row) => row.status === "pending" && drill.loketIds.includes(row.user_id));
    const grouped = new Map<string, { count: number; amount: number }>();
    pending.forEach((row) => {
      const current = grouped.get(row.user_id) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += Number(row.amount);
      grouped.set(row.user_id, current);
    });
    return Array.from(grouped.entries()).map(([userId, value]) => ({
      userId,
      name: profileLabel(profiles.find((profile) => profile.id === userId) ?? null),
      ...value,
    }));
  }, [transactions, profiles, drill.loketIds]);
  const panelRows = drill.nodes.map((node) => {
    const matched = rows.filter((row) => node.loketIds.includes(row.userId));
    return { ...node, count: matched.reduce((sum, row) => sum + row.count, 0), amount: matched.reduce((sum, row) => sum + row.amount, 0) };
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <Shell title="Monitoring OS" description="Outstanding transaksi yang masih pending.">
      <HierarchyPanel drill={drill} rows={panelRows} search={nodeSearch} onSearch={setNodeSearch} />
      {drill.showNodes ? null : <Card>
        <CardHeader title="Outstanding" subtitle={loading ? "Memuat..." : formatRupiah(total)} />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Akun", "Jumlah pending", "Nominal OS"].map((head) => <th key={head} className="px-2.5 py-2 break-words">{head}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">Tidak ada outstanding.</td></tr>}
              {rows.map((row) => (
                <tr key={row.userId} className="border-t border-slate-100">
                  <td className="px-2.5 py-2 break-words">{row.name}</td>
                  <td className="px-2.5 py-2 break-words">{row.count}</td>
                  <td className="px-2.5 py-2 break-words font-semibold">{formatRupiah(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}
    </Shell>
  );
}

export function RecapPage() {
  const { isSuperAdmin } = useAuth();
  const { transactions, loading } = useTransactions();
  const networkSales = useNetworkLoketSales();
  const { profiles } = useProfiles();
  const drill = useDrill(profiles);
  const [nodeSearch, setNodeSearch] = useState("");
  const [mode, setMode] = useState<"tanggal" | "loket" | "layanan">("tanggal");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const scopedSales = useMemo(() => {
    const seen = new Set(networkSales.map((row) => row.id));
    const archive = isSuperAdmin ? [...networkSales, ...transactions.filter((row) => !seen.has(row.id))] : networkSales;
    return archive.filter((row) => {
      if (row.status !== "success") return false;
      if (drill.canBack && !drill.loketIds.includes(row.user_id)) return false;
      const day = row.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [transactions, networkSales, drill.loketIds, drill.canBack, from, to, isSuperAdmin]);
  const rows = useMemo(() => {
    const grouped = new Map<string, { count: number; amount: number }>();
    scopedSales.forEach((row) => {
      const key = mode === "tanggal"
        ? row.created_at.slice(0, 10)
        : mode === "loket"
          ? profileLabel(profiles.find((profile) => profile.id === row.user_id) ?? null)
          : (CATEGORY_LABELS[row.category_slug_snapshot as ProductCategory] || row.category_slug_snapshot || "Lainnya");
      const current = grouped.get(key) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += Number(row.amount);
      grouped.set(key, current);
    });
    return Array.from(grouped.entries());
  }, [scopedSales, profiles, mode]);
  const panelRows = drill.nodes.map((node) => {
    const matched = scopedSales.filter((row) => node.loketIds.includes(row.user_id));
    return { ...node, count: matched.length, amount: matched.reduce((sum, row) => sum + Number(row.amount), 0) };
  });
  return (
    <Shell title="Rekap Transaksi" description="Ringkasan per tanggal, per loket, dan per layanan.">
      <HierarchyPanel drill={drill} rows={panelRows} search={nodeSearch} onSearch={setNodeSearch} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {(["tanggal", "loket", "layanan"] as const).map((item) => (
          <Button key={item} variant={mode === item ? "primary" : "outline"} size="sm" onClick={() => setMode(item)}>
            Per {item}
          </Button>
        ))}
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>
      <Card>
        <CardHeader title="Rekap" subtitle={loading && networkSales.length === 0 ? "Memuat..." : `${rows.length} baris`} />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Kelompok", "Jumlah", "Nilai"].map((head) => <th key={head} className="px-2.5 py-2 break-words">{head}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">Belum ada transaksi berhasil.</td></tr>}
              {rows.map(([key, value]) => (
                <tr key={key} className="border-t border-slate-100">
                  <td className="px-2.5 py-2 break-words">{key}</td>
                  <td className="px-2.5 py-2 break-words">{value.count}</td>
                  <td className="px-2.5 py-2 break-words font-semibold">{formatRupiah(value.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}

export function QrisReportPage() {
  const { transactions, loading } = useTransactions();
  const networkSales = useNetworkLoketSales();
  const { profiles } = useProfiles();
  const drill = useDrill(profiles);
  const [nodeSearch, setNodeSearch] = useState("");
  const rows = useMemo(() => {
    const seen = new Set(transactions.map((row) => row.id));
    return [...transactions, ...networkSales.filter((row) => !seen.has(row.id))].filter((row) => drill.loketIds.includes(row.user_id) && `${row.product_name_snapshot} ${row.category_slug_snapshot}`.toLowerCase().includes("qris"));
  }, [transactions, networkSales, drill.loketIds]);
  const panelRows = drill.nodes.map((node) => {
    const matched = rows.filter((row) => node.loketIds.includes(row.user_id));
    return { ...node, count: matched.length, amount: matched.filter((row) => row.status === "success").reduce((sum, row) => sum + Number(row.amount), 0) };
  });
  const total = rows.filter((row) => row.status === "success").reduce((sum, row) => sum + Number(row.amount), 0);
  return (
    <Shell title="Laporan QRIS" description="Transaksi yang tercatat sebagai layanan QRIS.">
      <HierarchyPanel drill={drill} rows={panelRows} search={nodeSearch} onSearch={setNodeSearch} />
      {drill.showNodes ? null : <Card>
        <CardHeader title="QRIS" subtitle={loading ? "Memuat..." : `${rows.length} transaksi · ${formatRupiah(total)}`} />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Waktu", "Produk", "Nominal", "Status"].map((head) => <th key={head} className="px-2.5 py-2 break-words">{head}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Belum ada transaksi QRIS.</td></tr>}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-2.5 py-2 break-words">{formatWaktu(row.created_at)}</td>
                  <td className="px-2.5 py-2 break-words">{row.product_name_snapshot}</td>
                  <td className="px-2.5 py-2 break-words font-semibold">{formatRupiah(row.amount)}</td>
                  <td className="px-2.5 py-2 break-words">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}
    </Shell>
  );
}

interface CollectiveMember { number: string; name: string; product?: string; createdAt?: string }
interface CollectiveRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  loketCode?: string;
  collector?: string;
  category?: string;
  status?: "aktif" | "nonaktif";
  members?: CollectiveMember[];
  bills?: { number: string; status: string; product?: string }[];
  createdAt?: string;
}

export function CollectiveAdminPage() {
  const { profile } = useAuth();
  const { profiles } = useProfiles();
  const [rows, setRows] = useState<CollectiveRow[]>([]);
  const [mitraId, setMitraId] = useState("semua");
  const [loketId, setLoketId] = useState("semua");
  const [status, setStatus] = useState("semua");
  const [detail, setDetail] = useState<CollectiveRow | null>(null);
  const [editor, setEditor] = useState<CollectiveRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ownerId: "", name: "", status: "aktif" });
  const [memberEdit, setMemberEdit] = useState<(CollectiveMember & { original: string; originalProduct: string }) | null>(null);
  const [error, setError] = useState("");
  const showMitra = profile?.role === "super_admin";
  const directory = profilesWithSelf(profiles, profile);
  const lokets = directory.filter((item) => item.role === "loket");
  const mitras = directory.filter((item) => item.role === "mitra");

  const load = async () => {
    const response = await fetch("/api/kolektif", { headers: await authHeader() });
    const text = await response.text();
    let body: { rows?: CollectiveRow[]; error?: string } | null = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok || !Array.isArray(body?.rows)) {
      setError(body?.error || "Daftar kolektif gagal dimuat. Pastikan fungsi API dan kunci Supabase aktif.");
      return;
    }
    const next = body.rows;
    setError("");
    setRows(next);
    setDetail((current) => current ? next.find((row) => row.id === current.id) ?? null : null);
  };
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(() => rows.filter((row) => {
    const owners = networkOwners(row.ownerId, directory);
    if (mitraId !== "semua" && owners.mitra?.id !== mitraId) return false;
    if (loketId !== "semua" && row.ownerId !== loketId) return false;
    if (status !== "semua" && (row.status || "aktif") !== status) return false;
    return true;
  }), [rows, directory, mitraId, loketId, status]);

  const saveGroup = async () => {
    if (!form.name.trim() || !form.ownerId) { setError("Nama grup dan loket wajib diisi."); return; }
    const response = await fetch("/api/kolektif", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify(editor
        ? { id: editor.id, name: form.name.trim(), collector: form.name.trim(), ownerId: form.ownerId, status: form.status }
        : { name: form.name.trim(), collector: form.name.trim(), ownerId: form.ownerId, status: form.status, members: [] }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error || "Grup gagal disimpan."); return; }
    setError("");
    setCreating(false);
    setEditor(null);
    await load();
  };

  const removeGroup = async (row: CollectiveRow) => {
    if (!window.confirm(`Hapus grup ${row.collector || row.name} beserta seluruh pelanggannya?`)) return;
    await fetch("/api/kolektif", { method: "POST", headers: await authHeader(), body: JSON.stringify({ id: row.id, action: "delete" }) });
    if (detail?.id === row.id) setDetail(null);
    await load();
  };

  const saveMember = async () => {
    if (!detail || !memberEdit) return;
    const members = (detail.members ?? []).map((item) => item.number === memberEdit.original && (item.product || "") === memberEdit.originalProduct ? { number: memberEdit.number, name: memberEdit.name, product: memberEdit.product, createdAt: item.createdAt } : item);
    const response = await fetch("/api/kolektif", { method: "POST", headers: await authHeader(), body: JSON.stringify({ id: detail.id, members }) });
    if (!response.ok) { setError("Pelanggan gagal diperbarui."); return; }
    setMemberEdit(null);
    await load();
  };

  const removeMember = async (member: CollectiveMember) => {
    if (!detail) return;
    const members = (detail.members ?? []).filter((item) => !(item.number === member.number && (item.product || "") === (member.product || "")));
    await fetch("/api/kolektif", { method: "POST", headers: await authHeader(), body: JSON.stringify({ id: detail.id, members }) });
    await load();
  };

  const openForm = (row?: CollectiveRow) => {
    setError("");
    setForm({ ownerId: row?.ownerId || lokets[0]?.id || "", name: row?.collector || row?.name || "", status: row?.status || "aktif" });
    setEditor(row ?? null);
    setCreating(true);
  };

  return (
    <Shell title="Manajemen Kolektif" description="Grup kolektif yang dibuat loket masuk otomatis ke Sub Mitra, Mitra, dan Super Admin.">
      {error && !creating && !detail && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      <Card>
        <CardHeader
          title="Daftar grup kolektif"
          subtitle={`${visible.length} grup`}
          action={<button onClick={() => openForm()} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-slate-900"><Plus size={16} /> Tambah Grup</button>}
        />
        <div className={`grid gap-3 border-b border-slate-100 p-4 ${showMitra ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {showMitra && <Field label="Mitra">
            <Select value={mitraId} onChange={(event) => setMitraId(event.target.value)}>
              <option value="semua">Semua mitra</option>
              {mitras.map((item) => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}
            </Select>
          </Field>}
          <Field label="Loket">
            <Select value={loketId} onChange={(event) => setLoketId(event.target.value)}>
              <option value="semua">Semua loket</option>
              {lokets.map((item) => <option key={item.id} value={item.id}>{item.loket_code ? `${item.loket_code} - ${profileLabel(item)}` : profileLabel(item)}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="semua">Semua status</option>
              <option value="aktif">Aktif</option>
              <option value="nonaktif">Nonaktif</option>
            </Select>
          </Field>
        </div>
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["ID Grup", "Nama Grup", ...(showMitra ? ["Mitra"] : []), "Loket", "Jumlah Pelanggan", "Status", "Dibuat", "Aksi"].map((head) => <th key={head} className="px-2.5 py-2 break-words">{head}</th>)}</tr>
            </thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={showMitra ? 8 : 7} className="px-4 py-8 text-center text-slate-500">Belum ada grup kolektif pada filter ini.</td></tr>}
              {visible.map((row) => {
                const owners = networkOwners(row.ownerId, directory);
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2.5 py-2 break-words font-mono text-xs">{row.id.slice(0, 8)}</td>
                    <td className="px-2.5 py-2 break-words font-medium">{row.collector || row.name}{row.category ? ` · ${row.category}` : ""}</td>
                    {showMitra && <td className="px-2.5 py-2 break-words">{owners.mitra ? profileLabel(owners.mitra) : "—"}</td>}
                    <td className="px-2.5 py-2 break-words">{row.loketCode ? `${row.loketCode} - ${row.ownerName}` : row.ownerName}</td>
                    <td className="px-2.5 py-2 break-words">{(row.members ?? []).length}</td>
                    <td className="px-2.5 py-2 break-words"><Badge tone={(row.status || "aktif") === "aktif" ? "success" : "warning"}>{(row.status || "aktif") === "aktif" ? "Aktif" : "Nonaktif"}</Badge></td>
                    <td className="px-2.5 py-2 break-words text-slate-500">{row.createdAt ? formatWaktu(row.createdAt) : "—"}</td>
                    <td className="px-2.5 py-2 break-words">
                      <div className="flex gap-1">
                        <button onClick={() => setDetail(row)} title="Detail anggota" className="rounded-lg bg-sky-600 p-2 text-white"><Users size={14} /></button>
                        <button onClick={() => openForm(row)} title="Edit grup" className="rounded-lg bg-amber-400 p-2 text-slate-900"><Pencil size={14} /></button>
                        <button onClick={() => removeGroup(row)} title="Hapus grup" className="rounded-lg bg-rose-600 p-2 text-white"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {creating && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold text-slate-900">{editor ? "Edit Grup Kolektif" : "Tambah Grup Kolektif"}</h2>
            <div className="mt-3 space-y-3">
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <Field label="Loket pemilik">
                <Select value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}>
                  <option value="">Pilih loket</option>
                  {lokets.map((item) => <option key={item.id} value={item.id}>{item.loket_code ? `${item.loket_code} - ${profileLabel(item)}` : profileLabel(item)}</option>)}
                </Select>
              </Field>
              <Field label="Nama grup"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
              <Field label="Status">
                <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  <option value="aktif">Aktif</option>
                  <option value="nonaktif">Nonaktif</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setCreating(false); setEditor(null); }}>Batal</Button>
              <button onClick={saveGroup} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900">Simpan</button>
            </div>
          </div>
        </div>
      )}
      {detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold text-slate-900">Kelola Pelanggan - {detail.collector || detail.name}{detail.category ? ` · ${detail.category}` : ""}</h2>
            <div className="mt-3 w-full max-w-full">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-10" />
                  <col className="w-36" />
                  <col className="w-24" />
                  <col />
                  <col className="w-28" />
                  <col className="w-32" />
                  <col className="w-24" />
                </colgroup>
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>{["No", "ID Pelanggan", "Kode Produk", "Nama Pelanggan", "Status", "Tanggal Dibuat", "Aksi"].map((head) => <th key={head} className="px-2 py-2">{head}</th>)}</tr>
                </thead>
                <tbody>
                  {(detail.members ?? []).length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Belum ada pelanggan.</td></tr>}
                  {(detail.members ?? []).map((member, index) => {
                    const bill = (detail.bills ?? []).find((item) => item.number === member.number && (!item.product || !member.product || item.product.toUpperCase() === member.product.toUpperCase()));
                    return (
                      <tr key={`${member.product || ""}:${member.number}`} className="border-t border-slate-100">
                        <td className="px-2 py-2">{index + 1}</td>
                        <td className="px-2 py-2 font-mono">{member.number}</td>
                        <td className="px-2 py-2">{member.product || "—"}</td>
                        <td className="break-words px-2 py-2">{member.name}</td>
                        <td className="px-3 py-2">{bill?.status === "LUNAS" ? "Lunas" : bill?.status === "LAINNYA" ? "Perlu Diperiksa" : "Belum Lunas"}</td>
                        <td className="px-3 py-2 text-slate-500">{formatWaktu(member.createdAt || detail.createdAt || "")}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button onClick={() => setMemberEdit({ ...member, original: member.number, originalProduct: member.product || "" })} className="text-xs font-semibold text-amber-700">Edit</button>
                            <button onClick={() => removeMember(member)} className="text-xs font-semibold text-rose-600">Hapus</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-right"><Button variant="outline" onClick={() => { setDetail(null); setMemberEdit(null); }}>Tutup</Button></div>
          </div>
        </div>
      )}
      {detail && memberEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="font-semibold text-slate-900">Edit Pelanggan</h2>
            <div className="mt-3 space-y-3">
              <Field label="Nomor pelanggan"><Input value={memberEdit.number} onChange={(event) => setMemberEdit({ ...memberEdit, number: event.target.value })} /></Field>
              <Field label="Kode produk"><Input value={memberEdit.product || ""} onChange={(event) => setMemberEdit({ ...memberEdit, product: event.target.value })} /></Field>
              <Field label="Nama pelanggan"><Input value={memberEdit.name} onChange={(event) => setMemberEdit({ ...memberEdit, name: event.target.value })} /></Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMemberEdit(null)}>Batal</Button>
              <button onClick={saveMember} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900">Simpan</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

export function RunTextPage() {
  const { profile } = useAuth();
  const { profiles } = useProfiles();
  const [text, setText] = useState("");
  const [target, setTarget] = useState("all");
  const [mitraId, setMitraId] = useState("");
  const [notices, setNotices] = useState<{ id: string; text: string; target: string; mitraId: string | null; expiresAt: string }[]>([]);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const isSuper = profile?.role === "super_admin";
  const mitras = profiles.filter((item) => item.role === "mitra");

  const load = async () => {
    const response = await fetch("/api/runtext", { headers: await authHeader() });
    const body = response.ok ? await response.json() : null;
    setNotices(body?.notices ?? []);
    if (!isSuper) setText(body?.notices?.[0]?.text ?? "");
  };
  useEffect(() => { if (profile) load(); }, [profile?.role]);

  const save = async () => {
    const response = await fetch("/api/runtext", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify(isSuper ? { text, target, mitraId } : { text }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error || "Running text gagal disimpan."); setSaved(""); return; }
    setError("");
    setSaved(text.trim() ? "Running text tayang selama 7 hari." : "Running text dihapus.");
    if (isSuper) setText("");
    await load();
  };

  return (
    <Shell title="Running Text" description={isSuper ? "Teks tampil hanya di dashboard Mitra yang dipilih, selama 7 hari. Teks baru menggantikan teks lama pada tujuan yang sama." : "Teks tampil hanya di dashboard Sub Mitra dan Loket jaringan Anda, selama 7 hari. Menyimpan lagi menggantikan teks sebelumnya."}>
      <Card>
        <div className="space-y-3 p-4">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Field label="Teks"><Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Informasi untuk jaringan" /></Field>
          {isSuper && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tujuan">
                <Select value={target} onChange={(event) => setTarget(event.target.value)}>
                  <option value="all">Semua Mitra</option>
                  <option value="mitra">Mitra tertentu</option>
                </Select>
              </Field>
              {target === "mitra" && (
                <Field label="Mitra">
                  <Select value={mitraId} onChange={(event) => setMitraId(event.target.value)}>
                    <option value="">Pilih mitra</option>
                    {mitras.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.username}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}
          <Button onClick={save}>{text.trim() ? "Tayangkan" : "Hapus Teks"}</Button>
          {saved && <p className="text-sm text-emerald-600">{saved}</p>}
          {notices.length > 0 && (
            <ul className="space-y-2 text-sm text-slate-600">
              {notices.map((item) => (
                <li key={item.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="font-medium text-slate-800 break-words">{item.text}</div>
                  <div className="text-xs text-slate-500">{item.target === "all" ? "Semua mitra" : "Satu mitra"} · sampai {formatWaktu(item.expiresAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </Shell>
  );
}

export function BlockLoketPage() {
  const { profiles, loading, refresh } = useProfiles();
  const [error, setError] = useState("");
  const lokets = profiles.filter((profile) => profile.role === "loket");
  const toggle = async (userId: string, active: boolean) => {
    const response = await fetch("/api/block-loket", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({ userId, active }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Status loket gagal diubah."); return; }
    setError("");
    refresh();
  };
  return (
    <Shell title="Blokir Loket" description="Loket nonaktif tidak dapat masuk. Tombol Aktifkan mengembalikan status menjadi Aktif.">
      {error && <div className="mb-3 text-sm text-rose-600">{error}</div>}
      <Card>
        <CardHeader title="Daftar loket" subtitle={loading ? "Memuat..." : `${lokets.length} loket`} />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>{["Loket", "Username", "Status", "Aksi"].map((head) => <th key={head} className="px-2.5 py-2 break-words">{head}</th>)}</tr>
            </thead>
            <tbody>
              {lokets.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Belum ada loket.</td></tr>}
              {lokets.map((loket) => (
                <tr key={loket.id} className="border-t border-slate-100">
                  <td className="px-2.5 py-2 break-words"><div className="font-semibold text-slate-900">{profileLabel(loket)}</div><div className="text-xs text-slate-500">{loket.loket_code ? `Kode ${loket.loket_code}` : loket.username}</div></td>
                  <td className="px-2.5 py-2 break-words font-mono text-xs">{loket.username || "—"}</td>
                  <td className="px-2.5 py-2"><Badge tone={loket.status === "active" ? "success" : "danger"}>{loket.status === "active" ? "Aktif" : "Nonaktif"}</Badge></td>
                  <td className="px-2.5 py-2 break-words">
                    <Button size="sm" variant="outline" onClick={() => toggle(loket.id, loket.status !== "active")}>
                      {loket.status === "active" ? "Blokir" : "Aktifkan"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}
