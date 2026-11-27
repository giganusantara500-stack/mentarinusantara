import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { faceValue, findCatalogItem, foldLabel } from "../src/lib/billerCatalog";

export type DigiKind = "prepaid" | "postpaid";
export type DigiOutcome = "pending" | "success" | "failed" | "not_found";

export interface BillMonth {
  period: string;
  amount: number | null;
  denda: number | null;
}

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
  providerCost: number;
  sn: string;
  lines?: BillMonth[];
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

export function newRefId() {
  return `MN${randomBytes(12).toString("hex")}`;
}

export function billIsPaid(message: string) {
  return /sudah\s+(di)?bayar|sudah\s+lunas|telah\s+lunas|tagihan\s+lunas/.test(message.toLowerCase());
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

function scalar(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return text(value);
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function monthLabel(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const match = digits.match(/^(20\d{2})(0[1-9]|1[0-2])$/);
  if (!match) return raw.trim();
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
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
  if (billIsPaid(message)) return "not_found";
  if (note.includes("tidak ditemukan") || note.includes("tidak ada tagihan") || note.includes("tidak ada tunggakan") || rc === "54") return "not_found";
  if (state.includes("gagal") || state === "failed") return "failed";
  if (state.includes("sukses") || state === "success" || rc === "00") return "success";
  if (state.includes("pending") || note.includes("pending") || rc === "03" || rc === "39") return "pending";
  return "failed";
}

function named(value: unknown) {
  const raw = text(value);
  if (!raw || /^pelanggan(\s+\d+)?$/i.test(raw)) return "";
  return raw;
}

function customerNameFrom(data: Record<string, unknown>) {
  const desc = data.desc && typeof data.desc === "object" && !Array.isArray(data.desc) ? data.desc as Record<string, unknown> : {};
  const direct = named(data.customer_name) || named(desc.customer_name);
  if (direct) return direct;
  const detail = Array.isArray(desc.detail) ? desc.detail : [];
  const fromDetail = detail.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    return [named(record.nama), named(record.customer_name), named(record.nama_pelanggan), named(record.name)];
  });
  const names = [
    named(data.nama),
    named(data.nama_pelanggan),
    named(data.name),
    named(desc.nama),
    named(desc.nama_pelanggan),
    named(desc.name),
    ...fromDetail,
  ].filter(Boolean);
  return names.find((name) => !name.includes("*")) || names[0] || "";
}

function billDetail(data: Record<string, unknown>) {
  const desc = data.desc && typeof data.desc === "object" && !Array.isArray(data.desc) ? data.desc as Record<string, unknown> : {};
  const nested = Array.isArray(desc.detail) ? desc.detail : Array.isArray(data.detail) ? data.detail : [];
  const rows = nested.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  return { desc, rows };
}

