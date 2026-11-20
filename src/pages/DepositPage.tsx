import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { dbRoleToAppRole, useAuth } from "@/lib/auth";
import { DEPOSIT_ACCOUNTS } from "@/lib/banks";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { openDepositTicket, ticketPhase } from "@/lib/depositStatus";
import { TicketTransferCard } from "@/components/deposit/TicketTransferCard";

interface Ticket {
  id: string;
  loketId?: string;
  amount: number;
  baseAmount?: number;
  uniqueCode?: string;
  transferAmount?: number;
  loketName?: string;
  loketCode?: string;
  applicantRole?: string;
  bank: string;
  accountNumber: string;
  accountHolder?: string;
  status: "pending" | "approved" | "cancelled" | "reversed";
  route?: "pusat" | "jaringan";
  transferAt: string;
  expiresAt?: string;
  createdAt: string;
  claimedAt?: string | null;
}

const QUICK_AMOUNTS = [50000, 100000, 250000, 500000, 1000000];

function roleText(role?: string) {
  if (role === "super_admin" || role === "superadmin") return "Super Admin";
  if (role === "mitra") return "Mitra";
  if (role === "submitra" || role === "sub_mitra") return "Sub Mitra";
  if (role === "loket") return "Loket";
  return "Pemohon";
}

function scopeText(role: string) {
  if (role === "superadmin") return "Seluruh pengajuan di sistem.";
  if (role === "mitra") return "Milik Anda, plus Sub Mitra dan Loket di bawah Anda.";
  if (role === "submitra") return "Milik Anda, plus Loket di bawah Anda.";
  return "Hanya milik loket ini.";
}

function normalizeTicket(ticket: Ticket): Ticket {
  const uniqueCode = String(ticket.uniqueCode ?? "").replace(/\D/g, "").padStart(3, "0").slice(-3);
  const baseAmount = Number(ticket.baseAmount ?? ticket.amount) || 0;
  const createdAt = ticket.createdAt || new Date().toISOString();
  const expiresAt = ticket.expiresAt || new Date(new Date(createdAt).getTime() + 6 * 60 * 60 * 1000).toISOString();
  return {
    ...ticket,
    uniqueCode,
    baseAmount,
    amount: Number(ticket.amount) || baseAmount,
    transferAmount: Number(ticket.transferAmount) || baseAmount + Number(uniqueCode),
    createdAt,
    expiresAt,
  };
}

export function DepositModal({ open, onClose, tick, requestRefresh }: { open: boolean; onClose: () => void; tick: number; requestRefresh: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/45 px-[1.5cm] pb-6 pt-16" onClick={onClose}>
      <div className="max-h-[82vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <DepositPanel onClose={onClose} tick={tick} requestRefresh={requestRefresh} />
      </div>
    </div>
  );
}

interface MutationRow {
  id: string;
  at: string;
  note: string;
  direction: string;
  amount: number;
  balanceAfter?: number;
  accountId?: string;
}

function openingBalance(row: MutationRow) {
  const after = Number(row.balanceAfter ?? 0);
  const value = Number(row.amount) || 0;
  return row.direction === "credit" ? after - value : after + value;
}

