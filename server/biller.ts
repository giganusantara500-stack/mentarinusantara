import { billIsPaid, callbackRef, digiflazzReady, inquireDigiflazz, newRefId, payDigiflazz, productKind, resolveBuyerSku, sameSecret, statusDigiflazz, type DigiKind, type DigiQuote } from "./digiflazz";
import { findCatalogItem, foldLabel } from "../src/lib/billerCatalog";
import { listNetworkSales, listSimulations, recordLoketSale, walletBalance, type LedgerEnv, type LoketSale } from "./ledger";
import { ownerCollectives } from "./ops";

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
  lines?: { period: string; amount: number | null; denda: number | null }[];
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

function plainCustomerName(value: string) {
  const name = value.trim();
  if (!name || name.includes("*") || /^pelanggan(\s+\d+)?$/i.test(name)) return "";
  return name;
}

function sentCustomerName(value: string) {
  const name = value.trim();
  if (!name || /^pelanggan(\s+\d+)?$/i.test(name)) return "";
  return name;
}

export function resolvedCustomerName(providerName: string, remembered: string) {
  return sentCustomerName(providerName) || plainCustomerName(remembered) || sentCustomerName(remembered) || providerName.trim();
}

function customerIdKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sameCustomerId(left: string, right: string) {
  const a = customerIdKey(left);
  const b = customerIdKey(right);
  return a.length >= 4 && a === b;
}

function recordText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  }
  return "";
}

export function rememberedCustomerName(
  customerNumber: string,
  sales: { customerNumber?: string; customerName?: string }[],
  groups: { members?: { number?: string; name?: string }[]; bills?: { number?: string; name?: string }[] }[],
) {
  for (const sale of sales) {
    const record = sale as Record<string, unknown>;
    const number = String(sale.customerNumber || recordText(record, ["customer_number", "customerId", "number"]));
    if (!sameCustomerId(number, customerNumber)) continue;
    const name = plainCustomerName(String(sale.customerName || recordText(record, ["customer_name", "nama", "name"])));
    if (name) return name;
  }
  for (const group of groups) {
    for (const row of [...(group.members ?? []), ...(group.bills ?? [])]) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const number = recordText(record, ["number", "customerNumber", "customer_number", "customerId", "custId", "idpel", "no"]);
      if (!sameCustomerId(number, customerNumber)) continue;
      const name = plainCustomerName(recordText(record, ["name", "customerName", "customer_name", "nama"]));
      if (name) return name;
    }
  }
  return "";
}

async function nameDirectory(env: LedgerEnv, actorId: string) {
  const [sales, simulations, groups] = await Promise.all([
    listNetworkSales(env, actorId).catch(() => []),
    listSimulations(env, actorId).catch(() => []),
    ownerCollectives(env, actorId).catch(() => []),
  ]);
  return { sales: [...sales, ...simulations], groups };
}

function withRememberedName<T extends { customerName: string }>(bill: T, customerNumber: string, directory: Awaited<ReturnType<typeof nameDirectory>>) {
  const next = resolvedCustomerName(bill.customerName, rememberedCustomerName(customerNumber, directory.sales, directory.groups));
  return next === bill.customerName ? bill : { ...bill, customerName: next };
}

function noteInquiryName(customerNumber: string, providerName: string, kept: string) {
  const tail = customerNumber.replace(/\D/g, "").slice(-4) || "----";
  if (sentCustomerName(providerName)) {
    const masked = providerName.includes("*") ? "bertanda bintang, dipertahankan apa adanya" : "utuh dari provider";
    console.log(`[nama-inquiry] id···${tail} nama ${masked}: "${providerName}". Riwayat dan kolektif tidak menimpa. Tagihan per periode tidak diubah.`);
    return;
  }
  console.log(kept
    ? `[nama-inquiry] id···${tail} provider tidak mengirim nama. Dipakai nama tersimpan "${kept}".`
    : `[nama-inquiry] id···${tail} provider tidak mengirim nama dan tidak ada nama tersimpan.`);
}

function settledProviderCost(quoted: number, known: number, sell: number) {
  const price = Number.isFinite(quoted) ? Math.round(quoted) : 0;
  const listed = Number.isFinite(known) ? Math.round(known) : 0;
  const amount = Number.isFinite(sell) ? Math.max(0, Math.round(sell)) : 0;
  if (price > 0 && (amount <= 0 || price <= amount)) return price;
  if (listed > 0 && (amount <= 0 || listed <= amount)) return listed;
  if (amount > 0 && listed > 0) return Math.min(listed, amount);
  return 0;
}