function present(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function monthLines(rows: Record<string, unknown>[]): BillMonth[] {
  return rows.flatMap((row) => {
    const period = monthLabel(scalar(row.periode) || scalar(row.period));
    const amountSource = row.nilai_tagihan ?? row.tagihan ?? row.amount;
    const hasAmount = present(amountSource);
    const hasDenda = present(row.denda);
    if (!period && !hasAmount && !hasDenda) return [];
    return [{ period, amount: hasAmount ? money(amountSource) : null, denda: hasDenda ? money(row.denda) : null }];
  });
}

function quoteFrom(data: Record<string, unknown>, fallback: { refId: string; sku: string; customerNumber: string }): DigiQuote {
  const { desc, rows } = billDetail(data);
  const lines = monthLines(rows);
  const denda = rows.reduce((sum, row) => sum + money(row.denda), 0);
  const tagihan = rows.reduce((sum, row) => sum + money(row.nilai_tagihan ?? row.tagihan ?? row.amount), 0);
  const adminFee = money(data.admin) || rows.reduce((sum, row) => sum + money(row.admin), 0);
  const price = money(data.price);
  const selling = money(data.selling_price);
  const amount = tagihan || Math.max(0, (selling || price) - adminFee - denda) || price;
  const parts = amount + denda + adminFee;
  const total = parts > 0 ? parts : (selling || price || amount);
  const providerCost = price > 0 ? price : Math.max(0, amount + denda);
  const periods = rows.map((row) => monthLabel(scalar(row.periode) || scalar(row.period))).filter(Boolean);
  const topPeriod = monthLabel(scalar(data.period) || scalar(data.periode));
  const tarif = text(desc.tarif) || text(data.tarif);
  const daya = scalar(desc.daya) || scalar(data.daya);
  const meter = [tarif, daya ? `${daya.replace(/\D/g, "") || daya} VA` : ""].filter(Boolean).join(" / ");
  const lembar = money(desc.lembar_tagihan) || periods.length;
  const periodCore = periods.length > 0 ? [...new Set(periods)].join(", ") : topPeriod;
  const period = [meter, lembar > 1 ? `${lembar} lembar` : "", periodCore].filter(Boolean).join(" · ");
  const message = text(data.message);
  let outcome = mapDigiOutcome(text(data.status), scalar(data.rc), message);
  if (outcome === "failed" && total >= 1000 && !/gagal|tidak ditemukan|tidak ada tagihan|invalid|salah|cutoff|gangguan/.test(message.toLowerCase())) {
    outcome = "success";
  }
  return {
    outcome,
    message: message || (outcome === "success" ? "Tagihan ditemukan." : "DigiFlazz tidak mengirim keterangan."),
    refId: text(data.ref_id) || fallback.refId,
    sku: text(data.buyer_sku_code) || fallback.sku,
    customerName: customerNameFrom(data),
    customerNumber: text(data.customer_no) || fallback.customerNumber,
    period,
    amount,
    denda,
    adminFee,
    total: total || amount,
    providerCost,
    sn: text(data.sn),
    lines,
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

const depositCache: { at: number; balance: number | null; error: string } = { at: 0, balance: null, error: "" };

export async function digiflazzDeposit(fresh = false) {
  if (!digiflazzReady()) return { balance: null as number | null, error: "Username atau API key DigiFlazz belum diisi." };
  if (!fresh && depositCache.at > 0 && Date.now() - depositCache.at < 60_000) {
    return { balance: depositCache.balance, error: depositCache.error };
  }
  try {
    const config = digiflazzConfig();
    const data = await postDigi("/cek-saldo", {
      cmd: "deposit",
      username: config.username,
      sign: digiflazzSign(config.username, config.apiKey, "depo"),
    });
    const reported = data.deposit !== undefined && data.deposit !== null && String(data.deposit).trim() !== "";
    const balance = money(data.deposit);
    const message = text(data.message);
    const rc = scalar(data.rc);
    if (!reported || (rc && rc !== "00" && rc !== "0") || (balance <= 0 && /gagal|invalid|salah|tidak/.test(message.toLowerCase()))) {
      depositCache.at = Date.now();
      depositCache.balance = null;
      depositCache.error = message || "Saldo DigiFlazz tidak terbaca.";
      return { balance: null, error: depositCache.error };
    }
    depositCache.at = Date.now();
    depositCache.balance = balance;
    depositCache.error = "";
    return { balance, error: "" };
  } catch {
    return { balance: depositCache.balance, error: "Saldo DigiFlazz tidak dapat dihubungi." };
  }
}

function transactionAuth(live: boolean) {
  const config = digiflazzConfig();
  const devKey = (process.env.DIGIFLAZZ_DEV_KEY || "").trim();
  // testing:true is checked against the Development Key. Prepaid price-list and
  // inquiry-pln succeed with DIGIFLAZZ_API_KEY and never send testing, so that
  // value is the Production Key. Pairing it with testing:true returns "Signature Anda salah".
  if (!live && config.testing && devKey) return { username: config.username, apiKey: devKey, testing: true };
  return { username: config.username, apiKey: config.apiKey, testing: false };
}

function signedTransaction(refId: string, sku: string, customerNumber: string, commands?: string, live = false) {
  const auth = transactionAuth(live);
  return {
    ...(commands ? { commands } : {}),
    username: auth.username,
    buyer_sku_code: sku,
    customer_no: customerNumber.trim(),
    ref_id: refId,
    sign: digiflazzSign(auth.username, auth.apiKey, refId),
    ...(auth.testing ? { testing: true } : {}),
  };
}

const priceCache: { at: number; prepaid: Record<string, unknown>[]; postpaid: Record<string, unknown>[]; prepaidMessage: string; postpaidMessage: string } = { at: 0, prepaid: [], postpaid: [], prepaidMessage: "", postpaidMessage: "" };

function rowSku(row: Record<string, unknown>) {
  return text(row.buyer_sku_code) || text(row.buyerSkuCode);
}

function rowActive(row: Record<string, unknown>) {
  const closed = (value: unknown) => value === false || value === 0 || value === "0" || String(value).trim().toLowerCase() === "false";
  return !closed(row.buyer_product_status) && !closed(row.seller_product_status);
}

function extractRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row) && Boolean(rowSku(row as Record<string, unknown>) || text((row as Record<string, unknown>).product_name)));
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const key of ["data", "pricelist", "price_list", "list"]) {
    const nested = extractRows(record[key]);
    if (nested.length > 0) return nested;
  }
  return [];
}

