import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatRupiah, formatWaktu } from "@/lib/format";

interface Ticket {
  id: string;
  loketName: string;
  amount: number;
  bank: string;
  accountNumber: string;
  accountHolder: string;
  transferAt: string;
  status: "pending" | "approved" | "cancelled";
}

const statusLabel = { pending: "Menunggu", approved: "Disetujui", cancelled: "Ditolak" } as const;

export function DepositApprovalPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = async () => {
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits", {
      headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Daftar setoran gagal dimuat."); return; }
    setTickets(body.tickets ?? []);
  };

  useEffect(() => { load(); }, []);

  const decide = async (id: string, action: "approve" | "cancel") => {
    setBusyId(id);
    setError("");
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits/decide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ id, action }),
    });
    const body = await response.json();
    setBusyId("");
    if (!response.ok) { setError(body.error || "Keputusan gagal disimpan."); return; }
    await load();
  };

  return (
    <PageContainer>
      <PageHeader title="Persetujuan Deposit" description="Aris Purwanto meninjau seluruh tiket setoran dari loket." />
      {error && <div className="mb-4 text-sm text-rose-600">{error}</div>}
      <Card>
        <CardHeader title="Pantauan Setoran" subtitle={`${tickets.length} tiket`} />
        <div className="w-full max-w-full">
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-2.5 py-2 break-words">Jam transfer</th>
                <th className="px-2.5 py-2 break-words">Nama loket</th>
                <th className="px-2.5 py-2 break-words">Nominal</th>
                <th className="px-2.5 py-2 break-words">Rekening tujuan</th>
                <th className="px-2.5 py-2 break-words">Status</th>
                <th className="px-2.5 py-2 break-words">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Belum ada tiket deposit.</td></tr>
              )}
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b border-slate-50">
                  <td className="px-2.5 py-2 break-words text-slate-600">{formatWaktu(ticket.transferAt)}</td>
                  <td className="px-2.5 py-2 break-words font-medium text-slate-800">{ticket.loketName}</td>
                  <td className="px-2.5 py-2 break-words">{formatRupiah(ticket.amount)}</td>
                  <td className="px-2.5 py-2 break-words text-slate-600">{ticket.bank} {ticket.accountNumber}<div className="text-xs text-slate-400">a.n. {ticket.accountHolder}</div></td>
                  <td className="px-2.5 py-2 break-words"><Badge tone={ticket.status === "approved" ? "success" : ticket.status === "cancelled" ? "danger" : "warning"}>{statusLabel[ticket.status]}</Badge></td>
                  <td className="px-2.5 py-2 break-words">
                    {ticket.status === "pending" && (
                      <div className="flex gap-2">
                        <Button size="sm" disabled={busyId === ticket.id} onClick={() => decide(ticket.id, "approve")}>Approve</Button>
                        <Button size="sm" variant="danger" disabled={busyId === ticket.id} onClick={() => decide(ticket.id, "cancel")}>Cancel</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}
