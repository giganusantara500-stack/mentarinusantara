import { billIsPaid, callbackKeys, digiflazzReady, displayToken, inquireDigiflazz, newRefId, payDigiflazz, productKind, quoteFrom, resolveBuyerSku, sameSecret, statusDigiflazz, type DigiKind, type DigiQuote } from "./digiflazz";
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
  if (already === "success" || already === "refunded" || already === "simulated") {
    const stored = await findDigiflazzSale(env, refId, actorId);
    const sn = displayToken(stored?.provider_response?.sn || "", pending.sale.sn || "");
    return {
      ...pending,
      balance: pending.balance ?? await walletBalance(env, actorId),
      paymentStatus: already,
      mode,
      providerRef: refId,
      sn,
      sale: pending.sale ? { ...pending.sale, sn } : pending.sale,
    };
  }
  if (already === "failed") {
    const stored = await findDigiflazzSale(env, refId, actorId);
    if (stored) return paymentFromStatus(await applyDigiflazzStatus(env, stored), mode, refId);
  }
  const claimed = await claimDigiflazz(env, pending.sale.id, receipt);
  const refTail = refId.replace(/[^a-z0-9]/gi, "").slice(-6) || "------";
  if (!claimed) {
    const stored = await findDigiflazzSale(env, refId, actorId);
    if (stored) {
      const applied = await applyDigiflazzStatus(env, stored);
      if (applied.body.statusText === "success" || applied.body.statusText === "failed") return paymentFromStatus(applied, mode, refId);
    }
    const balance = pending.balance ?? await walletBalance(env, actorId);
    return { error: "Transaksi ini sedang diproses. Cek status sebelum mengulang.", status: 409, balance, sale: pending.sale, paymentStatus: "pending" as PaymentStatus, mode, providerRef: refId };
  }
  console.log(`[bayar] kirim ${kind} ${sku} ref···${refTail}`);
  const submitted = await h2hProvider.submit({ ...input, buyerSkuCode: sku, kind, bill: inquiry.bill, providerRef: refId, clientRef: refId });
  console.log(`[bayar] provider ${submitted.outcome} ref···${refTail}`);
  const charged = submitted.bill && submitted.bill.total >= 1000 ? submitted.bill : inquiry.bill;
  const providerCost = settledProviderCost(charged.providerCost, inquiry.bill.providerCost, inquiry.bill.total);
  let outcome: "pending" | "success" | "failed" = submitted.outcome === "pending" ? "pending" : submitted.outcome;
  let providerSn = displayToken(submitted.sn || "");
  if (outcome !== "success") {
    try {
      const checked = await statusDigiflazz({ kind, sku, customerNumber: input.customerNumber, refId });
      const checkedSn = displayToken(checked.sn || "");
      if (checked.outcome === "success" || checkedSn) {
        outcome = "success";
        providerSn = checkedSn || providerSn;
      } else if (checked.outcome === "failed" && outcome === "failed") {
        outcome = "failed";
      } else {
        outcome = "pending";
      }
    } catch {
      if (outcome === "failed") outcome = "pending";
    }
  }
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
  const sn = providerSn || displayToken(receipt.sn || "");
  if (settled.sale) await rememberDigiflazz(env, settled.sale.id, { ...receipt, providerCost, customerName: resolvedCustomerName(charged.customerName, customerName), sn }).catch(() => undefined);
  const recorded = settled.sale?.status || "";
  if (outcome === "success" && recorded !== "success") {
    return {
      ...settled,
      sale: settled.sale ? { ...settled.sale, sn } : settled.sale,
      error: "DigiFlazz sudah Sukses, tetapi saldo loket belum terpotong. Jalankan migrasi terbaru, lalu tekan Sinkronkan.",
      status: 409,
      paymentStatus: recorded === "failed" || recorded === "pending" || recorded === "refunded" ? recorded : "pending",
      mode,
      providerRef: refId,
      sn,
    };
  }
  const paymentStatus = recorded === "success" || recorded === "failed" || recorded === "refunded" || recorded === "pending"
    ? recorded
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
    if (row.status === "success" || row.status === "refunded") {
      return { status: 200, body: { statusText: row.status, balance: await walletBalance(env, actorId), duplicate: true, sale: saleFromRow(row) } };
    }
    return applyDigiflazzStatus(env, row);
  }
  if (pathname === "/api/biller/sync" && method === "POST") {
    const changed = await syncPendingSales(env, actorId, true);
    const [listed, balance] = await Promise.all([
      listNetworkSales(env, actorId),
      walletBalance(env, actorId),
    ]);
    const sales = await attachSaleReceipts(env, listed).catch(() => listed);
    return { status: 200, body: { sales, balance, checked: changed } };
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
  client_ref?: string;
  customer_number: string;
  product_name_snapshot: string;
  category_slug_snapshot: string;
  customer_name: string | null;
  provider_response: DigiMeta | null;
}

