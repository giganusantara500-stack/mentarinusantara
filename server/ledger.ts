import fs from "node:fs";
import path from "node:path";

export interface DepositTicket {
  id: string;
  loketId: string;
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
  status: "pending" | "approved" | "cancelled" | "reversed";
  fundedBy?: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface LoketSale {
  id: string;
  loketId: string;
  loketCode?: string;
  loketName?: string;
  category: string;
  product: string;
  customerNumber: string;
  customerName: string;
  amount: number;
  tagihan?: number;
  denda?: number;
  adminFee?: number;
  collfee?: number;
  period?: string;
  parentId?: string;
  status: "success";
  createdAt: string;
}

interface LedgerFile {
  wallets: Record<string, number>;
  tickets: DepositTicket[];
  sales: LoketSale[];
}

const filePath = path.join(process.cwd(), "server", "data", "ledger.json");

function emptyLedger(): LedgerFile {
  return { wallets: {}, tickets: [], sales: [] };
}

function readLedger(): LedgerFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as LedgerFile;
    return {
      wallets: parsed.wallets ?? {},
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
    };
  } catch {
    return emptyLedger();
  }
}

function writeLedger(ledger: LedgerFile) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2));
}

export function cancelOwnTicket(ticketId: string, loketId: string) {
  const ledger = readLedger();
  const ticket = ledger.tickets.find((item) => item.id === ticketId && item.loketId === loketId);
  if (!ticket) return { error: "Tiket deposit tidak ditemukan.", status: 404 };
  if (ticket.status !== "pending") return { error: "Hanya tiket yang masih menunggu yang dapat dibatalkan.", status: 409 };
  ticket.status = "cancelled";
  ticket.decidedAt = new Date().toISOString();
  writeLedger(ledger);
  return { ticket, status: 200 };
}

export function pendingTransferCodes() {
  return new Set(
    readLedger().tickets
      .filter((ticket) => ticket.status === "pending" && ticket.uniqueCode)
      .map((ticket) => ticket.uniqueCode as string),
  );
}

export function listTickets(userId: string, role: string, loketIds: string[] | null = null) {
  const ledger = readLedger();
  const tickets = role === "loket"
    ? ledger.tickets.filter((ticket) => ticket.loketId === userId)
    : loketIds
      ? ledger.tickets.filter((ticket) => loketIds.includes(ticket.loketId))
      : ledger.tickets;
  return tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function walletBalance(userId: string) {
  return readLedger().wallets[userId] ?? 0;
}

export function listWalletBalances() {
  return readLedger().wallets;
}

export function latestLedgerActivity() {
  const ledger = readLedger();
  const marks = new Map<string, number>();
  const note = (id: string, at: string) => {
    const time = Date.parse(at);
    if (!id || !Number.isFinite(time)) return;
    marks.set(id, Math.max(marks.get(id) ?? 0, time));
  };
  for (const sale of ledger.sales) note(sale.loketId, sale.createdAt);
  for (const ticket of ledger.tickets) note(ticket.loketId, ticket.createdAt);
  return marks;
}

export function createTicket(ticket: DepositTicket) {
  const ledger = readLedger();
  ledger.tickets.unshift(ticket);
  writeLedger(ledger);
  return ticket;
}

export function decideTicket(ticketId: string, action: "approve" | "cancel" | "pending" | "void", superAdminId: string) {
  const ledger = readLedger();
  const ticket = ledger.tickets.find((item) => item.id === ticketId);
  if (!ticket) return { error: "Tiket deposit tidak ditemukan.", status: 404 };
  let balance = ledger.wallets[ticket.loketId] ?? 0;
  const wasApproved = ticket.status === "approved";
  const funderId = ticket.fundedBy || superAdminId;
  const rollbackCredit = () => {
    if (balance < ticket.amount) return "Saldo loket tidak cukup untuk menarik kembali setoran ini.";
    if (ticket.fundedBy) ledger.wallets[ticket.fundedBy] = (ledger.wallets[ticket.fundedBy] ?? 0) + ticket.amount;
    balance -= ticket.amount;
    ticket.fundedBy = undefined;
    return "";
  };

  if (action === "approve") {
    if (ticket.status !== "pending") return { error: "Hanya setoran menunggu yang dapat disetujui.", status: 409 };
    const pool = ledger.wallets[superAdminId] ?? 0;
    if (pool < ticket.amount) return { error: "Saldo Super Admin tidak cukup untuk menyetujui setoran ini.", status: 409 };
    ledger.wallets[superAdminId] = pool - ticket.amount;
    ticket.fundedBy = superAdminId;
    ticket.status = "approved";
    balance += ticket.amount;
  } else if (action === "cancel") {
    if (ticket.status !== "pending") return { error: "Hanya setoran menunggu yang dapat ditolak.", status: 409 };
    ticket.status = "cancelled";
  } else if (action === "void") {
    if (!wasApproved) return { error: "Hanya setoran sukses yang dapat ditarik menjadi dibatalkan.", status: 409 };
    const rollbackError = rollbackCredit();
    if (rollbackError) return { error: rollbackError, status: 409 };
    ticket.status = "reversed";
  } else if (action === "pending") {
    if (ticket.status === "pending") return { ticket, balance, poolBalance: ledger.wallets[funderId] ?? 0, funderId, status: 200 };
    if (wasApproved) {
      const rollbackError = rollbackCredit();
      if (rollbackError) return { error: rollbackError, status: 409 };
    }
    ticket.status = "pending";
    ticket.decidedAt = null;
  } else {
    return { error: "Aksi tidak valid.", status: 400 };
  }

  if (action !== "pending") ticket.decidedAt = new Date().toISOString();
  ledger.wallets[ticket.loketId] = balance;
  writeLedger(ledger);
  return { ticket, balance, poolBalance: ledger.wallets[funderId] ?? 0, funderId, status: 200 };
}

export function listLoketSales(loketId: string) {
  return listNetworkSales([loketId]);
}

export function listNetworkSales(loketIds: string[] | null) {
  const sales = readLedger().sales;
  const rows = loketIds ? sales.filter((sale) => loketIds.includes(sale.loketId)) : sales;
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function recordLoketSale(sale: Omit<LoketSale, "id" | "status" | "createdAt">) {
  const paid = creditWallet(sale.loketId, -Math.abs(sale.amount));
  if (paid.error || paid.balance === undefined) return paid;
  const ledger = readLedger();
  const stored: LoketSale = {
    ...sale,
    amount: Math.abs(Math.round(sale.amount)),
    id: crypto.randomUUID(),
    status: "success",
    createdAt: new Date().toISOString(),
  };
  ledger.sales.unshift(stored);
  writeLedger(ledger);
  return { sale: stored, balance: paid.balance, status: 200 };
}

export function creditWallet(userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount === 0) return { error: "Nominal tidak valid.", status: 400 };
  const ledger = readLedger();
  const next = (ledger.wallets[userId] ?? 0) + Math.round(amount);
  if (next < 0) return { error: "Saldo tidak boleh menjadi minus.", status: 409 };
  ledger.wallets[userId] = next;
  writeLedger(ledger);
  return { balance: next, status: 200 };
}
