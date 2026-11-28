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
  sn?: string;
  clientRef?: string;
  profit?: number;
  providerCost?: number;
  sellPrice?: number;
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
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      error: timedOut
        ? "Database saldo tidak menjawab tepat waktu. Cek status sebelum mengulang. Saldo hanya terpotong bila status Sukses."
        : "Database saldo tidak dapat dihubungi.",
      status: timedOut ? 504 : 500,
    };
  }
  const body = await response.json().catch(() => null) as (LedgerResult & { message?: string; details?: string; hint?: string; code?: string }) | null;
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    const message = String(body?.message || "");
    const code = String(body?.code || "");
    const missingColumn = code === "42703" || /does not exist/i.test(message);
    const detail = [body?.message, body?.details, body?.hint, body?.code].filter(Boolean).join(" — ");
    const missingFunction = message.includes("ledger_api");
    const missingClientRef = missingColumn && /client_ref/i.test(`${message} ${body?.details || ""}`);
    return {
      error: missingFunction
        ? "Fungsi saldo di database belum terpasang. Jalankan migrasi terbaru, lalu muat ulang."
        : missingClientRef
          ? "Pembayaran gagal. Kolom client_ref belum ada di database. Jalankan migrasi terbaru, lalu ulangi."
          : (detail || "Database saldo menolak permintaan."),
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

function serviceHeaders(env: LedgerEnv, prefer = "") {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function fullDepositCredit(row: { amount?: number | null; base_amount?: number | null; unique_code?: string | null; transfer_amount?: number | null }) {
  const base = Number(row.base_amount) || Number(row.amount) || 0;
  const codeText = String(row.unique_code ?? "");
  const code = /^[0-9]{1,3}$/.test(codeText) ? Number(codeText) : 0;
  const transfer = Number(row.transfer_amount) || 0;
  if (transfer >= base + code && base + code > 0) return transfer;
  if (code > 0) return base + code;
  return Math.max(transfer, base);
}

async function bookFullDepositCredit(env: LedgerEnv, ticketId: string): Promise<{ error?: string; status: number; credit: number }> {
  const read = await fetch(`${env.supabaseUrl}/rest/v1/deposit_tickets?id=eq.${ticketId}&select=status,route,amount,base_amount,unique_code,transfer_amount`, {
    headers: serviceHeaders(env),
    signal: AbortSignal.timeout(12_000),
  });
  const rows = await read.json().catch(() => null) as Array<{ status?: string; route?: string; amount?: number; base_amount?: number; unique_code?: string; transfer_amount?: number; message?: string }> | { message?: string } | null;
  if (!read.ok || !Array.isArray(rows)) {
    const message = !Array.isArray(rows) ? rows?.message : "";
    return { error: message || "Tiket deposit tidak terbaca. Saldo tidak berubah.", status: read.status || 500, credit: 0 };
  }
  const ticket = rows[0];
  if (!ticket) return { error: "Tiket deposit tidak ditemukan.", status: 404, credit: 0 };
  if (ticket.status !== "pending" || ticket.route !== "pusat") return { status: 200, credit: Number(ticket.amount) || 0 };
  const credit = fullDepositCredit(ticket);
  if (credit <= 0) return { error: "Nominal transfer tidak valid. Saldo tidak berubah.", status: 400, credit: 0 };
  if (credit === Number(ticket.amount)) return { status: 200, credit };
  const write = await fetch(`${env.supabaseUrl}/rest/v1/deposit_tickets?id=eq.${ticketId}&status=eq.pending`, {
    method: "PATCH",
    headers: serviceHeaders(env, "return=representation"),
    body: JSON.stringify({ amount: credit }),
    signal: AbortSignal.timeout(12_000),
  });
  const updated = await write.json().catch(() => null) as Array<{ amount?: number; message?: string }> | { message?: string } | null;
  const stored = Array.isArray(updated) ? Number(updated[0]?.amount) : 0;
  if (!write.ok || stored !== credit) {
    const message = !Array.isArray(updated) ? updated?.message : "";
    return { error: message || "Nominal transfer gagal disiapkan. Saldo tidak berubah.", status: write.status || 500, credit: 0 };
  }
  return { status: 200, credit };
}

async function approveFullDeposit(env: LedgerEnv, actorId: string, ticketId: string): Promise<LedgerResult> {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return { error: "Konfigurasi database belum lengkap.", status: 500 };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) {
    return { error: "Tiket deposit tidak valid. Saldo tidak berubah.", status: 400 };
  }
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/ledger_approve_deposit`, {
      method: "POST",
      headers: serviceHeaders(env),
      body: JSON.stringify({ p_actor: actorId, p_ticket: ticketId }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      error: timedOut
        ? "Database saldo tidak menjawab tepat waktu. Cek saldo sebelum menyetujui lagi."
        : "Database saldo tidak dapat dihubungi. Saldo tidak berubah.",
      status: timedOut ? 504 : 500,
    };
  }
  const body = await response.json().catch(() => null) as (LedgerResult & { message?: string; details?: string; hint?: string; code?: string }) | null;
  const message = String(body?.message || "");
  const missing = response.status === 404 || body?.code === "PGRST202" || /schema cache|could not find the function|ledger_approve_deposit/i.test(`${message} ${body?.details || ""}`);
  if (missing) {
    const booked = await bookFullDepositCredit(env, ticketId).catch(() => ({ error: "Nominal transfer gagal disiapkan. Saldo tidak berubah.", status: 500, credit: 0 }));
    if (booked.error) return { error: booked.error, status: booked.status };
    const moved = await ledgerApi(env, "decide_ticket", actorId, { id: ticketId, action: "approve" });
    console.log(`[deposit] approve ${ticketId} jalur lama nominal ${booked.credit} hasil ${moved.ticket?.status || "gagal"} ${moved.error || ""}`);
    return moved;
  }
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    return {
      error: [body?.message, body?.details, body?.hint].filter(Boolean).join(" — ") || "Database saldo menolak persetujuan. Saldo tidak berubah.",
      status: response.status || 500,
    };
  }
  if (body.error) return { error: body.message || body.error, status: body.status || 409 };
  console.log(`[deposit] approve ${ticketId} nominal ${body.ticket?.amount ?? ""} status ${body.ticket?.status || ""}`);
  return body;
}

export function decideTicket(env: LedgerEnv, actorId: string, ticketId: string, action: "approve" | "cancel" | "pending" | "void") {
  if (action === "approve") return approveFullDeposit(env, actorId, ticketId);
  return ledgerApi(env, "decide_ticket", actorId, { id: ticketId, action });
}

export function distributeBalance(env: LedgerEnv, actorId: string, toId: string, amount: number, toName: string, clientRef = "") {
  return ledgerApi(env, "distribute", actorId, { loketId: toId, amount, loketName: toName, clientRef });
}

export async function moneySnapshot(env: LedgerEnv, actorId: string) {
  if (!env.supabaseUrl || !env.serviceRoleKey) return null;
  try {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/ledger_money_snapshot`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_actor: actorId }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json().catch(() => null) as { error?: string; pusat?: number; fee?: number; wallets?: number; providerUsed?: number } | null;
    if (!response.ok || !body || body.error) return null;
    return {
      pusat: Number(body.pusat) || 0,
      fee: Number(body.fee) || 0,
      wallets: Number(body.wallets) || 0,
      providerUsed: Number(body.providerUsed) || 0,
    };
  } catch {
    return null;
  }
}