function saleRef(row: { idempotency_key?: string; client_ref?: string }) {
  return clean(row.idempotency_key) || clean(row.client_ref);
}

function missingColumn(body: unknown, column: string) {
  if (!body || typeof body !== "object") return false;
  const record = body as { message?: string; code?: string; details?: string };
  const text = `${record.message || ""} ${record.details || ""} ${record.code || ""}`;
  return (record.code === "42703" || /does not exist/i.test(text)) && text.includes(column);
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
  const sn = displayToken(meta.sn || "") || meta.sn || "";
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
    sn,
    clientRef: saleRef(row),
    status: row.status,
  };
}

async function claimDigiflazz(env: LedgerEnv, id: string, meta: DigiMeta) {
  if (!env.supabaseUrl || !env.serviceRoleKey || !id) return false;
  try {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?id=eq.${encodeURIComponent(id)}&provider_response=is.null`, {
    method: "PATCH",
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ provider_reference: meta.refId, provider_response: meta }),
    signal: AbortSignal.timeout(12_000),
  });
  const rows = await response.json().catch(() => null);
  return response.ok && Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
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
    signal: AbortSignal.timeout(12_000),
  });
}

function refKey(value: string) {
  return /^[A-Za-z0-9._:-]{6,80}$/.test(value);
}

async function findDigiflazzSale(env: LedgerEnv, key: string, actorId = "") {
  if (!env.supabaseUrl || !env.serviceRoleKey || !refKey(key)) return null;
  const actor = actorId ? `&user_id=eq.${encodeURIComponent(actorId)}` : "";
  const encoded = encodeURIComponent(key);
  const base = "id,user_id,status,amount,customer_number,product_name_snapshot,category_slug_snapshot,customer_name,provider_response";
  const attempts = [
    { filter: `or=(id.eq.${encoded},idempotency_key.eq.${encoded})`, select: `${base},idempotency_key` },
    { filter: `or=(id.eq.${encoded},client_ref.eq.${encoded})`, select: `${base},client_ref` },
    { filter: `provider_reference=eq.${encoded}`, select: `${base},provider_reference` },
    { filter: `id=eq.${encoded}`, select: base },
  ];
  for (const attempt of attempts) {
    let response: Response;
    try {
      response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?${attempt.filter}${actor}&select=${attempt.select}&limit=1`, {
        headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (timedOut) throw new Error("Status pembayaran belum terbaca. Coba lagi. Saldo hanya terpotong bila status Sukses.");
      return null;
    }
    const rows = await response.json().catch(() => null);
    if (!response.ok) {
      if (missingColumn(rows, "idempotency_key") || missingColumn(rows, "client_ref") || missingColumn(rows, "provider_reference")) continue;
      return null;
    }
    const row = Array.isArray(rows) ? rows[0] as StoredDigiSale | undefined : undefined;
    if (!row) continue;
    return { ...row, idempotency_key: saleRef(row) || key };
  }
  return null;
}

function openProviderOutcome(quote: DigiQuote) {
  return quote.outcome === "pending" || (quote.outcome === "not_found" && !/gagal|ditolak|invalid|salah/.test(quote.message.toLowerCase()));
}

