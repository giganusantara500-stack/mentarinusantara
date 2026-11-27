import { billIsPaid, callbackRef, digiflazzReady, inquireDigiflazz, newRefId, payDigiflazz, productKind, resolveBuyerSku, sameSecret, statusDigiflazz, type DigiKind, type DigiQuote } from "./digiflazz";
import { findCatalogItem, foldLabel } from "../src/lib/billerCatalog";
import { recordLoketSale, walletBalance, type LedgerEnv } from "./ledger";

export type BillerMode = "simulation" | "h2h";
export type PaymentStatus = "simulated" | "pending" | "success" | "failed" | "refunded";

export interface BillQuote {
  customerName: string;
  period: string;
  amount: number;
  denda: number;
  adminFee: number;
  collfee: number;
  total: number;
  providerCost: number;
}

interface InquiryInput {
  category: string;
  product: string;
  customerNumber: string;
  adminFee: number;
  months?: string;
  taxYear?: string;
  buyerSkuCode?: string;
  kind?: string;
  refId?: string;
}

interface PayInput extends InquiryInput {
  clientRef: string;
  customerName?: string;
  amount?: number;
  tagihan?: number;
  denda?: number;
  collfee?: number;
  period?: string;
  providerCost?: number;
  loketName?: string;
  loketCode?: string;
  parentId?: string;
  providerRef?: string;
  outcome?: "pending" | "success" | "failed" | "refund";
}

interface ProviderResult {
  outcome: "pending" | "success" | "failed";
  providerRef?: string;
  message?: string;
  bill?: BillQuote;
  sn?: string;
}

interface BillerProvider {
  inquire(input: InquiryInput): Promise<{ status: "found" | "not_found" | "unavailable" | "paid"; message?: string; bill?: BillQuote; providerRef?: string; buyerSkuCode?: string }>;
  submit(input: InquiryInput & { clientRef: string; bill: BillQuote; providerRef?: string }): Promise<ProviderResult>;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function simulationBill(input: InquiryInput): BillQuote | null {
  const digits = input.customerNumber.replace(/\D/g, "");
  if (digits.length < 5) return null;
  const prepaid = input.product.match(/Prepaid\s+(\d+)/i);
  const fixed = prepaid ? Number(prepaid[1]) * 1000 : null;
  const tail = Number(digits.slice(-5)) || 10000;
  const amount = fixed ?? (15000 + (tail % 250000));
  const denda = fixed ? 0 : (tail % 9 === 0 ? 2000 : 0);
  const months = input.category === "BPJS" ? Math.max(1, Number(input.months) || 1) : 1;
  const billAmount = amount * months;
  const billFine = denda * months;
  const period = input.category === "BPJS"
    ? `${String(months).padStart(2, "0")} Bulan`
    : input.category === "Pajak PBB" && input.taxYear
      ? input.taxYear
      : new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return {
    customerName: `Pelanggan ${digits.slice(-4)}`,
    period,
    amount: billAmount,
    denda: billFine,
    adminFee: input.adminFee,
    collfee: 0,
    total: billAmount + billFine + input.adminFee,
    providerCost: billAmount + billFine,
  };
}

const simulationProvider: BillerProvider = {
  async inquire(input) {
    const bill = simulationBill(input);
    if (!bill) return { status: "not_found", message: "Nomor minimal 5 digit." };
    return { status: "found", bill, providerRef: `sim-${input.customerNumber}` };
  },
  async submit() {
    return { outcome: "success", message: "Simulasi tidak memanggil penyedia biller." };
  },
};

function billFromQuote(quote: DigiQuote, adminFee: number): BillQuote {
  const fee = quote.adminFee > 0 ? quote.adminFee : adminFee;
  const summed = quote.amount + quote.denda + fee;
  const total = quote.adminFee > 0 ? (quote.total || summed) : summed;
  return {
    customerName: quote.customerName,
    period: quote.period,
    amount: quote.amount,
    denda: quote.denda,
    adminFee: fee,
    collfee: 0,
    total: total || quote.total || summed,
    providerCost: quote.providerCost > 0 ? quote.providerCost : Math.max(0, quote.amount + quote.denda),
  };
}

const h2hProvider: BillerProvider = {
  async inquire(input) {
    if (!digiflazzReady()) return { status: "unavailable", message: "Username atau API key DigiFlazz belum diisi di server VPS. Saldo tidak berubah." };
    const kind = productKind(input.category, input.product, clean(input.kind));
    const sku = await resolveBuyerSku(kind, input.category, input.product, clean(input.buyerSkuCode));
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(sku)) return { status: "unavailable", message: "Produk ini belum tersedia untuk pembayaran." };
    if (input.customerNumber.trim().length < 4) return { status: "not_found", message: "Nomor pelanggan terlalu pendek." };
    const refId = clean(input.refId) || newRefId();
    try {
      const quote = await inquireDigiflazz({
        kind,
        sku,
        customerNumber: input.customerNumber,
        refId,
        category: input.category,
        product: input.product,
      });
      if (billIsPaid(quote.message)) return { status: "paid", message: quote.message || "Tagihan sudah lunas.", providerRef: quote.refId, buyerSkuCode: quote.sku || sku, bill: billFromQuote(quote, input.adminFee) };
      if (quote.outcome === "not_found") return { status: "not_found", message: quote.message || "Tagihan tidak ditemukan di DigiFlazz." };
      if (quote.outcome === "failed") return { status: "unavailable", message: quote.message || "DigiFlazz menolak pengecekan." };
      if (quote.total < 1000 && quote.amount < 1000) return { status: "unavailable", message: "Harga DigiFlazz belum tersedia untuk kode produk ini." };
      return { status: "found", providerRef: quote.refId, buyerSkuCode: quote.sku || sku, bill: billFromQuote(quote, input.adminFee) };
    } catch {
      return { status: "unavailable", message: "DigiFlazz tidak dapat dihubungi dari VPS. Saldo tidak berubah." };
    }
  },
  async submit(input) {
    if (!digiflazzReady()) return { outcome: "failed", message: "Username atau API key DigiFlazz belum diisi di server VPS." };
    try {
      const quote = await payDigiflazz({
        kind: productKind(input.category, input.product, clean(input.kind)),
        sku: clean(input.buyerSkuCode),
        customerNumber: input.customerNumber,
        refId: clean(input.providerRef) || input.clientRef,
      });
      if (quote.outcome === "success" || quote.outcome === "pending" || quote.outcome === "failed") {
        return { outcome: quote.outcome === "not_found" ? "failed" : quote.outcome, providerRef: quote.refId, message: quote.message, bill: billFromQuote(quote, input.adminFee), sn: quote.sn };
      }
      return { outcome: "failed", message: quote.message || "Jawaban DigiFlazz tidak dikenali. Saldo tidak dipotong." };
    } catch {
      return { outcome: "pending", message: "Jawaban DigiFlazz tertunda. Saldo belum dipotong sampai status berhasil." };
    }
  },
};

