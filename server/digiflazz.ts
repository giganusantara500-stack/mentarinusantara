import { createHash, timingSafeEqual } from "node:crypto";

export type DigiKind = "prepaid" | "postpaid";
export type DigiOutcome = "pending" | "success" | "failed" | "not_found";

export interface DigiQuote {
  outcome: DigiOutcome;
  message: string;
  refId: string;
  sku: string;
  customerName: string;
  customerNumber: string;
  period: string;
  amount: number;
  denda: number;
  adminFee: number;
  total: number;
  sn: string;
}

const DEFAULT_BASE = "https://api.digiflazz.com/v1";

export function digiflazzConfig() {
  return {
    username: (process.env.DIGIFLAZZ_USERNAME || "").trim(),
    apiKey: (process.env.DIGIFLAZZ_API_KEY || "").trim(),
    baseUrl: (process.env.DIGIFLAZZ_BASE_URL || DEFAULT_BASE).trim().replace(/\/$/, "") || DEFAULT_BASE,
    callbackSecret: (process.env.DIGIFLAZZ_CALLBACK_SECRET || "").trim(),
    testing: (process.env.DIGIFLAZZ_TESTING || "").trim().toLowerCase() === "true",
  };
}

export function digiflazzReady() {
  const config = digiflazzConfig();
  return Boolean(config.username && config.apiKey);
}

export function digiflazzSign(username: string, apiKey: string, refId: string) {
  return createHash("md5").update(`${username}${apiKey}${refId}`).digest("hex");
}