function DepositPanel({ onClose, tick, requestRefresh, page = false }: { onClose: () => void; tick: number; requestRefresh: () => void; page?: boolean }) {
  const { profile } = useAuth();
  const role = profile ? dbRoleToAppRole(profile.role) : "loket";
  const canCreate = role === "loket" || role === "mitra" || role === "submitra";
  const [tab, setTab] = useState<"request" | "history" | "mutasi" | "pantauan">("request");
  const [balance, setBalance] = useState(0);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [mutations, setMutations] = useState<MutationRow[]>([]);
  const [amount, setAmount] = useState("");
  const bank = DEPOSIT_ACCOUNTS[0].bank;
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const receiptRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [decideId, setDecideId] = useState("");
  const decideLock = useRef("");

  const load = async () => {
    try {
      const session = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
      const response = await fetch("/api/deposits", { headers });
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) return;
      setBalance(Number(body.balance ?? 0));
      setMutations(body.mutations ?? []);
      setTickets(((body.tickets ?? []) as Ticket[]).map(normalizeTicket));
    } catch {
      /* daftar lama tetap tampil bila penyegaran gagal */
    }
  };

  useEffect(() => { load(); }, [tick]);
  useEffect(() => {
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token ?? "";
      if (!token) {
        setError("Sesi login berakhir. Masuk kembali, lalu buat tiket.");
        return;
      }
      const response = await fetch("/api/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: Number(amount), bank, route: "pusat" }),
      });
      const text = await response.text();
      let body: { error?: string; ticket?: Ticket } = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { error: response.status === 431 ? "Sesi login terlalu besar untuk dikirim. Muat ulang server, lalu coba lagi." : "Server tidak mengembalikan tiket." }; }
      const ticket = body.ticket ? normalizeTicket(body.ticket) : null;
      if (!response.ok || !ticket?.id || !ticket.uniqueCode || ticket.uniqueCode === "000") {
        setError(body.error || (response.status === 431 ? "Sesi login terlalu besar untuk dikirim. Muat ulang server, lalu coba lagi." : "Tiket gagal dibuat."));
        return;
      }
      setTickets((current) => [ticket, ...current.filter((item) => item.id !== ticket.id)]);
      setAmount("");
      requestRefresh();
      window.setTimeout(() => receiptRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    } catch {
      setError("Tiket gagal disimpan. Periksa koneksi, lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  const ownTickets = tickets.filter((ticket) => ticket.loketId === profile?.id);
  const openTicket = canCreate ? openDepositTicket(ownTickets, now) : null;
  const account = DEPOSIT_ACCOUNTS[0];
  const waiting = tickets.filter((ticket) => ticket.status === "pending" && ticketPhase(ticket, now).label !== "Kedaluwarsa");
  const archive = tickets.filter((ticket) => !waiting.some((item) => item.id === ticket.id));

  const refreshStatus = async () => {
    await load();
    requestRefresh();
  };

  const cancelTicket = async () => {
    if (!openTicket) return;
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      body: JSON.stringify({ id: openTicket.id }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Tiket gagal dibatalkan."); return; }
    await load();
    requestRefresh();
  };

  const claimTicket = async () => {
    if (!openTicket) return;
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      body: JSON.stringify({ id: openTicket.id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error || "Status tiket gagal diperbarui."); return; }
    await load();
  };

  const decide = async (id: string, action: "approve" | "cancel") => {
    const lock = id + action;
    if (decideLock.current) return;
    decideLock.current = lock;
    setDecideId(lock);
    setError("");
    try {
      const session = await supabase.auth.getSession();
      const response = await fetch("/api/deposits/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
        body: JSON.stringify({ id, action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error || "Keputusan gagal disimpan."); return; }
      await load();
    } finally {
      decideLock.current = "";
      setDecideId("");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-[1.5cm] py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Deposit</div>
          <div className="text-xs text-slate-500">Saldo {formatRupiah(balance)} · {scopeText(role)}</div>
        </div>
        <button onClick={onClose} className="rounded-full px-3 py-1 text-xs font-semibold text-slate-500">{page ? "Kembali" : "Tutup"}</button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-[1.5cm] py-2">
        {([["request", "Request Tiket Deposit"], ["history", "History"], ["mutasi", "Mutasi Saldo"], ["pantauan", "Pantauan Setoran"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${tab === key ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>
        ))}
      </div>
      <div className="space-y-3 px-[1.5cm] py-4">
      {error && tab !== "request" && <p className="text-sm text-rose-600">{error}</p>}

      {tab === "request" && <div className="space-y-3">
        {!openTicket && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Tidak ada tiket yang sedang berjalan. Tiket dibatalkan dan kedaluwarsa tidak menghalangi pengajuan baru.</p>}
        {openTicket && (
          <div ref={receiptRef}>
            <TicketTransferCard ticket={openTicket} now={now} onRefresh={refreshStatus} onCancel={cancelTicket} onClaim={claimTicket} />
          </div>
        )}
        {canCreate ? <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((value) => (
            <button key={value} onClick={() => setAmount(String(value))} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${amount === String(value) ? "bg-amber-400 text-slate-900" : "bg-slate-100 text-slate-600"}`}>{formatRupiah(value)}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nominal">
            <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="100000" />
          </Field>
          <Field label="Rekening tujuan">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{account.bank} · {account.accountNumber}<div className="text-xs text-slate-500">a.n. {account.holder}. Disetujui Super Admin.</div></div>
          </Field>
          {error && <div className="sm:col-span-2 text-sm text-rose-600">{error}</div>}
          <div className="sm:col-span-2 space-y-2">
            {openTicket && <p className="text-sm text-amber-800">Masih ada tiket yang berjalan ({ticketPhase(openTicket, now).label}). Selesaikan atau batalkan tiket itu dulu. Tombol buat tiket baru baru bisa dipakai setelah tiket ini berhasil, kedaluwarsa, atau dibatalkan.</p>}
            <Button onClick={create} disabled={busy || !!openTicket || Number(amount) < 10000}>{busy ? "Menyimpan..." : "Buat Tiket Deposit"}</Button>
          </div>
        </div>
        </div> : <p className="text-sm text-slate-600">Super Admin tidak membuat tiket. Buka tab Pantauan Setoran untuk menyetujui atau menolak pengajuan.</p>}
      </div>}

      {tab === "history" && <Card>
        <CardHeader title="Riwayat tiket yang sudah selesai" subtitle={`${archive.length} tiket selesai, dibatalkan, atau kedaluwarsa · ${scopeText(role)}`} />
        <div className="divide-y divide-slate-100">
          {archive.length === 0 && <div className="p-6 text-sm text-center text-slate-500">Belum ada riwayat. Tiket yang masih berjalan ada di tab Request atau Pantauan.</div>}
          {archive.map((ticket) => (
            <div key={ticket.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="text-sm font-medium text-slate-800">{ticket.loketName || "Pemohon"} · {roleText(ticket.applicantRole)}</div>
                <div className="text-xs text-slate-500">Kode {ticket.uniqueCode || "-"} · {formatRupiah(ticket.transferAmount ?? ticket.amount)} · {formatWaktu(ticket.transferAt)}</div>
              </div>
              <Badge tone={ticketPhase(ticket, now).tone}>{ticketPhase(ticket, now).label}</Badge>
            </div>
          ))}
        </div>
      </Card>}

      {tab === "pantauan" && <Card>
        <CardHeader title="Antrean yang menunggu keputusan" subtitle={role === "superadmin" ? `${waiting.length} tiket menunggu. Setujui memindahkan saldo satu kali.` : `${waiting.length} tiket menunggu Super Admin.`} />
        <div className="divide-y divide-slate-100">
          {waiting.length === 0 && <div className="p-6 text-center text-sm text-slate-500">Tidak ada tiket yang menunggu. Riwayat selesai ada di tab History.</div>}
          {waiting.map((ticket) => (
            <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="text-sm font-medium text-slate-800">{ticket.loketName || "Pemohon"} · {roleText(ticket.applicantRole)}</div>
                <div className="text-xs text-slate-500">Kode {ticket.uniqueCode || "-"} · transfer {formatRupiah(ticket.transferAmount ?? ticket.amount)} · saldo {formatRupiah(ticket.baseAmount ?? ticket.amount)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={ticketPhase(ticket, now).tone}>{ticketPhase(ticket, now).label}</Badge>
                {role === "superadmin" && ticket.status === "pending" && ticketPhase(ticket, now).label !== "Kedaluwarsa" && (
                  <>
                    <Button size="sm" disabled={decideId === `${ticket.id}approve`} onClick={() => decide(ticket.id, "approve")}>Setujui</Button>
                    <Button size="sm" variant="outline" disabled={decideId === `${ticket.id}cancel`} onClick={() => decide(ticket.id, "cancel")}>Tolak</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>}

      {tab === "mutasi" && <Card>
        <CardHeader title="Buku mutasi saldo" subtitle={scopeText(role)} />
        <div className="divide-y divide-slate-100">
          <div className="grid grid-cols-4 gap-2 bg-slate-50 px-5 py-2 text-[11px] font-semibold uppercase text-slate-500"><span>Keterangan</span><span>Awal</span><span>Perubahan</span><span>Akhir</span></div>
          {mutations.length === 0 && <div className="px-5 py-6 text-center text-sm text-slate-500">Belum ada perubahan saldo pada jangkauan peran ini.</div>}
          {mutations.map((row) => (
            <div key={row.id} className="grid grid-cols-4 gap-2 px-5 py-3 text-sm">
              <div className="font-medium text-slate-800">{row.direction === "credit" ? "Masuk" : "Keluar"} · {row.note}<div className="text-xs font-normal text-slate-500">{formatWaktu(row.at)}</div></div>
              <div>{formatRupiah(openingBalance(row))}</div>
              <div className={`font-semibold ${row.direction === "credit" ? "text-emerald-700" : "text-rose-700"}`}>{row.direction === "credit" ? "+" : "-"}{formatRupiah(row.amount)}</div>
              <div>{formatRupiah(Number(row.balanceAfter ?? 0))}</div>
            </div>
          ))}
        </div>
      </Card>}
      </div>
    </div>
  );
}
export function PusatDepositPage() {
  return (
    <PageContainer>
      <DepositPanel page tick={0} requestRefresh={() => undefined} onClose={() => { window.location.hash = "/dashboard"; }} />
    </PageContainer>
  );
}