function listMessage(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const inner = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data as Record<string, unknown> : {};
  return text(record.message) || text(inner.message);
}

async function loadPriceList(kind: DigiKind) {
  const config = digiflazzConfig();
  const sign = digiflazzSign(config.username, config.apiKey, "pricelist");
  const payload = await postDigi("/price-list", { cmd: kind === "prepaid" ? "prepaid" : "pasca", username: config.username, sign });
  return { rows: extractRows(payload), message: listMessage(payload) };
}

async function priceRows(kind: DigiKind) {
  if (Date.now() - priceCache.at < 10 * 60 * 1000 && (kind === "prepaid" ? priceCache.prepaid : priceCache.postpaid).length > 0) {
    return { rows: kind === "prepaid" ? priceCache.prepaid : priceCache.postpaid, message: kind === "prepaid" ? priceCache.prepaidMessage : priceCache.postpaidMessage };
  }
  const [prepaid, postpaid] = await Promise.allSettled([loadPriceList("prepaid"), loadPriceList("postpaid")]);
  priceCache.at = Date.now();
  priceCache.prepaid = prepaid.status === "fulfilled" ? prepaid.value.rows : [];
  priceCache.postpaid = postpaid.status === "fulfilled" ? postpaid.value.rows : [];
  priceCache.prepaidMessage = prepaid.status === "fulfilled" ? prepaid.value.message : "Daftar harga prabayar DigiFlazz tidak dapat dibaca.";
  priceCache.postpaidMessage = postpaid.status === "fulfilled" ? postpaid.value.message : "Daftar harga pascabayar DigiFlazz tidak dapat dibaca.";
  return { rows: kind === "prepaid" ? priceCache.prepaid : priceCache.postpaid, message: kind === "prepaid" ? priceCache.prepaidMessage : priceCache.postpaidMessage };
}

function plnAmount(sku: string) {
  const match = sku.toLowerCase().match(/^pln(\d+)(b)?$/);
  return match ? Number(match[1]) * 1000 : 0;
}

function mentionsAmount(row: Record<string, unknown>, amount: number) {
  const raw = `${text(row.product_name)} ${text(row.desc)} ${rowSku(row)}`.toLowerCase();
  const full = String(amount);
  const grouped = full.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (raw.includes(full) || raw.includes(grouped) || foldLabel(raw).includes(foldLabel(grouped))) return true;
  const price = money(row.price);
  return price > 0 && Math.abs(price - amount) <= Math.max(2500, Math.round(amount * 0.08));
}

