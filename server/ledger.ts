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
  route?: "pusat" | "jaringan";
  approverId?: string | null;
  applicantRole?: string;
  uplineName?: string;
  uplineRole?: string;
  fundedBy?: string;
  decidedBy?: string | null;
  createdAt: string;
  decidedAt: string | null;
  claimedAt?: string | null;
}

export const PUSAT_ACCOUNT = "__pusat__";

export interface FundMutation {
  id: string;
  at: string;
  ticketId: string;
  actorId: string;
  accountId: string;
  counterpartyId: string | null;
  direction: "credit" | "debit";
  amount: number;
  balanceAfter: number;
  route: "pusat" | "jaringan" | "produksi";
  kind?: "distribusi";
  note: string;
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
  status: "pending" | "success" | "failed" | "refunded" | "simulated";
  channel?: "production" | "simulation";
  createdAt: string;
}

export interface LedgerEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
}

interface LedgerResult {
  error?: string;
  status: number;
  balance?: number;
  poolBalance?: number;
  funderId?: string;
  ticket?: DepositTicket;
  tickets?: DepositTicket[];
  mutations?: FundMutation[];
  sales?: LoketSale[];
  simulations?: LoketSale[];
  wallets?: Record<string, number>;
  marks?: Record<string, number>;
  sale?: LoketSale;
  id?: string;
  fromBalance?: number;
  toBalance?: number;
  imported?: boolean;
}

async function ledgerApi(env: LedgerEnv, action: string, actorId: string, payload: Record<string, unknown> = {}): Promise<LedgerResult> {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return { error: "Konfigurasi database belum lengkap.", status: 500 };
  }
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/ledger_api`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_action: action, p_actor: actorId, p_payload: payload }),
    });
  } catch {
    return { error: "Database saldo tidak dapat dihubungi.", status: 500 };
  }
  const body = await response.json().catch(() => null) as (LedgerResult & { message?: string; details?: string; hint?: string; code?: string }) | null;
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    const detail = [body?.message, body?.details, body?.hint, body?.code].filter(Boolean).join(" — ");
    const missing = String(body?.message ?? "").includes("ledger_api");
    return {
      error: missing ? "Fungsi saldo di database belum terpasang. Jalankan migrasi terbaru, lalu muat ulang." : (detail || "Database saldo menolak permintaan."),
      status: response.status || 500,
    };
  }
  if (body.error && !body.status) return { error: body.message || body.error, status: 500 };
  return body;
}

export function importLedgerSnapshot(env: LedgerEnv, snapshot: Record<string, unknown>) {
  return ledgerApi(env, "import", "00000000-0000-0000-0000-000000000000", snapshot);
}

export async function walletBalance(env: LedgerEnv, actorId: string, userId = actorId) {
  const result = await ledgerApi(env, "balance", actorId, { userId });
  return result.balance ?? 0;
}

export async function listWalletBalances(env: LedgerEnv, actorId: string) {
  const result = await ledgerApi(env, "balances", actorId);
  return result.wallets ?? {};
}

export async function latestLedgerActivity(env: LedgerEnv, actorId: string) {
  const result = await ledgerApi(env, "activity", actorId);
  return new Map(Object.entries(result.marks ?? {}).map(([id, at]) => [id, Number(at)]));
}

export async function listTickets(env: LedgerEnv, actorId: string) {
  const result = await ledgerApi(env, "tickets", actorId);
  return result.tickets ?? [];
}

export async function listMutations(env: LedgerEnv, actorId: string) {
  const result = await ledgerApi(env, "mutations", actorId);
  return result.mutations ?? [];
}

export async function listNetworkSales(env: LedgerEnv, actorId: string) {
  const result = await ledgerApi(env, "sales", actorId);
  return result.sales ?? [];
}

export async function listSimulations(env: LedgerEnv, actorId: string) {
  const result = await ledgerApi(env, "simulations", actorId);
  return result.simulations ?? [];
}

export function createTicket(env: LedgerEnv, actorId: string, ticket: DepositTicket) {
  return ledgerApi(env, "create_ticket", actorId, {
    amount: ticket.amount,
    uniqueCode: ticket.uniqueCode,
    bank: ticket.bank,
    accountNumber: ticket.accountNumber,
    accountHolder: ticket.accountHolder,
    loketName: ticket.loketName,
    loketCode: ticket.loketCode,
    uplineName: ticket.uplineName,
    uplineRole: ticket.uplineRole,
    route: "pusat",
  });
}

export function cancelOwnTicket(env: LedgerEnv, actorId: string, ticketId: string) {
  return ledgerApi(env, "cancel_ticket", actorId, { id: ticketId });
}

export function claimTicket(env: LedgerEnv, actorId: string, ticketId: string) {
  return ledgerApi(env, "claim_ticket", actorId, { id: ticketId });
}

export function decideTicket(env: LedgerEnv, actorId: string, ticketId: string, action: "approve" | "cancel" | "pending" | "void") {
  return ledgerApi(env, "decide_ticket", actorId, { id: ticketId, action });
}

export function distributeBalance(env: LedgerEnv, actorId: string, toId: string, amount: number, toName: string) {
  return ledgerApi(env, "distribute", actorId, { loketId: toId, amount, loketName: toName });
}

export function creditWallet(env: LedgerEnv, actorId: string, userId: string, amount: number) {
  return ledgerApi(env, "credit", actorId, { userId, amount, note: "Penyesuaian saldo Super Admin" });
}

export function recordLoketSale(env: LedgerEnv, actorId: string, sale: {
  category: string;
  product: string;
  customerNumber: string;
  customerName?: string;
  amount: number;
  tagihan?: number;
  denda?: number;
  adminFee?: number;
  collfee?: number;
  period?: string;
  parentId?: string;
  loketName?: string;
  loketCode?: string;
  channel?: "production" | "simulation";
  outcome?: "pending" | "success" | "failed" | "refund";
  clientRef: string;
}) {
  return ledgerApi(env, "record_sale", actorId, { ...sale });
}
