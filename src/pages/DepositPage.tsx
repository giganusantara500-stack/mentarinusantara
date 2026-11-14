import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { DEPOSIT_ACCOUNTS } from "@/lib/banks";
import { setoranDays, setoranLines } from "@/lib/setoranReport";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { formatRupiah, formatWaktu } from "@/lib/format";

interface Ticket {
  id: string;
  amount: number;
  baseAmount?: number;
  uniqueCode?: string;
  transferAmount?: number;
  loketCode?: string;
  bank: string;
  accountNumber: string;
  accountHolder?: string;
  status: "pending" | "approved" | "cancelled" | "reversed";
  transferAt: string;
  expiresAt?: string;
  createdAt: string;
}

const statusLabel = { pending: "Menunggu", approved: "Sukses", cancelled: "Ditolak", reversed: "Dibatalkan" } as const;
const QUICK_AMOUNTS = [50000, 100000, 250000, 500000, 1000000];

export function DepositModal({ open, onClose, tick, requestRefresh }: { open: boolean; onClose: () => void; tick: number; requestRefresh: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/45 p-4 pt-16" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <DepositPanel onClose={onClose} tick={tick} requestRefresh={requestRefresh} />
      </div>
    </div>
  );
}

function DepositPanel({ onClose, tick, requestRefresh }: { onClose: () => void; tick: number; requestRefresh: () => void }) {
  const { profile } = useAuth();
  const [tab, setTab] = useState<"request" | "history" | "mutasi" | "pantauan">("request");
  const [balance, setBalance] = useState(0);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sales, setSales] = useState<{ id: string; product: string; amount: number; createdAt: string }[]>([]);
  const [amount, setAmount] = useState("");
  const bank = DEPOSIT_ACCOUNTS[0].bank;
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [issued, setIssued] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [preview, setPreview] = useState(false);

  const load = async () => {
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits", {
      headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Tiket deposit gagal dimuat."); return; }
    setBalance(Number(body.balance ?? 0));
    setTickets(body.tickets ?? []);
    const salesRes = await fetch("/api/loket-sales", {
      headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
    });
    if (salesRes.ok) setSales((await salesRes.json()).sales ?? []);
  };

  useEffect(() => { load(); }, [tick]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ amount: Number(amount), bank }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) { setError(body.error || "Tiket gagal dibuat."); return; }
    setIssued(body.ticket ?? null);
    setAmount("");
    requestRefresh();
    await load();
  };

  const refreshStatus = async () => {
    await load();
    requestRefresh();
  };

  const cancelTicket = async () => {
    if (!issued) return;
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      body: JSON.stringify({ id: issued.id }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Tiket gagal dibatalkan."); return; }
    setIssued(body.ticket ?? null);
    await load();
    requestRefresh();
  };

  const copyTicket = async () => {
    if (!issued) return;
    const text = [
      "MENTARI NUSANTARA",
      `Kode loket ${issued.loketCode || "-"}`,
      `Bank ${issued.bank}`,
      `No. rekening ${issued.accountNumber}`,
      `a.n. ${issued.accountHolder || "Aris Purwanto"}`,
      `Total transfer ${formatRupiah(issued.transferAmount ?? issued.amount)}`,
      `Kode unik ${issued.uniqueCode || "-"}`,
      `Jam transfer ${formatWaktu(issued.transferAt)}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
  };

  const remain = issued?.expiresAt ? Math.max(0, new Date(issued.expiresAt).getTime() - now) : 0;
  const remainLabel = [Math.floor(remain / 3600000), Math.floor((remain % 3600000) / 60000), Math.floor((remain % 60000) / 1000)].map((part) => String(part).padStart(2, "0")).join(":");
  const account = DEPOSIT_ACCOUNTS[0];
  const periodLabel = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const days = setoranDays(
    Number(year),
    Number(month),
    sales.map((sale) => ({ amount: sale.amount, at: sale.createdAt })),
    tickets.map((ticket) => ({ amount: ticket.baseAmount ?? ticket.amount, at: ticket.transferAt, status: ticket.status })),
  );
  const printSetoran = () => {
    const identity = `${profile?.loket_code || "-"} - ${profile?.full_name || profile?.username || "Loket"}`;
    const popup = window.open("", "setoran", "width=980,height=720");
    if (!popup) return;
    popup.document.write(`<pre style="font-family:ui-monospace,monospace;font-size:12px">${setoranLines(identity, periodLabel, days, formatRupiah).join("\n")}</pre>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Deposit</div>
          <div className="text-xs text-slate-500">Saldo {formatRupiah(balance)} · kode loket di header</div>
        </div>
        <button onClick={onClose} className="rounded-full px-3 py-1 text-xs font-semibold text-slate-500">Tutup</button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
        {([["request", "Request Tiket Deposit"], ["history", "History"], ["mutasi", "Mutasi Saldo"], ["pantauan", "Pantauan Setoran"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${tab === key ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>
        ))}
      </div>
      <div className="space-y-3 p-4">

      {issued && (
        <Card className="border-amber-300">
          <CardBody className="space-y-2">
            <div className="text-xs uppercase text-slate-500">Jam transfer</div>
            <div className="text-sm font-semibold text-slate-900">{formatWaktu(issued.transferAt)}</div>
            <div className="text-xs uppercase text-slate-500">Masa berlaku</div>
            <div className={`font-mono text-2xl font-bold ${remain === 0 ? "text-rose-600" : "text-amber-600"}`}>{issued.status === "pending" ? remainLabel : statusLabel[issued.status]}</div>
            {issued.status === "pending" && <div className="text-xs text-slate-500">Tiket berlaku 6 jam.</div>}
            <div className="text-sm text-slate-700">Total transfer <span className="font-bold">{formatRupiah(issued.transferAmount ?? issued.amount)}</span></div>
            <div className="text-sm text-slate-700">Kode unik <span className="font-mono text-lg font-bold">{issued.uniqueCode}</span> · {issued.bank} {issued.accountNumber}</div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={copyTicket}>Salin Semua Informasi</Button>
              <Button size="sm" variant="outline" onClick={refreshStatus}>Perbarui Status</Button>
              <Button size="sm" variant="danger" onClick={cancelTicket} disabled={issued.status !== "pending"}>Batalkan Tiket</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "request" && <div className="space-y-3">
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
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{account.bank} · {account.accountNumber}<div className="text-xs text-slate-500">a.n. {account.holder}</div></div>
          </Field>
          {error && <div className="sm:col-span-2 text-sm text-rose-600">{error}</div>}
          <div className="sm:col-span-2">
            <Button onClick={create} disabled={busy || Number(amount) < 10000}>{busy ? "Menyimpan..." : "Buat Tiket Deposit"}</Button>
          </div>
        </div>
      </div>}

      {tab === "history" && <Card>
        <CardHeader title="Tiket saya" subtitle={`${tickets.length} tiket`} />
        <div className="divide-y divide-slate-100">
          {tickets.length === 0 && <div className="p-6 text-sm text-center text-slate-500">Belum ada tiket deposit.</div>}
          {tickets.map((ticket) => (
            <div key={ticket.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="text-sm font-medium text-slate-800">{formatRupiah(ticket.amount)}</div>
                <div className="text-xs text-slate-500">{ticket.bank} • transfer {formatWaktu(ticket.transferAt)}</div>
              </div>
              <Badge tone={ticket.status === "approved" ? "success" : ticket.status === "pending" ? "warning" : ticket.status === "reversed" ? "info" : "danger"}>{statusLabel[ticket.status]}</Badge>
            </div>
          ))}
        </div>
      </Card>}

      {tab === "pantauan" && <Card>
        <CardHeader title="Pantauan setoran" subtitle="Pilih bulan dan tahun, lalu tampilkan rincian harian." />
        <div className="grid gap-3 px-5 pb-3 sm:grid-cols-2">
          <Field label="Bulan">
            <Select value={month} onChange={(event) => { setMonth(event.target.value); setPreview(false); }}>
              {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2026, index, 1).toLocaleDateString("id-ID", { month: "long" })}</option>)}
            </Select>
          </Field>
          <Field label="Tahun">
            <Select value={year} onChange={(event) => { setYear(event.target.value); setPreview(false); }}>
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((item) => <option key={item}>{item}</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex gap-2 px-5 pb-4">
          <button onClick={() => setPreview(true)} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white">Preview Laporan</button>
          <Button size="sm" variant="outline" disabled={!preview} onClick={printSetoran}>CETAK</Button>
        </div>
        {preview && (
          <div className="w-full max-w-full">
            <table className="w-full table-fixed text-right text-xs">
              <thead className="bg-slate-100 text-slate-500">
                <tr>{["TGL", "LBR", "RUPIAH", "T.LBR", "T.RUPIAH", "REMARK", "SETOR", "T.SETOR", "SELISIH"].map((head) => <th key={head} className={`px-2 py-2 font-semibold ${head === "TGL" || head === "REMARK" ? "text-left" : ""}`}>{head}</th>)}</tr>
              </thead>
              <tbody>
                {days.map((row) => (
                  <tr key={row.day} className="border-t border-slate-100 text-slate-700">
                    <td className="px-2 py-1.5 text-left">{row.day}</td>
                    <td className="px-2 py-1.5">{row.lbr}</td>
                    <td className="px-2 py-1.5">{formatRupiah(row.rupiah)}</td>
                    <td className="px-2 py-1.5">{row.tLbr}</td>
                    <td className="px-2 py-1.5">{formatRupiah(row.tRupiah)}</td>
                    <td className="px-2 py-1.5 text-left">{row.remark}</td>
                    <td className="px-2 py-1.5">{formatRupiah(row.setor)}</td>
                    <td className="px-2 py-1.5">{formatRupiah(row.tSetor)}</td>
                    <td className="px-2 py-1.5">{formatRupiah(row.selisih)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-2 gap-8 px-5 py-6 text-center text-xs text-slate-500">
              <div>Dibuat Oleh<div className="mt-10 text-slate-300">(................................)</div></div>
              <div>Diperiksa Oleh<div className="mt-10 text-slate-300">(................................)</div></div>
            </div>
          </div>
        )}
      </Card>}

      {tab === "mutasi" && <Card>
        <CardHeader title="Mutasi Saldo" subtitle="Setoran disetujui menambah saldo. Pembayaran mengurangi saldo." />
        <div className="divide-y divide-slate-100">
          {tickets.filter((ticket) => ticket.status === "approved").map((ticket) => (
            <div key={ticket.id} className="flex justify-between px-5 py-3 text-sm"><span>Setoran {ticket.bank}</span><span className="font-semibold text-emerald-700">+{formatRupiah(ticket.amount)}</span></div>
          ))}
          {sales.map((sale) => (
            <div key={sale.id} className="flex justify-between px-5 py-3 text-sm"><span>{sale.product} · {formatWaktu(sale.createdAt)}</span><span className="font-semibold text-rose-700">-{formatRupiah(sale.amount)}</span></div>
          ))}
        </div>
      </Card>}
      </div>
    </div>
  );
}
