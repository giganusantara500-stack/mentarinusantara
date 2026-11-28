import { DEPOSIT_ACCOUNTS } from "../src/lib/banks";
import { networkLoketIds, touchActivity } from "./accountAdmin";
import { attachSaleReceipts, omitFeeBreakdown, requestedMode, runBillerPayment, syncOpenNetworkSales, syncPendingSales } from "./biller";
import { digiflazzDeposit } from "./digiflazz";
import { alignProviderDeposit, cancelOwnTicket, claimTicket, createTicket, creditWallet, decideTicket, distributeBalance, listMutations, listNetworkSales, listSimulations, listTickets, moneySnapshot, PUSAT_ACCOUNT, syncProviderDeposit, walletBalance, type DepositTicket } from "./ledger";
import { listAuthUsers, loketCodeFor, makeTransferCode } from "./loketCode";

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

function canonRole(value: unknown) {
  const stored = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (stored === "super_admin" || stored === "superadmin") return "super_admin";
  if (stored === "mitra") return "mitra";
  if (stored === "submitra" || stored === "sub_mitra") return "submitra";
  if (stored === "loket" || stored === "role_loket") return "loket";
  return "";
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
    signal: AbortSignal.timeout(12_000),
  });
  const callerAuth = await readJson(callerResponse);
  const callerId = callerAuth?.id as string | undefined;
  if (!callerResponse.ok || !callerId) return null;
  const profileResponse = await fetch(
    `${env.supabaseUrl}/rest/v1/profiles?id=eq.${callerId}&select=*`,
    { headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` }, signal: AbortSignal.timeout(12_000) },
  );
  const rows = await readJson(profileResponse);
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || profile.is_active === false || profile.status === "suspended") return null;
  const meta = (callerAuth?.user_metadata ?? {}) as Record<string, unknown>;
  const loketCode = typeof meta.loket_code === "string" && /^\d{7}$/.test(meta.loket_code);
  const role = canonRole(profile.role) || canonRole(meta.role) || (loketCode || meta.loket_type ? "loket" : "");
  if (!role) return null;
  return { id: callerId, role, username: profile.username ?? null };
}

async function listNormalizations(env: Env) {
  try {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/balance_normalizations?select=id,at,provider_balance,pusat_before,pusat_after,wallets,fee,direction,amount,remaining,note&order=at.desc&limit=12`, {
      headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await readJson(response);
    if (!response.ok || !Array.isArray(body)) return [];
    return body.map((row: { id?: string; at?: string; provider_balance?: number; pusat_before?: number; pusat_after?: number; wallets?: number; fee?: number; direction?: string; amount?: number; remaining?: number; note?: string }) => ({
      id: String(row.id || ""),
      at: String(row.at || ""),
      providerBalance: Number(row.provider_balance) || 0,
      pusatBefore: Number(row.pusat_before) || 0,
      pusatAfter: Number(row.pusat_after) || 0,
      wallets: Number(row.wallets) || 0,
      fee: Number(row.fee) || 0,
      direction: row.direction === "credit" || row.direction === "debit" ? row.direction : "none",
      amount: Number(row.amount) || 0,
      remaining: Number(row.remaining) || 0,
      note: String(row.note || ""),
    }));
  } catch {
    return [];
  }
}

let normalizeChain: Promise<void> = Promise.resolve();

function queueNormalize<T>(task: () => Promise<T>) {
  const run = normalizeChain.then(task, task);
  normalizeChain = run.then(() => undefined, () => undefined);
  return run;
}

function applicantWithdrew(ticket: { status?: string; decidedBy?: string | null }) {
  return ticket.status === "cancelled" && !ticket.decidedBy;
}

async function recordNormalization(env: Env, row: { actorId: string; providerBalance: number; pusatBefore: number; pusatAfter: number; wallets: number; fee: number; direction: string; amount: number; note: string; key: string }) {
  try {
    const response = await fetch(`${env.supabaseUrl}/rest/v1/balance_normalizations`, {
      method: "POST",
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({
        actor_id: row.actorId,
        provider_balance: row.providerBalance,
        pusat_before: row.pusatBefore,
        pusat_after: row.pusatAfter,
        wallets: row.wallets,
        fee: row.fee,
        direction: row.direction,
        amount: row.amount,
        remaining: 0,
        note: row.note,
        idempotency_key: row.key,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.log(`[normalisasi] riwayat gagal ${response.status} ${text.replace(/\s+/g, " ").slice(0, 240)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.log(`[normalisasi] riwayat gagal ${error instanceof Error ? error.message : "jaringan"}`);
    return false;
  }
}

function accountFor(bank: string) {
  return DEPOSIT_ACCOUNTS.find((account) => account.bank === bank);
}

async function profileRow(env: Env, id: string) {
  if (!id) return null;
  const response = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${id}&select=id,role,parent_id,mitra_id,created_by`, {
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  const rows = await readJson(response);
  return Array.isArray(rows) ? rows[0] as { role?: string; parent_id?: string | null; mitra_id?: string | null; created_by?: string | null } : null;
}

export async function handleDepositRequest(method: string, pathname: string, body: Record<string, unknown>, caller: Caller, env: Env, authorization = "") {
  if (pathname === "/api/deposits" && method === "GET") {
    const loketCode = caller.role === "loket" ? await loketCodeFor(env, caller.id).catch(() => "") : "";
    const [tickets, mutations, balance] = await Promise.all([
      listTickets(env, caller.id),
      listMutations(env, caller.id),
      walletBalance(env, caller.id),
    ]);
    const visibleTickets = caller.role === "super_admin"
      ? tickets.filter((ticket) => !applicantWithdrew(ticket))
      : tickets.filter((ticket) => ticket.loketId === caller.id || ticket.status !== "pending");
    const visibleMutations = caller.role === "super_admin"
      ? mutations
      : mutations
        .filter((row) => row.accountId === caller.id)
        .map((row) => ({ ...row, note: String(row.note ?? "").replace(/super\s*admin/gi, "pusat") }));
    return { status: 200, body: { tickets: visibleTickets, mutations: visibleMutations, accounts: DEPOSIT_ACCOUNTS, balance, loketCode } };
  }

  if (pathname === "/api/loket-sales" && method === "GET") {
    if (!["loket", "super_admin", "mitra", "submitra"].includes(caller.role)) {
      return { status: 403, body: { error: "Anda tidak dapat melihat transaksi loket." } };
    }
    const [listed, simulations, balance] = await Promise.all([
      listNetworkSales(env, caller.id),
      listSimulations(env, caller.id),
      walletBalance(env, caller.id),
    ]);
    if (caller.role === "loket") void syncPendingSales(env, caller.id).catch(() => undefined);
    else void syncOpenNetworkSales(env).catch(() => undefined);
    const sales = (await attachSaleReceipts(env, listed).catch(() => listed)).map((sale) => caller.role === "super_admin" ? sale : omitFeeBreakdown(sale));
    const loketCode = caller.role === "loket" ? await loketCodeFor(env, caller.id).catch(() => "") : "";
    return { status: 200, body: { sales, simulations: caller.role === "loket" ? [] : simulations, balance, loketCode } };
  }

  if (pathname === "/api/loket-sales/cleanup" && method === "POST") {
    if (caller.role !== "loket") return { status: 403, body: { error: "Hanya Loket yang dapat membersihkan percobaan di riwayatnya." } };
    await syncPendingSales(env, caller.id, true).catch(() => 0);
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const headers = {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    const removed = await fetch(`${env.supabaseUrl}/rest/v1/payment_simulations?loket_id=eq.${encodeURIComponent(caller.id)}`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(12_000),
    }).then(async (response) => response.ok ? await response.json().catch(() => []) : []).catch(() => []);
    const closed = await fetch(`${env.supabaseUrl}/rest/v1/transactions?user_id=eq.${encodeURIComponent(caller.id)}&status=eq.pending&created_at=lt.${encodeURIComponent(cutoff)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "failed", completed_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(12_000),
    }).then(async (response) => response.ok ? await response.json().catch(() => []) : []).catch(() => []);
    const balance = await walletBalance(env, caller.id);
    return {
      status: 200,
      body: {
        removedSimulations: Array.isArray(removed) ? removed.length : 0,
        closedPending: Array.isArray(closed) ? closed.length : 0,
        balance,
        message: "Percobaan simulasi dihapus dan pending yang menggantung ditutup tanpa memotong saldo. Transaksi Sukses tetap tersimpan.",
      },
    };
  }

  if (pathname === "/api/loket-sales" && method === "POST") {
    if (caller.role !== "loket") return { status: 403, body: { error: "Hanya Loket yang dapat membayar dari saldo." } };
    const amount = Number(body.amount);
    const category = clean(body.category);
    const product = clean(body.product);
    const customerNumber = clean(body.customerNumber);
    const clientRef = clean(body.clientRef);
    if (!clientRef) return { status: 400, body: { error: "Transaksi tidak memiliki kunci unik." } };
    if (!category || !product || !customerNumber) return { status: 400, body: { error: "Kategori, produk, dan nomor pelanggan wajib diisi." } };
    if (!Number.isFinite(amount) || amount < 1000) return { status: 400, body: { error: "Nominal pembayaran minimal Rp1.000." } };
    const mode = requestedMode(body.channel);
    const tail = clientRef.replace(/[^a-z0-9]/gi, "").slice(-6) || "------";
    const loketCode = await loketCodeFor(env, caller.id).catch(() => "");
    const selfProfile = await profileRow(env, caller.id);
    const parentId = selfProfile?.parent_id || "";
    const result = await runBillerPayment(env, caller.id, mode, {
      loketCode,
      loketName: clean(body.loketName) || caller.username || "Loket",
      category,
      product,
      customerNumber,
      customerName: clean(body.customerName),
      amount,
      tagihan: Number(body.tagihan) || 0,
      denda: Number(body.denda) || 0,
      adminFee: Number(body.adminFee) || 0,
      collfee: Number(body.collfee) || 0,
      period: clean(body.period),
      providerCost: Number(body.providerCost) || 0,
      parentId,
      clientRef,
      buyerSkuCode: clean(body.buyerSkuCode),
      kind: clean(body.kind),
      providerRef: clean(body.providerRef),
    });
    let balance = Number(result.balance);
    if (!Number.isFinite(balance)) balance = await walletBalance(env, caller.id);
    if (!Number.isFinite(balance)) balance = 0;
    const providerSn = "sn" in result && typeof result.sn === "string" ? result.sn : "";
    const recordedStatus = "sale" in result && result.sale ? result.sale.status : "";
    const statusText = ("paymentStatus" in result && result.paymentStatus) || recordedStatus || "failed";
    const failed = statusText === "failed" || statusText === "refunded";
    console.log(`[bayar] ${result.sale ? (failed ? "gagal" : statusText) : "berhenti"} ref···${tail}${result.error ? ` ${String(result.error).replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
    if (!result.sale) {
      return { status: result.status || 409, body: { error: result.error || "Pembayaran gagal. Saldo tidak dipotong.", balance, statusText } };
    }
    const enriched = (await attachSaleReceipts(env, [result.sale]).catch(() => [result.sale]))[0] ?? result.sale;
    const sale = omitFeeBreakdown({ ...enriched, sn: enriched.sn || providerSn });
    await touchActivity(caller.id, env).catch(() => undefined);
    const inFlight = Boolean(result.error) && !failed && statusText !== "success" && statusText !== "simulated";
    if (inFlight) {
      return { status: result.status || 409, body: { error: result.error, sale, balance, statusText, channel: sale.channel } };
    }
    return {
      status: failed ? 409 : 200,
      body: {
        sale,
        balance,
        channel: sale.channel,
        statusText,
        ...(failed ? { error: result.error || "Pembayaran gagal. Saldo tidak dipotong." } : {}),
      },
    };
  }

  if (pathname === "/api/wallet" && method === "GET") {
    const loketCode = caller.role === "loket" ? await loketCodeFor(env, caller.id).catch(() => "") : "";
    const own = await walletBalance(env, caller.id);
    const mainBalance = caller.role === "super_admin" ? await walletBalance(env, caller.id, PUSAT_ACCOUNT) : own;
    const provider = caller.role === "super_admin" ? await digiflazzDeposit().catch(() => ({ balance: null as number | null, error: "Saldo DigiFlazz tidak dapat dihubungi." })) : { balance: null as number | null, error: "" };
    const feeBalance = caller.role === "super_admin" ? await walletBalance(env, caller.id, "__fee__") : 0;
    const snapshot = caller.role === "super_admin" ? await moneySnapshot(env, caller.id) : null;
    const networkBalance = snapshot?.wallets ?? 0;
    const providerUsed = snapshot?.providerUsed ?? 0;
    const liveProvider = provider.balance;
    const reconciledGap = snapshot && liveProvider != null
      ? mainBalance + networkBalance + feeBalance - liveProvider
      : null;
    const normalizations = caller.role === "super_admin" ? await listNormalizations(env) : [];
    return { status: 200, body: { balance: caller.role === "super_admin" ? mainBalance : own, mainBalance, loketCode, providerBalance: provider.balance, providerError: provider.error, feeBalance, networkBalance, providerUsed, reconciledGap, reconcileReady: Boolean(snapshot), normalizations } };
  }

  if (pathname === "/api/wallet/sync" && method === "POST") {
    if (caller.role !== "super_admin") return { status: 403, body: { error: "Hanya Super Admin yang dapat menarik saldo DigiFlazz." } };
    const provider = await digiflazzDeposit(true).catch(() => ({ balance: null as number | null, error: "Saldo DigiFlazz tidak dapat dihubungi." }));
    if (provider.balance == null) return { status: 502, body: { error: provider.error || "Saldo DigiFlazz tidak terbaca." } };
    const synced = await syncProviderDeposit(env, caller.id, provider.balance);
    if (synced.error || synced.balance === undefined) return { status: synced.status || 500, body: { error: synced.error || "Saldo Utama gagal diselaraskan." } };
    const credited = Number(synced.credited) || 0;
    const consumed = Number(synced.consumed) || 0;
    const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString("id-ID")}`;
    const note = credited > 0
      ? `Setoran baru ${rupiah(credited)} masuk ke Saldo Utama. Tarikan berhenti di batas saldo DigiFlazz.`
      : synced.capped
        ? "Saldo Utama sudah mencapai saldo DigiFlazz. Setoran tidak ditambahkan. Gunakan Normalisasi saldo bila angkanya masih selisih."
        : "Tidak ada setoran baru. Saldo yang sudah ditarik atau sudah ada di dompet loket tidak ditarik ulang.";
    const snapshot = await moneySnapshot(env, caller.id);
    const networkBalance = snapshot?.wallets ?? 0;
    const providerUsed = snapshot?.providerUsed ?? 0;
    const reconciledGap = snapshot && provider.balance != null ? Number(synced.balance) + networkBalance + (snapshot.fee ?? 0) - provider.balance : null;
    return { status: 200, body: { balance: synced.balance, providerBalance: provider.balance, credited, consumed, networkBalance, providerUsed, reconciledGap, feeBalance: snapshot?.fee ?? 0, reconcileReady: Boolean(snapshot), message: note } };
  }

  if ((pathname === "/api/wallet/align" || pathname === "/api/wallet/normalize") && method === "POST") {
    if (caller.role !== "super_admin") return { status: 403, body: { error: "Hanya Super Admin yang dapat menormalkan saldo." } };
    return queueNormalize(async () => {
      const provider = await digiflazzDeposit(true).catch(() => ({ balance: null as number | null, error: "Saldo DigiFlazz tidak dapat dihubungi." }));
      if (provider.balance == null) return { status: 502, body: { error: provider.error || "Saldo DigiFlazz tidak terbaca. Normalisasi tidak dijalankan." } };
      const target = Math.round(provider.balance);
      const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString("id-ID")}`;
      const before = await walletBalance(env, caller.id, PUSAT_ACCOUNT);
      console.log(`[normalisasi] mulai saldoUtama=${before} digiflazz=${target} actor=${caller.id}`);
      const aligned = await alignProviderDeposit(env, caller.id, target);
      if (aligned.error) console.log(`[normalisasi] fungsi ${aligned.error}`);
      let balance = Number.isFinite(Number(aligned.balance)) ? Number(aligned.balance) : before;
      if (Math.abs(balance - target) > 1) {
        const current = await walletBalance(env, caller.id, PUSAT_ACCOUNT);
        const delta = target - Math.round(current);
        if (delta !== 0) {
          const moved = await creditWallet(env, caller.id, PUSAT_ACCOUNT, delta, "Normalisasi saldo mengikuti DigiFlazz");
          if (moved.error || moved.balance === undefined) {
            console.log(`[normalisasi] gagal ${moved.error || "saldo tidak kembali"}`);
            return { status: moved.status || 500, body: { error: moved.error || "Saldo Utama gagal disamakan dengan DigiFlazz." } };
          }
          balance = Number(moved.balance);
        } else {
          balance = current;
        }
      }
      if (Math.abs(balance - target) > 1) {
        const message = `Saldo Utama masih ${rupiah(balance)} dan belum mengikuti DigiFlazz ${rupiah(target)}.`;
        console.log(`[normalisasi] gagal ${message}`);
        return { status: 409, body: { error: message } };
      }
      const delta = balance - before;
      const direction = delta > 0 ? "credit" : delta < 0 ? "debit" : "none";
      const amount = Math.abs(delta);
      const snapshot = await moneySnapshot(env, caller.id);
      const note = amount > 0
        ? `Saldo Utama ${delta > 0 ? "naik" : "turun"} ${rupiah(amount)} menjadi ${rupiah(balance)}, mengikuti DigiFlazz. Dompet loket tidak diubah.`
        : "Saldo Utama sudah mengikuti DigiFlazz. Tidak ada selisih yang dipindahkan.";
      if (amount > 0) {
        await recordNormalization(env, {
          actorId: caller.id,
          providerBalance: target,
          pusatBefore: before,
          pusatAfter: balance,
          wallets: snapshot?.wallets ?? 0,
          fee: snapshot?.fee ?? 0,
          direction,
          amount,
          note,
          key: `digiflazz-normalize:${before}:${target}:${target}`,
        });
      }
      const stored = await listNormalizations(env);
      const entry = amount > 0 ? {
        id: `digiflazz-normalize:${before}:${target}:${target}`,
        at: new Date().toISOString(),
        providerBalance: target,
        pusatBefore: before,
        pusatAfter: balance,
        direction,
        amount,
        remaining: 0,
        note,
      } : null;
      const normalizations = entry && !stored.some((row) => row.pusatBefore === before && row.pusatAfter === balance && row.amount === amount)
        ? [entry, ...stored]
        : stored;
      console.log(`[normalisasi] selesai saldoUtama=${balance} digiflazz=${target} selisih=${delta}`);
      const networkBalance = snapshot?.wallets ?? 0;
      const reconciledGap = snapshot ? balance + networkBalance + (snapshot.fee ?? 0) - target : null;
      return { status: 200, body: { balance, providerBalance: target, reduced: delta < 0 ? amount : 0, added: delta > 0 ? amount : 0, remaining: 0, shortfall: 0, direction, networkBalance, providerUsed: snapshot?.providerUsed ?? 0, feeBalance: snapshot?.fee ?? 0, reconciledGap, reconcileReady: Boolean(snapshot), normalizations, message: note } };
    });
  }

  if (pathname === "/api/deposits" && method === "POST") {
    if (!["loket", "mitra", "submitra"].includes(caller.role)) return { status: 403, body: { error: "Hanya Mitra, Sub Mitra, atau Loket yang dapat membuat tiket deposit." } };
    const amount = Number(body.amount);
    const requested = "pusat";
    if (clean(body.route) === "jaringan") return { status: 400, body: { error: "Setoran deposit hanya ke rekening pusat. Saldo loket diisi langsung oleh Mitra." } };
    if (!Number.isFinite(amount) || amount < 10000) return { status: 400, body: { error: "Nominal deposit minimal Rp10.000." } };
    const open = (await listTickets(env, caller.id)).find((ticket) => {
      const expired = Boolean(ticket.expiresAt) && new Date(ticket.expiresAt as string).getTime() <= Date.now();
      return ticket.loketId === caller.id && ticket.status === "pending" && !expired && (ticket.route === "jaringan" ? "jaringan" : "pusat") === requested;
    });
    if (open) return { status: 409, body: { error: "Masih ada tiket pada jalur yang sama yang menunggu keputusan." } };
    const users = await listAuthUsers(env).catch(() => []);
    const self = users.find((user) => user.id === caller.id);
    const meta = (self?.user_metadata ?? {}) as Record<string, unknown>;
    const selfProfile = await profileRow(env, caller.id);
    const parentId = (typeof meta.parent_id === "string" && meta.parent_id) || selfProfile?.parent_id || "";
    const parent = users.find((user) => user.id === parentId);
    const parentMeta = (parent?.user_metadata ?? {}) as Record<string, unknown>;
    const parentProfile = await profileRow(env, parentId);
    const parentRole = canonRole(parentMeta.role) || canonRole(parentProfile?.role);
    const bank = clean(body.bank);
    const account = accountFor(bank || DEPOSIT_ACCOUNTS[0].bank);
    if (!account) return { status: 400, body: { error: "Pilih rekening tujuan." } };
    const createdAt = new Date();
    const uniqueCode = makeTransferCode(new Set((await listTickets(env, caller.id)).filter((ticket) => ticket.status === "pending" && ticket.uniqueCode).map((ticket) => ticket.uniqueCode as string)));
    const loketCode = caller.role === "loket" ? await loketCodeFor(env, caller.id).catch(() => "") : "";
    const baseAmount = Math.round(amount);
    const ticket: DepositTicket = {
      id: globalThis.crypto?.randomUUID?.() ?? `${createdAt.getTime()}-${uniqueCode}`,
      loketId: caller.id,
      loketName: clean(meta.full_name) || caller.username || (caller.role === "loket" ? "Loket" : "Mitra"),
      loketCode,
      amount: baseAmount,
      baseAmount,
      uniqueCode,
      transferAmount: baseAmount + Number(uniqueCode),
      bank: account.bank,
      accountNumber: account.accountNumber,
      accountHolder: account.holder,
      transferAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      route: requested,
      approverId: null,
      applicantRole: caller.role,
      uplineName: parentId ? (clean(parentMeta.full_name) || clean(parentMeta.username) || "Upline") : "Pusat",
      uplineRole: parentRole || "super_admin",
      createdAt: createdAt.toISOString(),
      decidedAt: null,
    };
    try {
      const created = await createTicket(env, caller.id, ticket);
      if (created.error || !created.ticket?.id) return { status: created.status || 500, body: { error: created.error || "Database tidak mengembalikan tiket deposit." } };
      await touchActivity(caller.id, env).catch(() => undefined);
      return { status: 200, body: { ticket: created.ticket } };
    } catch {
      return { status: 500, body: { error: "Tiket gagal disimpan." } };
    }
  }

  if (pathname === "/api/distribute" && method === "POST") {
    if (caller.role !== "super_admin") return { status: 403, body: { error: "Hanya Super Admin yang dapat mendistribusikan saldo ke Loket." } };
    const loketId = clean(body.loketId);
    const amount = Math.round(Number(body.amount));
    if (!loketId || !Number.isFinite(amount) || amount < 1000) return { status: 400, body: { error: "Pilih loket dan nominal minimal Rp1.000." } };
    const scope = await networkLoketIds(authorization, env);
    if (scope && !scope.includes(loketId)) return { status: 403, body: { error: "Loket ini tidak berada di jaringan Anda." } };
    const target = await profileRow(env, loketId);
    if (canonRole(target?.role) !== "loket") return { status: 403, body: { error: "Saldo hanya dapat dikirim ke loket." } };
    const users = await listAuthUsers(env);
    const loketUser = users.find((user) => user.id === loketId);
    const loketName = clean(loketUser?.user_metadata?.full_name) || clean(loketUser?.user_metadata?.username) || "Loket";
    const rawRef = clean(body.clientRef);
    const clientRef = /^[A-Za-z0-9:_-]{8,80}$/.test(rawRef) ? rawRef : "";
    const result = await distributeBalance(env, caller.id, loketId, amount, loketName, clientRef);
    if (result.error || result.fromBalance === undefined || result.toBalance === undefined) return { status: result.status, body: { error: result.error } };
    return { status: 200, body: { id: result.id, balance: result.fromBalance, loketBalance: result.toBalance } };
  }

  if (pathname === "/api/deposits/claim" && method === "POST") {
    const result = await claimTicket(env, caller.id, clean(body.id));
    if (result.error || !result.ticket) return { status: result.status, body: { error: result.error } };
    return { status: 200, body: { ticket: result.ticket } };
  }

  if (pathname === "/api/deposits/cancel" && method === "POST") {
    if (!["loket", "mitra", "submitra"].includes(caller.role)) return { status: 403, body: { error: "Hanya pemohon yang dapat membatalkan tiketnya sendiri." } };
    const result = await cancelOwnTicket(env, caller.id, clean(body.id));
    if (result.error || !result.ticket) return { status: result.status, body: { error: result.error } };
    return { status: 200, body: { ticket: result.ticket } };
  }

  if (pathname === "/api/deposits/decide" && method === "POST") {
    if (caller.role !== "super_admin") return { status: 403, body: { error: "Aksi ini tidak diizinkan." } };
    const action = body.action === "approve" || body.action === "cancel" || body.action === "pending" || body.action === "void"
      ? body.action
      : "";
    if (!action) return { status: 400, body: { error: "Aksi tidak valid." } };
    const result = await decideTicket(env, caller.id, clean(body.id), action);
    if (result.error || !result.ticket) return { status: result.status, body: { error: result.error } };
    return { status: 200, body: { ticket: result.ticket, balance: result.balance } };
  }

  return null;
}