function providerFor(mode: BillerMode) {
  return mode === "h2h" ? h2hProvider : simulationProvider;
}

export function requestedMode(value: unknown): BillerMode {
  return value === "production" || value === "h2h" || value === "digiflazz" ? "h2h" : "simulation";
}

export async function inquireBill(mode: BillerMode, input: InquiryInput) {
  return providerFor(mode).inquire(input);
}

export async function runBillerPayment(env: LedgerEnv, actorId: string, mode: BillerMode, input: PayInput) {
  if (mode === "simulation") {
    const quote = simulationBill({ ...input, customerNumber: input.customerNumber });
    const amount = Number(input.amount) || quote?.total || 0;
    const result = await recordLoketSale(env, actorId, {
      ...input,
      amount,
      tagihan: Number(input.tagihan) || quote?.amount || 0,
      denda: Number(input.denda) || quote?.denda || 0,
      adminFee: input.adminFee,
      collfee: Number(input.collfee) || 0,
      period: input.period || quote?.period || "",
      customerName: input.customerName || quote?.customerName || "Pelanggan",
      channel: "simulation",
      outcome: "success",
    });
    return { ...result, paymentStatus: "simulated" as PaymentStatus, mode };
  }

  if (input.outcome === "refund") {
    return { error: "Pengembalian saldo hanya dicatat setelah penyedia menyatakan transaksi berhasil.", status: 409, balance: await walletBalance(env, actorId), paymentStatus: "failed" as PaymentStatus, mode };
  }

  const kind = productKind(input.category, input.product, clean(input.kind));
  const sku = await resolveBuyerSku(kind, input.category, input.product, clean(input.buyerSkuCode));
  const refId = clean(input.providerRef) || input.clientRef;
  const inquiry = input.providerRef
    ? { status: "found" as const, message: "", providerRef: refId, bill: { customerName: input.customerName || "", period: input.period || "", amount: Number(input.tagihan) || Number(input.amount) || 0, denda: Number(input.denda) || 0, adminFee: input.adminFee, collfee: Number(input.collfee) || 0, total: Number(input.amount) || 0, providerCost: Number(input.providerCost) || 0 } }
    : await h2hProvider.inquire({ ...input, refId });
  if (inquiry.status !== "found" || !inquiry.bill || inquiry.bill.total < 1000) {
    const balance = await walletBalance(env, actorId);
    return { error: inquiry.message || "Tagihan tidak dapat dicek.", status: inquiry.status === "not_found" ? 404 : 409, balance, paymentStatus: "failed" as PaymentStatus, mode };
  }
  const pending = await recordLoketSale(env, actorId, {
    ...input,
    amount: inquiry.bill.total,
    tagihan: inquiry.bill.amount,
    denda: inquiry.bill.denda,
    adminFee: inquiry.bill.adminFee,
    collfee: inquiry.bill.collfee,
    period: inquiry.bill.period,
    customerName: inquiry.bill.customerName,
    providerCost: inquiry.bill.providerCost,
    channel: "production",
    outcome: "pending",
    clientRef: refId,
  });
  if (pending.error || !pending.sale) return { ...pending, error: pending.error || "Transaksi tidak dapat dimulai.", paymentStatus: "failed" as PaymentStatus, mode };
  const claimed = await claimDigiflazz(env, pending.sale.id, { buyerSkuCode: sku, kind, customerNumber: input.customerNumber, refId });
  if (!claimed) {
    const balance = pending.balance ?? await walletBalance(env, actorId);
    return { error: "Transaksi ini sedang diproses. Cek status sebelum mengulang.", status: 409, balance, sale: pending.sale, paymentStatus: "pending" as PaymentStatus, mode, providerRef: refId };
  }
  const submitted = await h2hProvider.submit({ ...input, buyerSkuCode: sku, kind, bill: inquiry.bill, providerRef: refId, clientRef: refId });
  const charged = submitted.bill && submitted.bill.total >= 1000 ? submitted.bill : inquiry.bill;
  const settled = await recordLoketSale(env, actorId, {
    ...input,
    amount: charged.total,
    tagihan: charged.amount,
    denda: charged.denda,
    adminFee: charged.adminFee,
    collfee: charged.collfee,
    period: charged.period || inquiry.bill.period,
    customerName: charged.customerName || inquiry.bill.customerName,
    providerCost: charged.providerCost || inquiry.bill.providerCost,
    channel: "production",
    outcome: submitted.outcome === "pending" ? "pending" : submitted.outcome,
    clientRef: refId,
  });
  if (submitted.sn && settled.sale) await rememberDigiflazz(env, settled.sale.id, { buyerSkuCode: sku, kind, customerNumber: input.customerNumber, refId, sn: submitted.sn }).catch(() => undefined);
  return { ...settled, error: settled.error || (submitted.outcome === "failed" ? submitted.message : undefined), paymentStatus: submitted.outcome, mode, providerRef: refId };
}

