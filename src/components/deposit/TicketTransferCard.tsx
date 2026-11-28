import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CopyChip } from "@/components/deposit/CopyChip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { countdownLabel, ticketPhase, type DepositTicketView } from "@/lib/depositStatus";
import { formatRupiah, formatWaktu } from "@/lib/format";

export interface TransferTicket extends DepositTicketView {
  id: string;
  uniqueCode?: string;
  baseAmount?: number;
  amount: number;
  transferAmount?: number;
  bank: string;
  accountNumber: string;
  accountHolder?: string;
  transferAt: string;
  route?: "pusat" | "jaringan";
}

export function TicketTransferCard({
  ticket,
  now,
  onRefresh,
  onCancel,
  onClaim,
}: {
  ticket: TransferTicket;
  now: number;
  onRefresh: () => void;
  onCancel?: () => void;
  onClaim?: () => void;
}) {
  const [qr, setQr] = useState("");
  const phase = ticketPhase(ticket, now);
  const total = Number(ticket.transferAmount ?? ticket.amount) || 0;
  const plainTotal = String(total);
  const remain = ticket.expiresAt ? Math.max(0, new Date(ticket.expiresAt).getTime() - now) : 0;
  const note = [
    "MENTARI NUSANTARA",
    "Informasi transfer, bukan QR pembayaran bank",
    `Bank ${ticket.bank}`,
    `Rekening ${ticket.accountNumber}`,
    `Total ${plainTotal}`,
    `Kode unik ${ticket.uniqueCode || "-"}`,
  ].join("\n");

  useEffect(() => {
    let stop = false;
    QRCode.toDataURL(note, { margin: 1, width: 180, errorCorrectionLevel: "M" }).then((url) => {
      if (!stop) setQr(url);
    }).catch(() => {
      if (!stop) setQr("");
    });
    return () => { stop = true; };
  }, [note]);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kode unik</div>
          <div className="break-all font-mono text-3xl font-black tracking-[0.12em] text-slate-950 sm:text-4xl">{ticket.uniqueCode || "---"}</div>
        </div>
        <Badge tone={phase.tone}>{phase.label}</Badge>
      </div>
      <div className="rounded-lg bg-slate-950 px-4 py-3 text-white">
        <div className="text-xs text-amber-200">Total yang harus ditransfer</div>
        <div className="text-2xl font-black">{formatRupiah(total)}</div>
        <div className="mt-2 font-mono text-3xl font-black tabular-nums">{ticket.status === "pending" ? countdownLabel(ticket.expiresAt, now) : phase.label}</div>
        {ticket.status === "pending" && <div className="text-xs text-white/70">{remain === 0 ? "Waktu pembayaran habis." : "Bayar sebelum waktu ini habis."}</div>}
      </div>
      <div className="space-y-3 text-sm text-slate-700">
        <div>{ticket.bank} · a.n. {ticket.accountHolder || "Mentari Nusantara"}</div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Nomor rekening</div>
            <div className="break-all font-mono text-base font-semibold text-slate-950">{ticket.accountNumber}</div>
          </div>
          <CopyChip value={ticket.accountNumber} done="Nomor rekening tersalin." />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Nilai yang ditransfer</div>
            <div className="break-words text-base font-semibold text-slate-950">{formatRupiah(total)}</div>
            <div className="font-mono text-xs text-slate-500">Kode {ticket.uniqueCode || "-"}</div>
          </div>
          <CopyChip value={plainTotal} done="Nilai transfer tersalin." />
        </div>
        <div className="text-xs text-slate-500">Dibuat {formatWaktu(ticket.transferAt)}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {ticket.status === "pending" && remain > 0 && !ticket.claimedAt && onClaim && <Button size="sm" variant="outline" onClick={onClaim}>Sudah transfer</Button>}
        <Button size="sm" variant="outline" onClick={onRefresh}>Perbarui status</Button>
        {onCancel && <Button size="sm" variant="danger" onClick={onCancel} disabled={ticket.status !== "pending"}>Batalkan tiket</Button>}
      </div>
      <div className="flex flex-wrap gap-3 rounded-lg bg-slate-50 p-3">
        {qr ? <img src={qr} alt="QR informasi transfer" className="h-28 w-28 shrink-0 rounded bg-white" /> : <div className="h-28 w-28 shrink-0 rounded bg-white" />}
        <p className="min-w-[12rem] flex-1 text-xs leading-5 text-slate-600">QR ini hanya berisi catatan rekening, nominal, dan kode unik. Aplikasi bank atau e-wallet tidak bisa memindainya sebagai pembayaran resmi, dan tidak akan mengisi nominal otomatis di semua bank. Utamakan tombol salin supaya angka tidak salah ketik.</p>
      </div>
    </div>
  );
}