async function settleDigiflazzQuote(env: LedgerEnv, row: StoredDigiSale, quote: DigiQuote) {
  const meta = row.provider_response ?? {};
  const refId = saleRef(row) || clean(meta.refId) || quote.refId;
  const customerNumber = clean(meta.customerNumber) || clean(row.customer_number) || quote.customerNumber;
  const kind: DigiKind = meta.kind === "prepaid" || meta.kind === "postpaid" ? meta.kind : productKind(row.category_slug_snapshot, row.product_name_snapshot);
  const sku = clean(meta.buyerSkuCode) || quote.sku;
  const balanceNow = await walletBalance(env, row.user_id);
  const tail = refId.replace(/[^a-z0-9]/gi, "").slice(-6) || "------";
  if (openProviderOutcome(quote)) {
    console.log(`[bayar] sinkron pending ref···${tail}`);
    return { status: 200, body: { statusText: "pending", message: quote.message || "Pembayaran masih diproses. Saldo belum dipotong.", balance: balanceNow, sale: saleFromRow(row) } };
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
  const sn = displayToken(quote.sn || "", meta.sn || "") || quote.sn || meta.sn || "";
  await rememberDigiflazz(env, row.id, {
    ...meta,
    buyerSkuCode: sku,
    kind,
    customerNumber,
    refId,
    sn,
    providerCost,
    customerName: resolvedCustomerName(quote.customerName, meta.customerName || row.customer_name || ""),
  }).catch(() => undefined);
  const sale = settled.sale ? { ...settled.sale, sn, clientRef: settled.sale.clientRef || refId } : undefined;
  const balance = Number.isFinite(Number(settled.balance)) ? Number(settled.balance) : balanceNow;
  console.log(`[bayar] sinkron ${outcome} ref···${tail}${sn ? " sn=ada" : ""}`);
  const recorded = settled.sale?.status || "";
  if (outcome === "success" && recorded !== "success") {
    return { status: 409, body: { error: "DigiFlazz sudah Sukses, tetapi saldo loket belum terpotong. Jalankan migrasi terbaru, lalu tekan Sinkronkan.", statusText: recorded || row.status, balance, sale } };
  }
  if (settled.error) return { status: settled.status || 409, body: { error: settled.error, statusText: recorded || (row.status === "pending" ? "pending" : outcome), balance, sale } };
  return { status: 200, body: { sale, balance, statusText: recorded || outcome, message: quote.message } };
}

function paymentFromStatus(applied: { status: number; body: { error?: string; statusText?: string; balance?: number; sale?: { sn?: string } } }, mode: BillerMode, refId: string) {
  const statusText = applied.body.statusText || "pending";
  const sn = applied.body.sale?.sn || "";
  return {
    sale: applied.body.sale ? { ...applied.body.sale, sn } as LoketSale : undefined,
    balance: applied.body.balance,
    error: statusText === "success" || statusText === "pending" ? applied.body.error : (applied.body.error || "Pembayaran gagal. Saldo tidak dipotong."),
    paymentStatus: statusText as PaymentStatus,
    status: applied.status,
    mode,
    providerRef: refId,
    sn,
  };
}

async function applyDigiflazzStatus(env: LedgerEnv, row: StoredDigiSale) {
  const meta = row.provider_response ?? {};
  const refId = saleRef(row) || clean(meta.refId);
  const customerNumber = clean(meta.customerNumber) || clean(row.customer_number);
  const kind: DigiKind = meta.kind === "prepaid" || meta.kind === "postpaid" ? meta.kind : productKind(row.category_slug_snapshot, row.product_name_snapshot);
  let sku = clean(meta.buyerSkuCode);
  if (!sku) sku = await resolveBuyerSku(kind, row.category_slug_snapshot, row.product_name_snapshot, "").catch(() => "");
  const balanceNow = await walletBalance(env, row.user_id);
  if (!sku || !refId) return { status: 409, body: { error: "Data DigiFlazz transaksi ini belum lengkap.", balance: balanceNow, statusText: row.status } };
  const quote = await statusDigiflazz({ kind, sku, customerNumber, refId });
  return settleDigiflazzQuote(env, { ...row, provider_response: { ...meta, buyerSkuCode: sku, kind, refId, customerNumber } }, quote);
}

const syncJobs = new Map<string, Promise<number>>();
const syncAt = new Map<string, number>();

async function listOpenDigiSales(env: LedgerEnv, actorId: string, status: "pending" | "failed", limit: number) {
  if (!env.supabaseUrl || !env.serviceRoleKey) return [] as StoredDigiSale[];
  const base = "id,user_id,status,amount,customer_number,product_name_snapshot,category_slug_snapshot,customer_name,provider_response";
  const selects = [`${base},idempotency_key`, `${base},client_ref`, base];
  for (const select of selects) {
    try {
      const response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?user_id=eq.${encodeURIComponent(actorId)}&status=eq.${status}&select=${select}&order=created_at.desc&limit=${limit}`, {
        headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
        signal: AbortSignal.timeout(12_000),
      });
      const rows = await response.json().catch(() => null);
      if (response.ok && Array.isArray(rows)) {
        return rows.map((row: StoredDigiSale) => ({ ...row, idempotency_key: saleRef(row) }));
      }
      if (!(missingColumn(rows, "idempotency_key") || missingColumn(rows, "client_ref"))) return [] as StoredDigiSale[];
    } catch {
      return [] as StoredDigiSale[];
    }
  }
  return [] as StoredDigiSale[];
}

async function runSync(env: LedgerEnv, actorId: string, limit: number) {
  const [pending, failed] = await Promise.all([
    listOpenDigiSales(env, actorId, "pending", limit),
    listOpenDigiSales(env, actorId, "failed", limit),
  ]);
  const seen = new Set<string>();
  const rows = [...pending, ...failed].filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  let changed = 0;
  for (const row of rows) {
    try {
      const applied = await applyDigiflazzStatus(env, row);
      const statusText = String(applied.body.statusText || "");
      if (statusText === "success" || statusText === "failed" || statusText === "refunded") changed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "gagal";
      console.log(`[bayar] sinkron tertunda ${message.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  return changed;
}

export function syncPendingSales(env: LedgerEnv, actorId: string, force = false) {
  const current = syncJobs.get(actorId);
  if (current) return current;
  if (!force && Date.now() - (syncAt.get(actorId) || 0) < 20_000) return Promise.resolve(0);
  const job = runSync(env, actorId, force ? 4 : 3).finally(() => {
    syncJobs.delete(actorId);
    syncAt.set(actorId, Date.now());
  });
  syncJobs.set(actorId, job);
  return job;
}

export async function attachSaleReceipts(env: LedgerEnv, sales: LoketSale[]) {
  if (!env.supabaseUrl || !env.serviceRoleKey || sales.length === 0) return sales;
  const ids = sales.map((sale) => sale.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return sales;
  const details = new Map<string, { profit?: number; cost_price?: number; sell_price?: number; provider_reference?: string; provider_response?: DigiMeta | null; idempotency_key?: string; client_ref?: string }>();
  const selects = [
    "id,profit,cost_price,sell_price,provider_reference,provider_response,idempotency_key",
    "id,profit,cost_price,sell_price,provider_reference,provider_response,client_ref",
    "id,profit,cost_price,sell_price,provider_reference,provider_response",
  ];
  for (let index = 0; index < ids.length; index += 80) {
    const slice = ids.slice(index, index + 80);
    let rows: { id?: string; profit?: number; cost_price?: number; sell_price?: number; provider_reference?: string; provider_response?: DigiMeta | null; idempotency_key?: string; client_ref?: string }[] | null = null;
    for (const select of selects) {
      const response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?id=in.(${slice.join(",")})&select=${select}`, {
        headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
        signal: AbortSignal.timeout(12_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && Array.isArray(body)) {
        rows = body;
        break;
      }
      if (!(missingColumn(body, "idempotency_key") || missingColumn(body, "client_ref"))) break;
    }
    if (!rows) continue;
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
      sn: displayToken(meta.sn || "", row.provider_reference || "") || meta.sn || "",
      clientRef: saleRef(row) || meta.refId || "",
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
  const keys = callbackKeys(body);
  if (keys.length === 0) return { status: 400, body: { error: "Callback tanpa ref_id." } };
  let row: StoredDigiSale | null = null;
  for (const key of keys) {
    row = await findDigiflazzSale(env, key);
    if (row) break;
  }
  if (!row) return { status: 404, body: { error: "Transaksi callback belum tercatat." } };
  const payload = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : body;
  const quote = quoteFrom(payload, { refId: saleRef(row) || keys[0], sku: clean(row.provider_response?.buyerSkuCode), customerNumber: row.customer_number });
  const tail = (saleRef(row) || keys[0]).replace(/[^a-z0-9]/gi, "").slice(-6) || "------";
  console.log(`[bayar] callback ${quote.outcome} ref···${tail}`);
  if (row.status === "refunded" || (row.status === "success" && quote.outcome !== "success")) {
    return { status: 200, body: { ok: true, duplicate: true, statusText: row.status } };
  }
  if (row.status === "success") {
    const sn = displayToken(quote.sn || "", row.provider_response?.sn || "");
    if (sn && sn !== clean(row.provider_response?.sn)) {
      await rememberDigiflazz(env, row.id, { ...(row.provider_response ?? {}), sn, refId: saleRef(row) || keys[0] }).catch(() => undefined);
    }
    return { status: 200, body: { ok: true, duplicate: true, statusText: "success" } };
  }
  try {
    if (quote.outcome === "success" || quote.outcome === "failed") return await settleDigiflazzQuote(env, row, quote);
    return await applyDigiflazzStatus(env, row);
  } catch {
    return { status: 502, body: { error: "Status DigiFlazz belum dapat dipastikan. Saldo tidak diubah." } };
  }
}