export async function handleBillerRequest(method: string, pathname: string, body: Record<string, unknown>, actorId: string, env: LedgerEnv) {
  if (pathname === "/api/biller/inquiry" && method === "POST") {
    const mode = requestedMode(body.mode ?? body.channel);
    const result = await inquireBill(mode, {
      category: clean(body.category),
      product: clean(body.product),
      customerNumber: clean(body.customerNumber),
      adminFee: Number(body.adminFee) || 0,
      months: clean(body.months),
      taxYear: clean(body.taxYear),
      buyerSkuCode: clean(body.buyerSkuCode),
      kind: clean(body.kind),
      refId: clean(body.refId),
    });
    if (result.status === "paid") return { status: 200, body: { mode, statusText: "paid", message: result.message, bill: result.bill, providerRef: result.providerRef, buyerSkuCode: result.buyerSkuCode } };
    if (result.status !== "found") return { status: result.status === "not_found" ? 404 : 409, body: { error: result.message, mode, statusText: result.status } };
    return { status: 200, body: { mode, statusText: "found", bill: result.bill, providerRef: result.providerRef, buyerSkuCode: result.buyerSkuCode } };
  }
  if (pathname === "/api/biller/inquiry-batch" && method === "POST") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
    if (items.length === 0) return { status: 400, body: { error: "Daftar nomor pelanggan kosong." } };
    const results = await mapPool(items, 4, async (item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const key = clean(record.key);
      const menu = menuForCollective(clean(record.category), clean(record.product));
      const customerNumber = clean(record.customerNumber);
      if (!menu) return { key, customerNumber, statusText: "failed", message: "Produk kolektif belum terpetakan ke DigiFlazz." };
      const result = await inquireBill("h2h", { category: menu.category, product: menu.product, customerNumber, adminFee: Number(record.adminFee) || 0 });
      return {
        key,
        customerNumber,
        category: menu.category,
        product: menu.product,
        statusText: result.status,
        message: result.message || "",
        bill: result.bill,
        providerRef: result.providerRef,
        buyerSkuCode: result.buyerSkuCode,
      };
    });
    return { status: 200, body: { results } };
  }
  if (pathname === "/api/biller/pay" && method === "POST") {
    const mode = requestedMode(body.mode ?? body.channel);
    const result = await runBillerPayment(env, actorId, mode, {
      clientRef: clean(body.clientRef),
      category: clean(body.category),
      product: clean(body.product),
      customerNumber: clean(body.customerNumber),
      customerName: clean(body.customerName),
      adminFee: Number(body.adminFee) || 0,
      amount: Number(body.amount) || 0,
      tagihan: Number(body.tagihan) || 0,
      denda: Number(body.denda) || 0,
      collfee: Number(body.collfee) || 0,
      period: clean(body.period),
      months: clean(body.months),
      taxYear: clean(body.taxYear),
      loketName: clean(body.loketName),
      loketCode: clean(body.loketCode),
      parentId: clean(body.parentId),
      buyerSkuCode: clean(body.buyerSkuCode),
      kind: clean(body.kind),
      providerRef: clean(body.providerRef),
    });
    if (result.error || !("sale" in result) || !result.sale) return { status: result.status, body: { error: result.error, mode, statusText: result.paymentStatus } };
    return { status: 200, body: { sale: result.sale, balance: result.balance, mode, statusText: result.paymentStatus, providerRef: "providerRef" in result ? result.providerRef : undefined } };
  }
  if (pathname === "/api/biller/status" && method === "POST") {
    const key = clean(body.clientRef) || clean(body.saleId) || clean(body.refId);
    const row = await findDigiflazzSale(env, key, actorId);
    if (!row) return { status: 404, body: { error: "Transaksi DigiFlazz tidak ditemukan." } };
    if (row.status === "success" || row.status === "failed" || row.status === "refunded") {
      return { status: 200, body: { statusText: row.status, duplicate: true } };
    }
    return applyDigiflazzStatus(env, row);
  }
  return null;
}