function postpaidPlnRequest(sku: string, category: string, product: string) {
  const blob = foldLabel(`${category} ${product} ${sku}`);
  if (blob.includes("token") || /^pln\d/.test(sku.trim().toLowerCase())) return false;
  if (!blob.includes("pln") && !sku.trim().toLowerCase().startsWith("pln")) return false;
  return blob.includes("pasca") || blob.includes("postpaid") || blob.includes("nontaglis") || sku.trim().toLowerCase() === "pln";
}

function postpaidPlnRow(row: Record<string, unknown>, nontaglis: boolean) {
  const code = rowSku(row).toLowerCase();
  const blob = foldLabel(`${text(row.brand)} ${text(row.category)} ${text(row.product_name)} ${code} ${text(row.desc)} ${text(row.seller_name)} ${text(row.seller)}`);
  if (/token|prepaid/.test(blob) || /^pln\d/.test(code) || code.endsWith("b")) return false;
  if (!blob.includes("pln") && code !== "pln" && code !== "bplndy") return false;
  if (nontaglis) return blob.includes("nontaglis") || code.includes("nontaglis");
  return blob.includes("pasca") || blob.includes("postpaid") || blob.includes("tagihan") || code === "pln" || code === "bplndy";
}

function sellerText(row: Record<string, unknown>) {
  return foldLabel(`${text(row.seller_name)} ${text(row.seller)} ${text(row.desc)} ${rowSku(row)} ${text(row.product_name)}`).replace(/\s+/g, "");
}

function plnPostpaidHints() {
  const sellers = (process.env.DIGIFLAZZ_PLN_POSTPAID_SELLER || "cv ikon media indonesia,ikon media indonesia,aneka digital,arqiva pos")
    .split(/[,;]+/)
    .map((item) => foldLabel(item).replace(/\s+/g, ""))
    .filter(Boolean);
  const codes = (process.env.DIGIFLAZZ_PLN_POSTPAID_CODE || "PLN,BPLNDY,PLNPASCA2300,PLNPASCA2160")
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return { sellers, codes };
}

function preferredPlnPostpaid(rows: Record<string, unknown>[]) {
  const hints = plnPostpaidHints();
  const ranked = rows.flatMap((row) => {
    const seller = sellerText(row);
    const code = rowSku(row).toLowerCase();
    const sellerRank = hints.sellers.findIndex((item) => seller.includes(item));
    const hinted = hints.codes.findIndex((item) => code === item || (item.length > 4 && seller.includes(item)));
    let score = 0;
    if (sellerRank >= 0) score += (hints.sellers.length - sellerRank) * 100;
    if (hinted >= 0) score += 40 - hinted;
    else if (/plnpasca\d+/.test(seller) || /plnpasca\d+/.test(code) || code === "bplndy") score += 10;
    return score > 0 ? [{ row, score }] : [];
  }).sort((left, right) => right.score - left.score);
  return ranked[0]?.row;
}

