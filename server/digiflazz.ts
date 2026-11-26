import { createHash, timingSafeEqual } from "node:crypto";
import { findCatalogItem, foldLabel } from "../src/lib/billerCatalog";

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
  const listed = findCatalogItem(category, product);
  if (listed) return listed.kind;
  if (category.trim().toLowerCase() === "topup") return "prepaid";
  if (/prepaid|pulsa|token|e-money|e-wallet|voucher|masa aktif|\bdata\b/i.test(`${category} ${product}`)) return "prepaid";
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
  return foldLabel(value).replace(/[^a-z0-9]+/g, "");
}

function priceScore(row: Record<string, unknown>, product: string, category: string) {
  const sku = compact(text(row.buyer_sku_code));
  const name = foldLabel(text(row.product_name));
  const brand = foldLabel(text(row.brand));
  const rowCategory = foldLabel(text(row.category));
  const productKey = foldLabel(product);
  const categoryKey = foldLabel(category);
  const productCode = compact(product);
  if (!productKey && !productCode) return 0;
  if (productCode && sku === productCode) return 100;
  if (productKey && (name === productKey || foldLabel(`${brand} ${name}`) === productKey)) return 90;
  let score = 0;
  if (productKey && name.includes(productKey)) score += 60;
  if (productCode && sku && (sku.includes(productCode) || productCode.includes(sku))) score += 25;
  if (brand && productKey.includes(brand)) score += 15;
  if (categoryKey && (rowCategory.includes(categoryKey) || brand.includes(categoryKey) || name.includes(categoryKey))) score += 10;
  return score;
}

function matchPriceRow(rows: Record<string, unknown>[], product: string, category: string) {
  let best: { row: Record<string, unknown>; score: number } | null = null;
  for (const row of rows) {
    const score = priceScore(row, product, category);
    if (score >= 60 && (!best || score > best.score)) best = { row, score };
  }
  return best ? text(best.row.buyer_sku_code) : "";
}

export async function resolveBuyerSku(kind: DigiKind, category: string, product: string, explicit = "") {
  const given = explicit.trim();
  if (/^[A-Za-z0-9._-]{1,64}$/.test(given)) return given;
  const mapped = findCatalogItem(category, product);
  if (mapped) return mapped.sku;
  if (!digiflazzReady()) return "";
  try {
    const primary = await priceRows(kind);
    const direct = matchPriceRow(primary, product, category);
    if (direct) return direct;
    const alternate = await priceRows(kind === "prepaid" ? "postpaid" : "prepaid");
    return matchPriceRow(alternate, product, category);
  } catch {
    return "";
  }
}

function isPlnPrepaid(input: { kind: DigiKind; sku: string; category?: string; product?: string }) {
  if (input.kind !== "prepaid") return false;
  if ((input.category || "").trim().toLowerCase() === "pln") return true;
  return /^pln\d/i.test(input.sku.trim());
}

function plnPower(value: string) {
  const match = value.match(/^([A-Za-z0-9]+)\s*\/\s*0*(\d+)$/);
  return match ? `${match[1]} / ${match[2]} VA` : value;
}

async function plnSubscriber(customerNumber: string) {
  const config = digiflazzConfig();
  const customerNo = customerNumber.replace(/\D/g, "") || customerNumber.trim();
  const data = await postDigi("/inquiry-pln", {
    username: config.username,
    customer_no: customerNo,
    sign: digiflazzSign(config.username, config.apiKey, customerNo),
  });
  const message = text(data.message);
  const status = text(data.status);
  const rc = text(data.rc);
  return {
    name: customerNameFrom(data),
    period: plnPower(text(data.segment_power)),
    outcome: status || rc || message ? mapDigiOutcome(status, rc, message) : "failed" as DigiOutcome,
    message,
    rc,
  };
}

export async function inquireDigiflazz(input: { kind: DigiKind; sku: string; customerNumber: string; refId: string; category?: string; product?: string }): Promise<DigiQuote> {
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
    let customerName = "";
    let period = "";
    if (isPlnPrepaid(input)) {
      try {
        const subscriber = await plnSubscriber(input.customerNumber);
        customerName = subscriber.name;
        period = subscriber.period;
        if (!customerName && subscriber.rc !== "86" && subscriber.outcome !== "success" && subscriber.outcome !== "pending") {
          return { outcome: subscriber.outcome === "not_found" ? "not_found" : "failed", message: subscriber.message || "Nomor meter PLN tidak ditemukan.", refId: input.refId, sku: input.sku, customerName: "", customerNumber: input.customerNumber, period: "", amount: 0, denda: 0, adminFee: 0, total: 0, sn: "" };
        }
      } catch {
        customerName = "";
      }
    }
    return {
      outcome: "success",
      message: text(match.product_name) || "Produk siap dibayar.",
      refId: input.refId,
      sku: input.sku,
      customerName,
      customerNumber: input.customerNumber,
      period,
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