interface StoredDigiSale {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  idempotency_key: string;
  customer_number: string;
  product_name_snapshot: string;
  category_slug_snapshot: string;
  customer_name: string | null;
  provider_response: { buyerSkuCode?: string; kind?: DigiKind; customerNumber?: string; refId?: string; sn?: string } | null;
}

function menuForCollective(category: string, product: string) {
  const direct = findCatalogItem(category, product) || findCatalogItem(product, category);
  if (direct) return { category: direct.category, product: direct.label };
  const key = foldLabel(`${category} ${product}`);
  if (key.includes("pln")) return { category: "PLN", product: "Pascabayar" };
  if (key.includes("bpjs")) return { category: "BPJS", product: "BPJS Kesehatan" };
  if (key.includes("telkom") || key.includes("pstn")) return { category: "Internet", product: "Telkom" };
  if (key.includes("gas") || key.includes("pertagas") || key.includes("pgn")) return { category: "Gas", product: "Pertagas 20.000" };
  if (key.includes("pdam")) {
    const area = findCatalogItem("PDAM", product) || findCatalogItem("PDAM", category);
    return area ? { category: "PDAM", product: area.label } : null;
  }
  return null;
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function claimDigiflazz(env: LedgerEnv, id: string, meta: { buyerSkuCode: string; kind: DigiKind; customerNumber: string; refId: string }) {
  if (!env.supabaseUrl || !env.serviceRoleKey || !id) return false;
  const response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?id=eq.${encodeURIComponent(id)}&provider_response=is.null`, {
    method: "PATCH",
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ provider_reference: meta.refId, provider_response: meta }),
  });
  const rows = await response.json().catch(() => null);
  return response.ok && Array.isArray(rows) && rows.length > 0;
}

async function rememberDigiflazz(env: LedgerEnv, id: string, meta: { buyerSkuCode: string; kind: DigiKind; customerNumber: string; refId: string; sn?: string }) {
  if (!env.supabaseUrl || !env.serviceRoleKey || !id) return;
  await fetch(`${env.supabaseUrl}/rest/v1/transactions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ provider_reference: meta.sn || meta.refId, provider_response: meta }),
  });
}