function billFromQuote(quote: DigiQuote, adminFee: number): BillQuote {
  const chosen = adminFee > 0;
  const fee = chosen ? adminFee : quote.adminFee;
  const summed = quote.amount + quote.denda + fee;
  const total = chosen ? summed : (quote.adminFee > 0 ? (quote.total || summed) : summed);
  return {
    customerName: quote.customerName,
    period: quote.period,
    amount: quote.amount,
    denda: quote.denda,
    adminFee: fee,
    collfee: 0,
    total: total || summed,
    providerCost: quote.providerCost > 0 ? quote.providerCost : Math.max(0, quote.amount + quote.denda),
    lines: quote.lines ?? [],
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
      const tail = input.customerNumber.replace(/\D/g, "").slice(-4) || "----";
      const finish = (status: "found" | "not_found" | "unavailable" | "paid", message: string) => {
        console.log(`[inquiry] ${kind} ${sku} id···${tail} ${status} ${message.replace(/\s+/g, " ").slice(0, 160)}`);
        return { status, message } as { status: "found" | "not_found" | "unavailable" | "paid"; message: string };
      };
      if (billIsPaid(quote.message)) return { ...finish("paid", quote.message || "Tagihan sudah lunas."), providerRef: quote.refId, buyerSkuCode: quote.sku || sku, bill: billFromQuote(quote, input.adminFee) };
      if (quote.outcome === "not_found") return { ...finish("not_found", quote.message || "Tidak ada tagihan."), providerRef: quote.refId, buyerSkuCode: quote.sku || sku };
      if (quote.outcome === "failed") return finish("unavailable", quote.message || "DigiFlazz menolak pengecekan.");
      if (quote.total < 1000 && quote.amount < 1000) return finish("unavailable", quote.message || "Harga DigiFlazz belum tersedia untuk kode produk ini.");
      return { ...finish("found", quote.message || "Tagihan ditemukan."), providerRef: quote.refId, buyerSkuCode: quote.sku || sku, bill: billFromQuote(quote, input.adminFee) };
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
        return { outcome: quote.outcome, providerRef: quote.refId, message: quote.message, bill: billFromQuote(quote, input.adminFee), sn: quote.sn };
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
  let customerName = resolvedCustomerName(inquiry.bill.customerName, input.customerName || "");
  if (!sentCustomerName(customerName)) {
    const directory = await nameDirectory(env, actorId);
    customerName = resolvedCustomerName(customerName, rememberedCustomerName(input.customerNumber, directory.sales, directory.groups));
  }
  const receipt: DigiMeta = {
    buyerSkuCode: sku,
    kind,
    customerNumber: input.customerNumber,
    refId,
    adminFee: inquiry.bill.adminFee,
    tagihan: inquiry.bill.amount,
    denda: inquiry.bill.denda,
    collfee: inquiry.bill.collfee,
    period: inquiry.bill.period,
    providerCost: inquiry.bill.providerCost,
    customerName,
  };
  const pending = await recordLoketSale(env, actorId, {
    ...input,
    amount: inquiry.bill.total,
    tagihan: inquiry.bill.amount,
    denda: inquiry.bill.denda,
    adminFee: inquiry.bill.adminFee,
    collfee: inquiry.bill.collfee,
    period: inquiry.bill.period,
    customerName,
    providerCost: inquiry.bill.providerCost,
    channel: "production",
    outcome: "pending",
    clientRef: refId,
  });
  if (pending.error || !pending.sale) return { ...pending, error: pending.error || "Transaksi tidak dapat dimulai.", paymentStatus: "failed" as PaymentStatus, mode };
  const already = pending.sale.status;
  if (already === "success" || already === "failed" || already === "refunded" || already === "simulated") {
    return {
      ...pending,
      balance: pending.balance ?? await walletBalance(env, actorId),
      paymentStatus: already,
      mode,
      providerRef: refId,
      sn: pending.sale.sn || "",
    };
  }
  const claimed = await claimDigiflazz(env, pending.sale.id, receipt);
  if (!claimed) {
    const balance = pending.balance ?? await walletBalance(env, actorId);
    return { error: "Transaksi ini sedang diproses. Cek status sebelum mengulang.", status: 409, balance, sale: pending.sale, paymentStatus: "pending" as PaymentStatus, mode, providerRef: refId };
  }
  const submitted = await h2hProvider.submit({ ...input, buyerSkuCode: sku, kind, bill: inquiry.bill, providerRef: refId, clientRef: refId });
  const charged = submitted.bill && submitted.bill.total >= 1000 ? submitted.bill : inquiry.bill;
  const providerCost = settledProviderCost(charged.providerCost, inquiry.bill.providerCost, inquiry.bill.total);
  const outcome = submitted.outcome === "pending" ? "pending" : submitted.outcome;
  const settled = await recordLoketSale(env, actorId, {
    ...input,
    amount: inquiry.bill.total,
    tagihan: inquiry.bill.amount,
    denda: inquiry.bill.denda,
    adminFee: inquiry.bill.adminFee,
    collfee: inquiry.bill.collfee,
    period: inquiry.bill.period,
    customerName: resolvedCustomerName(charged.customerName, customerName),
    providerCost,
    channel: "production",
    outcome,
    clientRef: refId,
  });
  const sn = submitted.sn || receipt.sn || "";
  if (settled.sale) await rememberDigiflazz(env, settled.sale.id, { ...receipt, providerCost, customerName: resolvedCustomerName(charged.customerName, customerName), sn }).catch(() => undefined);
  const paymentStatus = settled.sale?.status === "success" || settled.sale?.status === "failed" || settled.sale?.status === "refunded" || settled.sale?.status === "pending"
    ? settled.sale.status
    : (settled.error ? "failed" : outcome);
  return {
    ...settled,
    sale: settled.sale ? { ...settled.sale, sn } : settled.sale,
    error: settled.error || (outcome === "failed" ? submitted.message : undefined),
    paymentStatus,
    mode,
    providerRef: refId,
    sn,
  };
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
    const customerNumber = clean(body.customerNumber);
    const providerName = result.bill?.customerName || "";
    const bill = result.bill && !sentCustomerName(providerName)
      ? withRememberedName(result.bill, customerNumber, await nameDirectory(env, actorId))
      : result.bill;
    if (result.bill) noteInquiryName(customerNumber, providerName, bill?.customerName || "");
    if (result.status === "paid") return { status: 200, body: { mode, statusText: "paid", message: result.message, bill, providerRef: result.providerRef, buyerSkuCode: result.buyerSkuCode } };
    if (result.status !== "found") return { status: result.status === "not_found" ? 404 : 409, body: { error: result.message, mode, statusText: result.status } };
    return { status: 200, body: { mode, statusText: "found", bill, providerRef: result.providerRef, buyerSkuCode: result.buyerSkuCode } };
  }
  if (pathname === "/api/biller/inquiry-batch" && method === "POST") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
    if (items.length === 0) return { status: 400, body: { error: "Daftar nomor pelanggan kosong." } };
    const directoryPromise = nameDirectory(env, actorId);
    const results = await mapPool(items, 4, async (item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const key = clean(record.key);
      const menu = menuForCollective(clean(record.category), clean(record.product));
      const customerNumber = clean(record.customerNumber);
      if (!menu) return { key, customerNumber, statusText: "failed", message: "Produk kolektif belum terpetakan ke DigiFlazz." };
      const result = await inquireBill("h2h", { category: menu.category, product: menu.product, customerNumber, adminFee: Number(record.adminFee) || 0 });
      const directory = await directoryPromise;
      const providerName = result.bill?.customerName || "";
      const bill = result.bill && !sentCustomerName(providerName) ? withRememberedName(result.bill, customerNumber, directory) : result.bill;
      if (result.bill) noteInquiryName(customerNumber, providerName, bill?.customerName || "");
      return {
        key,
        customerNumber,
        category: menu.category,
        product: menu.product,
        statusText: result.status,
        message: result.message || "",
        bill,
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
      return { status: 200, body: { statusText: row.status, balance: await walletBalance(env, actorId), duplicate: true, sale: saleFromRow(row) } };
    }
    return applyDigiflazzStatus(env, row);
  }
  return null;
}

interface DigiMeta {
  buyerSkuCode?: string;
  kind?: DigiKind;
  customerNumber?: string;
  refId?: string;
  sn?: string;
  adminFee?: number;
  tagihan?: number;
  denda?: number;
  collfee?: number;
  period?: string;
  providerCost?: number;
  customerName?: string;
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
  provider_response: DigiMeta | null;
}

function menuForCollective(category: string, product: string) {
  const direct = findCatalogItem(category, product) || findCatalogItem(product, category);
  if (direct) return { category: direct.category, product: direct.label };
  const key = foldLabel(`${category} ${product}`);
  if (key.includes("pln")) return { category: "PLN", product: "Postpaid" };
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

function saleFromRow(row: StoredDigiSale) {
  const meta = row.provider_response ?? {};
  return {
    id: row.id,
    customerNumber: row.customer_number,
    customerName: meta.customerName || row.customer_name || "",
    product: row.product_name_snapshot,
    category: row.category_slug_snapshot,
    amount: Number(row.amount) || 0,
    tagihan: Number(meta.tagihan) || 0,
    denda: Number(meta.denda) || 0,
    adminFee: Number(meta.adminFee) || 0,
    collfee: Number(meta.collfee) || 0,
    period: meta.period || "",
    providerCost: Number(meta.providerCost) || 0,
    sn: meta.sn || "",
    clientRef: row.idempotency_key,
    status: row.status,
  };
}

async function claimDigiflazz(env: LedgerEnv, id: string, meta: DigiMeta) {
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

async function rememberDigiflazz(env: LedgerEnv, id: string, meta: DigiMeta) {
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
  const balanceNow = await walletBalance(env, row.user_id);
  if (!sku || !refId) return { status: 409, body: { error: "Data DigiFlazz transaksi ini belum lengkap.", balance: balanceNow, statusText: row.status } };
  const quote = await statusDigiflazz({ kind, sku, customerNumber, refId });
  if (quote.outcome === "pending" || (quote.outcome === "not_found" && !/gagal|ditolak|invalid|salah/.test(quote.message.toLowerCase()))) {
    return { status: 200, body: { statusText: "pending", message: quote.message || "Pembayaran masih diproses. Saldo belum dipotong.", balance: balanceNow } };
  }
  const outcome = quote.outcome === "success" ? "success" : "failed";
  const storedCost = Number(meta.providerCost) || 0;
  const amount = Number(row.amount) >= 1000 ? Number(row.amount) : (quote.total >= 1000 ? quote.total : Number(row.amount));
  const providerCost = settledProviderCost(quote.providerCost, storedCost, amount);
  const settled = await recordLoketSale(env, row.user_id, {
    category: row.category_slug_snapshot,
    product: row.product_name_snapshot,
    customerNumber,
    customerName: resolvedCustomerName(quote.customerName, meta.customerName || row.customer_name || ""),
    amount,
    tagihan: Number(meta.tagihan) || quote.amount || 0,
    denda: Number(meta.denda) || quote.denda || 0,
    adminFee: Number(meta.adminFee) || quote.adminFee || 0,
    collfee: Number(meta.collfee) || 0,
    period: meta.period || quote.period || "",
    providerCost,
    channel: "production",
    outcome,
    clientRef: refId,
  });
  await rememberDigiflazz(env, row.id, {
    ...meta,
    buyerSkuCode: sku,
    kind,
    customerNumber,
    refId,
    sn: quote.sn || meta.sn || "",
    providerCost,
    customerName: resolvedCustomerName(quote.customerName, meta.customerName || row.customer_name || ""),
  }).catch(() => undefined);
  const sn = quote.sn || meta.sn || "";
  const sale = settled.sale ? { ...settled.sale, sn } : undefined;
  const balance = Number.isFinite(Number(settled.balance)) ? Number(settled.balance) : balanceNow;
  if (settled.error) return { status: settled.status, body: { error: settled.error, statusText: outcome, balance, sale } };
  return { status: 200, body: { sale, balance, statusText: outcome, message: quote.message } };
}

export async function attachSaleReceipts(env: LedgerEnv, sales: LoketSale[]) {
  if (!env.supabaseUrl || !env.serviceRoleKey || sales.length === 0) return sales;
  const ids = sales.map((sale) => sale.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return sales;
  const details = new Map<string, { profit?: number; cost_price?: number; sell_price?: number; provider_reference?: string; provider_response?: DigiMeta | null; idempotency_key?: string }>();
  for (let index = 0; index < ids.length; index += 80) {
    const slice = ids.slice(index, index + 80);
    const response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?id=in.(${slice.join(",")})&select=id,profit,cost_price,sell_price,provider_reference,provider_response,idempotency_key`, {
      headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
    });
    const rows = await response.json().catch(() => null);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && typeof row === "object" && typeof row.id === "string") details.set(row.id, row);
    }
  }
  return sales.map((sale) => {
    const row = details.get(sale.id);
    if (!row) return sale;
    const meta = row.provider_response ?? {};
    const profit = Number(row.profit) || 0;
    const providerCost = Number(meta.providerCost) || Number(row.cost_price) || 0;
    return {
      ...sale,
      customerName: sale.customerName || meta.customerName || "",
      tagihan: Number(sale.tagihan) || Number(meta.tagihan) || 0,
      denda: Number(sale.denda) || Number(meta.denda) || 0,
      adminFee: Number(sale.adminFee) || Number(meta.adminFee) || 0,
      collfee: Number(sale.collfee) || Number(meta.collfee) || 0,
      period: sale.period || meta.period || "",
      sn: meta.sn || "",
      clientRef: row.idempotency_key || meta.refId || "",
      providerReference: row.provider_reference || meta.sn || meta.refId || "",
      profit,
      providerCost,
      sellPrice: Number(row.sell_price) || sale.amount,
    };
  });
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