export function sameSecret(given: string, expected: string) {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function productKind(category: string, product: string, explicit = ""): DigiKind {
  if (explicit === "prepaid" || explicit === "postpaid") return explicit;
  if (category.trim().toLowerCase() === "topup") return "prepaid";
  if (/prepaid|pulsa|token|e-money|e-wallet|data/i.test(product)) return "prepaid";
  return "postpaid";
}

function money(value: unknown) {
  const amount = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function payloadOf(body: unknown) {
  if (!body || typeof body !== "object") return {} as Record<string, unknown>;
  const record = body as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return record;
}

export function mapDigiOutcome(status: string, rc: string, message: string): DigiOutcome {
  const state = status.toLowerCase();
  const note = message.toLowerCase();
  if (state.includes("gagal") || state === "failed") return "failed";
  if (state.includes("sukses") || state === "success" || rc === "00") return "success";
  if (state.includes("pending") || note.includes("pending") || rc === "03" || rc === "39") return "pending";
  if (note.includes("tidak ditemukan") || note.includes("tidak ada tagihan") || rc === "54") return "not_found";
  return "failed";
}

function named(value: unknown) {
  const raw = text(value);
  if (!raw || /^pelanggan(\s+\d+)?$/i.test(raw)) return "";
  return raw;
}

function customerNameFrom(data: Record<string, unknown>) {
  const desc = data.desc && typeof data.desc === "object" && !Array.isArray(data.desc) ? data.desc as Record<string, unknown> : {};
  const detail = Array.isArray(desc.detail) ? desc.detail : [];
  const fromDetail = detail
    .map((row) => (row && typeof row === "object" ? named((row as Record<string, unknown>).nama) || named((row as Record<string, unknown>).customer_name) || named((row as Record<string, unknown>).name) : ""))
    .find(Boolean);
  return named(data.customer_name)
    || named(data.nama)
    || named(data.nama_pelanggan)
    || named(data.name)
    || named(desc.customer_name)
    || named(desc.nama)
    || named(desc.nama_pelanggan)
    || named(desc.name)
    || fromDetail
    || "";
}

function quoteFrom(data: Record<string, unknown>, fallback: { refId: string; sku: string; customerNumber: string }): DigiQuote {
  const details = data.desc && typeof data.desc === "object" ? (data.desc as Record<string, unknown>).detail : undefined;
  const rows = Array.isArray(details) ? details : [];
  const denda = rows.reduce((sum, row) => sum + money((row as Record<string, unknown>)?.denda), 0);
  const tagihan = rows.reduce((sum, row) => sum + money((row as Record<string, unknown>)?.nilai_tagihan), 0);
  const adminFee = money(data.admin);
  const price = money(data.price);
  const selling = money(data.selling_price);
  const amount = tagihan || Math.max(0, price - adminFee - denda) || price;
  const total = selling || price || amount + denda + adminFee;
  const message = text(data.message);
  return {
    outcome: mapDigiOutcome(text(data.status), text(data.rc), message),
    message: message || "DigiFlazz tidak mengirim keterangan.",
    refId: text(data.ref_id) || fallback.refId,
    sku: text(data.buyer_sku_code) || fallback.sku,
    customerName: customerNameFrom(data),
    customerNumber: text(data.customer_no) || fallback.customerNumber,
    period: text(data.period) || text(data.desc && typeof data.desc === "object" ? (data.desc as Record<string, unknown>).lembar_tagihan : ""),
    amount,
    denda,
    adminFee,
    total: total || amount,
    sn: text(data.sn),
  };
}

async function postDigi(path: string, body: Record<string, unknown>) {
  const config = digiflazzConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await response.json().catch(() => null);
  return payloadOf(json);
}

function signedTransaction(refId: string, sku: string, customerNumber: string, commands?: string) {
  const config = digiflazzConfig();
  return {
    ...(commands ? { commands } : {}),
    username: config.username,
    buyer_sku_code: sku,
    customer_no: customerNumber,
    ref_id: refId,
    sign: digiflazzSign(config.username, config.apiKey, refId),
    ...(config.testing ? { testing: true } : {}),
  };
}

const priceCache: { at: number; prepaid: Record<string, unknown>[]; postpaid: Record<string, unknown>[] } = { at: 0, prepaid: [], postpaid: [] };

function asRows(data: Record<string, unknown>) {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  return Array.isArray(data.data) ? data.data as Record<string, unknown>[] : [];
}

async function priceRows(kind: DigiKind) {
  if (Date.now() - priceCache.at < 10 * 60 * 1000 && (kind === "prepaid" ? priceCache.prepaid : priceCache.postpaid).length > 0) {
    return kind === "prepaid" ? priceCache.prepaid : priceCache.postpaid;
  }
  const config = digiflazzConfig();
  const sign = digiflazzSign(config.username, config.apiKey, "pricelist");
  const [prepaid, postpaid] = await Promise.all([
    postDigi("/price-list", { cmd: "prepaid", username: config.username, sign }),
    postDigi("/price-list", { cmd: "pasca", username: config.username, sign }),
  ]);
  priceCache.at = Date.now();
  priceCache.prepaid = asRows(prepaid);
  priceCache.postpaid = asRows(postpaid);
  return kind === "prepaid" ? priceCache.prepaid : priceCache.postpaid;
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mappedSku(category: string, product: string) {
  const cat = category.trim().toLowerCase();
  const name = product.trim().toLowerCase();
  if (cat === "pln") {
    if (name === "postpaid" || name === "pascabayar") return "pln";
    if (name === "nontaglis") return "plnnontaglis";
    const prepaid = name.match(/prepaid\s+(\d+)/);
    if (prepaid) return `pln${prepaid[1]}`;
  }
  return "";
}

export async function resolveBuyerSku(kind: DigiKind, category: string, product: string, explicit = "") {
  const given = explicit.trim();
  if (/^[A-Za-z0-9._-]{1,64}$/.test(given)) return given;
  const mapped = mappedSku(category, product);
  if (mapped) return mapped;
  if (!digiflazzReady()) return "";
  try {
    const rows = await priceRows(kind);
    const productKey = compact(product);
    const categoryKey = compact(category);
    const hit = rows.find((row) => {
      const sku = compact(text(row.buyer_sku_code));
      const name = compact(text(row.product_name));
      const brand = compact(text(row.brand));
      const rowCategory = compact(text(row.category));
      const sameProduct = Boolean(productKey) && (sku === productKey || name.includes(productKey) || brand.includes(productKey));
      if (!sameProduct) return false;
      if (!categoryKey) return true;
      return rowCategory.includes(categoryKey) || brand.includes(categoryKey) || name.includes(categoryKey) || sku.includes(categoryKey);
    });
    return hit ? text(hit.buyer_sku_code) : "";
  } catch {
    return "";
  }
}

export async function inquireDigiflazz(input: { kind: DigiKind; sku: string; customerNumber: string; refId: string }): Promise<DigiQuote> {
  if (input.kind === "prepaid") {
    const config = digiflazzConfig();
    const data = await postDigi("/price-list", {
      cmd: "prepaid",
      username: config.username,
      sign: digiflazzSign(config.username, config.apiKey, "pricelist"),
    });
    const rows = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown }).data) ? (data as { data: unknown[] }).data : [];
    const match = rows.find((row) => text((row as Record<string, unknown>)?.buyer_sku_code).toLowerCase() === input.sku.toLowerCase()) as Record<string, unknown> | undefined;
    if (!match) {
      return { outcome: "not_found", message: "Kode produk DigiFlazz tidak ada di daftar harga.", refId: input.refId, sku: input.sku, customerName: "", customerNumber: input.customerNumber, period: "", amount: 0, denda: 0, adminFee: 0, total: 0, sn: "" };
    }
    if (match.buyer_product_status === false || match.seller_product_status === false) {
      return { outcome: "failed", message: "Produk DigiFlazz sedang tidak aktif.", refId: input.refId, sku: input.sku, customerName: "", customerNumber: input.customerNumber, period: "", amount: 0, denda: 0, adminFee: 0, total: 0, sn: "" };
    }
    const price = money(match.price);
    return {
      outcome: "success",
      message: text(match.product_name) || "Produk siap dibayar.",
      refId: input.refId,
      sku: input.sku,
      customerName: "",
      customerNumber: input.customerNumber,
      period: "",
      amount: price,
      denda: 0,
      adminFee: 0,
      total: price,
      sn: "",
    };
  }
  const data = await postDigi("/transaction", signedTransaction(input.refId, input.sku, input.customerNumber, "inq-pasca"));
  return quoteFrom(data, input);
}

export async function payDigiflazz(input: { kind: DigiKind; sku: string; customerNumber: string; refId: string }) {
  const commands = input.kind === "postpaid" ? "pay-pasca" : undefined;
  const data = await postDigi("/transaction", signedTransaction(input.refId, input.sku, input.customerNumber, commands));
  return quoteFrom(data, input);
}

export async function statusDigiflazz(input: { kind: DigiKind; sku: string; customerNumber: string; refId: string }) {
  const commands = input.kind === "postpaid" ? "status-pasca" : undefined;
  const data = await postDigi("/transaction", signedTransaction(input.refId, input.sku, input.customerNumber, commands));
  return quoteFrom(data, input);
}

export function callbackRef(body: Record<string, unknown>) {
  const data = payloadOf(body);
  return text(data.ref_id) || text(body.ref_id);
}