async function findDigiflazzSale(env: LedgerEnv, key: string, actorId = "") {
  if (!env.supabaseUrl || !env.serviceRoleKey || !/^[A-Za-z0-9._:-]{8,64}$/.test(key)) return null;
  const actor = actorId ? `&user_id=eq.${encodeURIComponent(actorId)}` : "";
  const response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?or=(id.eq.${encodeURIComponent(key)},idempotency_key.eq.${encodeURIComponent(key)})${actor}&select=id,user_id,status,amount,idempotency_key,customer_number,product_name_snapshot,category_slug_snapshot,customer_name,provider_response&limit=1`, {
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
  });
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] as StoredDigiSale : null;
}

async function applyDigiflazzStatus(env: LedgerEnv, row: StoredDigiSale) {
  const meta = row.provider_response ?? {};
  const sku = clean(meta.buyerSkuCode);
  const refId = clean(row.idempotency_key);
  const customerNumber = clean(meta.customerNumber) || clean(row.customer_number);
  const kind: DigiKind = meta.kind === "prepaid" ? "prepaid" : "postpaid";
  if (!sku || !refId) return { status: 409, body: { error: "Data DigiFlazz transaksi ini belum lengkap." } };
  const quote = await statusDigiflazz({ kind, sku, customerNumber, refId });
  if (quote.outcome === "pending" || quote.outcome === "not_found") {
    return { status: 200, body: { statusText: "pending", message: quote.message } };
  }
  const amount = quote.total >= 1000 ? quote.total : Number(row.amount);
  const settled = await recordLoketSale(env, row.user_id, {
    category: row.category_slug_snapshot,
    product: row.product_name_snapshot,
    customerNumber,
    customerName: quote.customerName || row.customer_name || "",
    amount,
    channel: "production",
    outcome: quote.outcome,
    clientRef: refId,
  });
  if (quote.sn) await rememberDigiflazz(env, row.id, { buyerSkuCode: sku, kind, customerNumber, refId, sn: quote.sn }).catch(() => undefined);
  if (settled.error) return { status: settled.status, body: { error: settled.error, statusText: quote.outcome } };
  return { status: 200, body: { sale: settled.sale, balance: settled.balance, statusText: quote.outcome, message: quote.message } };
}

export async function handleDigiflazzCallback(method: string, pathname: string, body: Record<string, unknown>, headerSecret: string, env: LedgerEnv) {
  if (method !== "POST") return { status: 405, body: { error: "Metode tidak didukung." } };
  const expected = (process.env.DIGIFLAZZ_CALLBACK_SECRET || "").trim();
  const pathSecret = pathname.startsWith("/api/digiflazz/callback/") ? decodeURIComponent(pathname.slice("/api/digiflazz/callback/".length)) : "";
  if (!expected || !sameSecret(headerSecret || pathSecret, expected)) return { status: 401, body: { error: "Callback DigiFlazz ditolak." } };
  const refId = callbackRef(body);
  if (!refId) return { status: 400, body: { error: "Callback tanpa ref_id." } };
  const row = await findDigiflazzSale(env, refId);
  if (!row) return { status: 404, body: { error: "Transaksi callback belum tercatat." } };
  if (row.status === "success" || row.status === "failed" || row.status === "refunded") {
    return { status: 200, body: { ok: true, duplicate: true, statusText: row.status } };
  }
  try {
    return await applyDigiflazzStatus(env, row);
  } catch {
    return { status: 502, body: { error: "Status DigiFlazz belum dapat dipastikan. Saldo tidak diubah." } };
  }
}
