export interface DepositTicketView {
  status: "pending" | "approved" | "cancelled" | "reversed";
  expiresAt?: string;
  claimedAt?: string | null;
}

export function ticketPhase(ticket: DepositTicketView, now = Date.now()) {
  const expires = ticket.expiresAt ? new Date(ticket.expiresAt).getTime() : 0;
  if (ticket.status === "pending" && expires > 0 && expires <= now) {
    return { label: "Kedaluwarsa", tone: "danger" as const };
  }
  if (ticket.status === "pending" && ticket.claimedAt) {
    return { label: "Menunggu Persetujuan", tone: "warning" as const };
  }
  if (ticket.status === "pending") {
    return { label: "Menunggu Pembayaran", tone: "warning" as const };
  }
  if (ticket.status === "approved") {
    return { label: "Berhasil", tone: "success" as const };
  }
  return { label: "Dibatalkan", tone: "danger" as const };
}

export function openDepositTicket<T extends DepositTicketView>(tickets: T[], now = Date.now()) {
  return tickets.find((ticket) => ticket.status === "pending" && ticketPhase(ticket, now).label !== "Kedaluwarsa") ?? null;
}

export function countdownLabel(expiresAt: string | undefined, now: number) {
  if (!expiresAt) return "00:00:00";
  const remain = Math.max(0, new Date(expiresAt).getTime() - now);
  const parts = [Math.floor(remain / 3600000), Math.floor((remain % 3600000) / 60000), Math.floor((remain % 60000) / 1000)];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}