export function selectPriceRow(rows: Record<string, unknown>[], sku: string, category: string, product: string) {
  const wanted = sku.trim().toLowerCase();
  const active = rows.filter(rowActive);
  const pool = active.length > 0 ? active : [];
  if (postpaidPlnRequest(wanted, category, product)) {
    const nontaglis = foldLabel(`${category} ${product} ${wanted}`).includes("nontaglis");
    const pascaRows = pool.filter((row) => postpaidPlnRow(row, nontaglis));
    const preferred = preferredPlnPostpaid(pascaRows) || pascaRows.find((row) => rowSku(row).toLowerCase() === wanted) || pascaRows[0];
    if (preferred) return preferred;
  }
  const exact = pool.find((row) => rowSku(row).toLowerCase() === wanted);
  if (exact) return exact;
  const amount = plnAmount(wanted);
  if (amount > 0) {
    const variantB = wanted.endsWith("b");
    const candidates = pool.filter((row) => {
      const code = rowSku(row).toLowerCase();
      const parsed = code.match(/^pln(\d+)(b)?$/);
      if (parsed && Number(parsed[1]) * 1000 === amount) return true;
      const brand = foldLabel(`${text(row.brand)} ${text(row.category)} ${text(row.product_name)}`);
      return brand.includes("pln") && mentionsAmount(row, amount);
    });
    const sameVariant = candidates.find((row) => rowSku(row).toLowerCase().endsWith("b") === variantB);
    if (sameVariant) return sameVariant;
    if (!variantB) return candidates.find((row) => !rowSku(row).toLowerCase().endsWith("b")) ?? null;
    return candidates[0] ?? null;
  }
  let best: { row: Record<string, unknown>; score: number } | null = null;
  for (const row of pool) {
    if (!wanted.endsWith("b") && rowSku(row).toLowerCase().endsWith("b")) continue;
    const score = priceScore(row, product || sku, category);
    if (score >= 60 && (!best || score > best.score)) best = { row, score };
  }
  return best?.row ?? null;
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

export async function resolveBuyerSku(kind: DigiKind, category: string, product: string, explicit = "") {
  const given = explicit.trim();
  const mapped = findCatalogItem(category, product);
  const preferred = /^[A-Za-z0-9._-]{1,64}$/.test(given) ? given : mapped?.sku || "";
  if (!digiflazzReady()) return preferred;
  try {
    const primary = await priceRows(kind);
    const live = selectPriceRow(primary.rows, preferred, category, product);
    if (live) return rowSku(live);
    const alternate = await priceRows(kind === "prepaid" ? "postpaid" : "prepaid");
    const other = selectPriceRow(alternate.rows, preferred, category, product);
    return other ? rowSku(other) : preferred;
  } catch {
    return preferred;
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
    const listed = await priceRows("prepaid");
    const match = selectPriceRow(listed.rows, input.sku, input.category || "", input.product || "");
    if (!match) {
      const message = listed.rows.length === 0
        ? (listed.message || "Daftar harga DigiFlazz tidak dapat dibaca. Coba lagi beberapa saat.")
        : `Produk ${input.sku || input.product || "ini"} belum aktif di daftar harga DigiFlazz.`;
      return { outcome: "failed", message, refId: input.refId, sku: input.sku, customerName: "", customerNumber: input.customerNumber, period: "", amount: 0, denda: 0, adminFee: 0, total: 0, providerCost: 0, sn: "" };
    }
    const sku = rowSku(match) || input.sku;
    const price = money(match.price);
    const face = faceValue(input.product || "") || faceValue(text(match.product_name));
    const amount = face > 0 ? face : price;
    let customerName = "";
    let period = "";
    if (isPlnPrepaid(input)) {
      try {
        const subscriber = await plnSubscriber(input.customerNumber);
        customerName = subscriber.name;
        period = subscriber.period;
        if (!customerName && subscriber.rc !== "86" && subscriber.outcome !== "success" && subscriber.outcome !== "pending") {
          return { outcome: subscriber.outcome === "not_found" ? "not_found" : "failed", message: subscriber.message || "Nomor meter PLN tidak ditemukan.", refId: input.refId, sku, customerName: "", customerNumber: input.customerNumber, period: "", amount: 0, denda: 0, adminFee: 0, total: 0, providerCost: 0, sn: "" };
        }
      } catch {
        customerName = "";
      }
    }
    return {
      outcome: "success",
      message: text(match.product_name) || "Produk siap dibayar.",
      refId: input.refId,
      sku,
      customerName,
      customerNumber: input.customerNumber,
      period,
      amount,
      denda: 0,
      adminFee: 0,
      total: amount,
      providerCost: price,
      sn: "",
    };
  }
  const data = await postDigi("/transaction", signedTransaction(input.refId, input.sku, input.customerNumber, "inq-pasca", true));
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
