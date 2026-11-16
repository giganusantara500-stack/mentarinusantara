import { DEPOSIT_ACCOUNTS } from "../src/lib/banks";
import { networkLoketIds, touchActivity } from "./accountAdmin";
import { cancelOwnTicket, createTicket, decideTicket, listNetworkSales, listTickets, pendingTransferCodes, recordLoketSale, walletBalance, type DepositTicket } from "./ledger";
import { ensureLoketCode, listAuthUsers, loketCodeFor, makeTransferCode } from "./loketCode";

interface Env {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface Caller {
  id: string;
  role: string;
  username: string | null;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function loadCaller(authorization: string, env: Env): Promise<Caller | null> {
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const callerResponse = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  const callerAuth = await readJson(callerResponse);
  const callerId = callerAuth?.id as string | undefined;
  if (!callerResponse.ok || !callerId) return null;
  const profileResponse = await fetch(
    `${env.supabaseUrl}/rest/v1/profiles?id=eq.${callerId}&select=id,username,role,is_active`,
    { headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` } },
  );
  const rows = await readJson(profileResponse);
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || profile.is_active === false) return null;
  const stored = String(profile.role ?? "").toLowerCase();
  const role = stored === "sub_mitra" || stored === "submitra" ? "submitra" : stored === "superadmin" ? "super_admin" : stored;
  return { id: callerId, role, username: profile.username ?? null };
}

function accountFor(bank: string) {
  return DEPOSIT_ACCOUNTS.find((account) => account.bank === bank);
}

export async function handleDepositRequest(method: string, pathname: string, body: Record<string, unknown>, caller: Caller, env: Env, authorization = "") {
  if (pathname === "/api/deposits" && method === "GET") {
    const scope = caller.role === "loket" || caller.role === "super_admin" ? null : await networkLoketIds(authorization, env);
    const loketCode = caller.role === "loket" ? await ensureLoketCode(env, caller.id) : "";
    return { status: 200, body: { tickets: listTickets(caller.id, caller.role, scope), accounts: DEPOSIT_ACCOUNTS, balance: walletBalance(caller.id), loketCode } };
  }

  if (pathname === "/api/loket-sales" && method === "GET") {
    if (caller.role === "loket") {
      const loketCode = await ensureLoketCode(env, caller.id);
      return { status: 200, body: { sales: listNetworkSales([caller.id]), balance: walletBalance(caller.id), loketCode } };
    }
    if (!["super_admin", "mitra", "submitra"].includes(caller.role)) {
      return { status: 403, body: { error: "Anda tidak dapat melihat transaksi loket." } };
    }
    const scope = caller.role === "super_admin" ? null : await networkLoketIds(authorization, env);
    return { status: 200, body: { sales: listNetworkSales(scope), balance: walletBalance(caller.id) } };
  }

  if (pathname === "/api/loket-sales" && method === "POST") {
    if (caller.role !== "loket") return { status: 403, body: { error: "Hanya Loket yang dapat membayar dari saldo." } };
    const amount = Number(body.amount);
    const category = clean(body.category);
    const product = clean(body.product);
    const customerNumber = clean(body.customerNumber);
    if (!category || !product || !customerNumber) return { status: 400, body: { error: "Kategori, produk, dan nomor pelanggan wajib diisi." } };
    if (!Number.isFinite(amount) || amount < 1000) return { status: 400, body: { error: "Nominal pembayaran minimal Rp1.000." } };
    const loketCode = await ensureLoketCode(env, caller.id);
    const users = await listAuthUsers(env);
    const self = users.find((user) => user.id === caller.id);
    const parentId = typeof self?.user_metadata?.parent_id === "string" ? self.user_metadata.parent_id : "";
    const result = recordLoketSale({
      loketId: caller.id,
      loketCode,
      loketName: clean(body.loketName) || caller.username || "Loket",
      category,
      product,
      customerNumber,
      customerName: clean(body.customerName) || "Pelanggan",
      amount,
      tagihan: Number(body.tagihan) || 0,
      denda: Number(body.denda) || 0,
      adminFee: Number(body.adminFee) || 0,
      collfee: Number(body.collfee) || 0,
      period: clean(body.period),
      parentId,
    });
    if (result.error || !("sale" in result)) return { status: result.status, body: { error: result.error } };
    await touchActivity(caller.id, env).catch(() => undefined);
    const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
    await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${caller.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ user_metadata: { ...(self?.user_metadata ?? {}), wallet_balance: result.balance } }),
    });
    return { status: 200, body: { sale: result.sale, balance: result.balance } };
  }

  if (pathname === "/api/wallet" && method === "GET") {
    const loketCode = caller.role === "loket" ? await ensureLoketCode(env, caller.id) : "";
    return { status: 200, body: { balance: walletBalance(caller.id), loketCode } };
  }

  if (pathname === "/api/deposits" && method === "POST") {
    if (caller.role !== "loket") return { status: 403, body: { error: "Hanya Loket yang dapat membuat tiket deposit." } };
    const amount = Number(body.amount);
    const bank = clean(body.bank);
    const account = accountFor(bank);
    if (!Number.isFinite(amount) || amount < 10000) return { status: 400, body: { error: "Nominal deposit minimal Rp10.000." } };
    if (!account) return { status: 400, body: { error: "Pilih rekening tujuan." } };
    const createdAt = new Date();
    const ticket: DepositTicket = {
      id: crypto.randomUUID(),
      loketId: caller.id,
      loketName: caller.username || "Loket",
      amount: Math.round(amount),
      bank: account.bank,
      accountNumber: account.accountNumber,
      accountHolder: account.holder,
      transferAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      createdAt: createdAt.toISOString(),
      decidedAt: null,
    };
    const uniqueCode = makeTransferCode(pendingTransferCodes());
    const loketCode = await loketCodeFor(env, caller.id).catch(() => "");
    ticket.loketCode = loketCode;
    ticket.baseAmount = ticket.amount;
    ticket.uniqueCode = uniqueCode;
    ticket.transferAmount = ticket.amount + Number(uniqueCode);
    const created = createTicket(ticket);
    await touchActivity(caller.id, env).catch(() => undefined);
    return { status: 200, body: { ticket: created } };
  }

  if (pathname === "/api/deposits/cancel" && method === "POST") {
    if (caller.role !== "loket") return { status: 403, body: { error: "Hanya Loket yang dapat membatalkan tiketnya sendiri." } };
    const result = cancelOwnTicket(clean(body.id), caller.id);
    if (result.error || !result.ticket) return { status: result.status, body: { error: result.error } };
    return { status: 200, body: { ticket: result.ticket } };
  }

  if (pathname === "/api/deposits/decide" && method === "POST") {
    if (caller.role !== "super_admin") return { status: 403, body: { error: "Hanya Super Admin yang dapat memutuskan tiket deposit." } };
    const action = body.action === "approve" || body.action === "cancel" || body.action === "pending" || body.action === "void"
      ? body.action
      : "";
    if (!action) return { status: 400, body: { error: "Aksi tidak valid." } };
    const result = decideTicket(clean(body.id), action, caller.id);
    if (result.error || !result.ticket) return { status: result.status, body: { error: result.error } };
    const syncWallet = async (userId: string, balance: number) => {
      const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
      const current = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers });
      const user = await current.json();
      await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ user_metadata: { ...(user.user_metadata ?? {}), wallet_balance: balance } }),
      });
    };
    if (action === "approve" || action === "void" || action === "pending") {
      await syncWallet(result.ticket.loketId, result.balance ?? 0);
      if (result.funderId) await syncWallet(result.funderId, result.poolBalance ?? 0);
    }
    return { status: 200, body: { ticket: result.ticket, balance: result.balance } };
  }

  return null;
}