export async function syncProviderDeposit(env: LedgerEnv, actorId: string, deposit: number) {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return { error: "Konfigurasi database belum lengkap.", status: 500 };
  }
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/ledger_sync_provider`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_actor: actorId, p_deposit: Math.round(deposit) }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { error: "Database saldo tidak dapat dihubungi.", status: 500 };
  }
  const body = await response.json().catch(() => null) as ({ error?: string; status?: number; balance?: number; providerBalance?: number; credited?: number; consumed?: number; capped?: boolean; message?: string } | null);
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    const missing = String(body && "message" in body ? body.message : "").includes("ledger_sync_provider");
    return { error: missing ? "Fungsi tarik saldo DigiFlazz belum terpasang. Jalankan migrasi terbaru, lalu muat ulang." : "Database saldo menolak penarikan DigiFlazz.", status: response.status || 500 };
  }
  if (body.error && !body.status) return { error: body.message || body.error, status: 500 };
  return body;
}

export async function alignProviderDeposit(env: LedgerEnv, actorId: string, deposit: number) {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    return { error: "Konfigurasi database belum lengkap.", status: 500 };
  }
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/ledger_align_provider`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_actor: actorId, p_deposit: Math.round(deposit) }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { error: "Database saldo tidak dapat dihubungi.", status: 500 };
  }
  const body = await response.json().catch(() => null) as ({ error?: string; status?: number; balance?: number; providerBalance?: number; reduced?: number; added?: number; remaining?: number; shortfall?: number; direction?: string; message?: string; details?: string; hint?: string } | null);
  const detail = [body && "message" in body ? body.message : "", body?.details, body?.hint].filter(Boolean).join(" — ");
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) {
    console.log(`[normalisasi] fungsi ditolak ${response.status} ${detail.slice(0, 300)}`);
    const missing = detail.includes("ledger_align_provider");
    return { error: missing ? "Fungsi normalisasi saldo belum terpasang. Jalankan migrasi terbaru, lalu muat ulang." : (detail || "Database saldo menolak normalisasi."), status: response.status || 500 };
  }
  if (body.error && !body.status) {
    console.log(`[normalisasi] fungsi gagal ${body.message || body.error}`);
    return { error: body.message || body.error, status: body.status || 500 };
  }
  return body;
}

export function creditWallet(env: LedgerEnv, actorId: string, userId: string, amount: number, note = "Penyesuaian saldo Super Admin") {
  return ledgerApi(env, "credit", actorId, { userId, amount, note });
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
  providerCost?: number;
  parentId?: string;
  loketName?: string;
  loketCode?: string;
  channel?: "production" | "simulation";
  outcome?: "pending" | "success" | "failed" | "refund";
  clientRef: string;
}) {
  return ledgerApi(env, "record_sale", actorId, { ...sale });
}
