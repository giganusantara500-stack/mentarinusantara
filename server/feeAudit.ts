import { displayToken } from "./digiflazz";
import { syncOpenNetworkSales } from "./biller";
import type { LedgerEnv } from "./ledger";

interface Caller {
  id: string;
  role: string;
}

interface StoredRow {
  id: string;
  user_id: string;
  product_name_snapshot: string;
  category_slug_snapshot: string;
  customer_number: string;
  customer_name: string | null;
  amount: number;
  cost_price: number;
  sell_price: number;
  profit: number;
  status: string;
  created_at: string;
  provider_response?: {
    sn?: string;
    tagihan?: number;
    denda?: number;
    providerCost?: number;
    providerAdmin?: number;
  } | null;
}

export interface FeeParts {
  nominal: number;
  modal: number;
  h2hFee: number;
  mentariFee: number;
  amount: number;
}

export function splitFee(input: {
  amount: number;
  tagihan: number;
  denda: number;
  providerCost: number;
  providerAdmin: number;
  profit: number;
  status: string;
}): FeeParts {
  const amount = Math.max(0, Math.round(input.amount) || 0);
  const denda = Math.max(0, Math.round(input.denda) || 0);
  const tagihan = Math.max(0, Math.round(input.tagihan) || 0);
  const nominal = tagihan > 0 ? tagihan : Math.max(0, amount - denda);
  if (input.status !== "success") return { nominal, modal: 0, h2hFee: 0, mentariFee: 0, amount };
  const cost = Math.max(0, Math.round(input.providerCost) || 0);
  const stated = Math.max(0, Math.round(input.providerAdmin) || 0);
  const h2hFee = stated > 0 && cost >= nominal + denda + stated ? stated : Math.max(0, cost - nominal - denda);
  const modal = cost > 0 ? Math.max(0, cost - h2hFee) : nominal;
  const mentariFee = Math.max(Math.round(input.profit) || 0, cost > 0 ? Math.max(0, amount - cost) : Math.max(0, amount - nominal - denda));
  return { nominal, modal, h2hFee, mentariFee, amount };
}

function monthWindow(month: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const part = Number(match[2]);
  const nextMonth = part === 12 ? 1 : part + 1;
  const nextYear = part === 12 ? year + 1 : year;
  const start = `${match[1]}-${match[2]}-01T00:00:00.000+07:00`;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00.000+07:00`;
  return { start, end };
}

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date());
}

async function readRows(env: LedgerEnv, params: URLSearchParams) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/transactions?${params.toString()}`, {
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) return { ok: false as const, rows: [] as StoredRow[] };
  return { ok: true as const, rows: body as StoredRow[] };
}

async function loketDirectory(env: LedgerEnv) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/profiles?select=id,full_name,username,loket_code&role=eq.loket&limit=1000`, {
    headers: { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) return [] as { id: string; name: string; code: string }[];
  return body.map((row: { id?: string; full_name?: string | null; username?: string | null; loket_code?: string | null }) => ({
    id: String(row.id || ""),
    name: String(row.full_name || row.username || "Loket"),
    code: String(row.loket_code || ""),
  })).filter((row) => row.id);
}

function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function rollingFeeWindow() {
  const [yearText, monthText, dayText] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const start = shiftMonth(year, month, -2);
  const end = shiftMonth(year, month, 1);
  const months = [0, 1, 2].map((offset) => {
    const part = shiftMonth(start.year, start.month, offset);
    return `${part.year}-${String(part.month).padStart(2, "0")}`;
  });
  return {
    start: `${start.year}-${String(start.month).padStart(2, "0")}-01T00:00:00.000+07:00`,
    end: `${end.year}-${String(end.month).padStart(2, "0")}-01T00:00:00.000+07:00`,
    months,
    today: `${yearText}-${monthText}-${dayText}`,
  };
}

function jakartaDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

async function loadSuccessWindow(env: LedgerEnv, start: string, end: string) {
  const rows: StoredRow[] = [];
  const page = 1000;
  for (let offset = 0; offset < 8000; offset += page) {
    const params = new URLSearchParams();
    params.set("select", "id,user_id,product_name_snapshot,category_slug_snapshot,customer_number,customer_name,amount,cost_price,sell_price,profit,status,created_at,provider_response");
    params.set("channel", "eq.production");
    params.set("status", "eq.success");
    params.set("created_at", `gte.${start}`);
    params.append("created_at", `lt.${end}`);
    params.set("order", "created_at.asc");
    params.set("limit", String(page));
    params.set("offset", String(offset));
    const stored = await readRows(env, params);
    if (!stored.ok) return { ok: false as const, rows };
    rows.push(...stored.rows);
    if (stored.rows.length < page) break;
  }
  return { ok: true as const, rows };
}

async function feeReport(env: LedgerEnv) {
  const window = rollingFeeWindow();
  const [stored, lokets] = await Promise.all([loadSuccessWindow(env, window.start, window.end), loketDirectory(env)]);
  if (!stored.ok) return { status: 502, body: { error: "Laporan fee belum dapat dibaca." } };
  const names = new Map(lokets.map((loket) => [loket.id, loket]));
  const daily = new Map<string, { h2h: number; mentari: number; count: number }>();
  const byLoket = new Map<string, { id: string; name: string; code: string; h2h: number; mentari: number; count: number; months: Record<string, { h2h: number; mentari: number; count: number }> }>();
  for (const row of stored.rows) {
    const meta = row.provider_response ?? {};
    const parts = splitFee({
      amount: Number(row.amount) || 0,
      tagihan: Number(meta.tagihan) || 0,
      denda: Number(meta.denda) || 0,
      providerCost: Number(meta.providerCost) || Number(row.cost_price) || 0,
      providerAdmin: Number(meta.providerAdmin) || 0,
      profit: Number(row.profit) || 0,
      status: row.status,
    });
    const date = jakartaDay(row.created_at);
    const month = date.slice(0, 7);
    const bucket = daily.get(date) ?? { h2h: 0, mentari: 0, count: 0 };
    bucket.h2h += parts.h2hFee;
    bucket.mentari += parts.mentariFee;
    bucket.count += 1;
    daily.set(date, bucket);
    const loket = names.get(row.user_id);
    const entry = byLoket.get(row.user_id) ?? { id: row.user_id, name: loket?.name || "Loket", code: loket?.code || "", h2h: 0, mentari: 0, count: 0, months: {} };
    entry.h2h += parts.h2hFee;
    entry.mentari += parts.mentariFee;
    entry.count += 1;
    const monthEntry = entry.months[month] ?? { h2h: 0, mentari: 0, count: 0 };
    monthEntry.h2h += parts.h2hFee;
    monthEntry.mentari += parts.mentariFee;
    monthEntry.count += 1;
    entry.months[month] = monthEntry;
    byLoket.set(row.user_id, entry);
  }
  const days: { date: string; month: string; h2h: number; mentari: number; total: number; count: number; h2hAccum: number; mentariAccum: number; totalAccum: number }[] = [];
  const monthsSummary: { month: string; h2h: number; mentari: number; total: number; count: number }[] = [];
  for (const month of window.months) {
    const [yearText, monthText] = month.split("-");
    const length = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
    let h2hAccum = 0;
    let mentariAccum = 0;
    let count = 0;
    for (let day = 1; day <= length; day += 1) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      if (date > window.today) break;
      const bucket = daily.get(date) ?? { h2h: 0, mentari: 0, count: 0 };
      h2hAccum += bucket.h2h;
      mentariAccum += bucket.mentari;
      count += bucket.count;
      days.push({ date, month, h2h: bucket.h2h, mentari: bucket.mentari, total: bucket.h2h + bucket.mentari, count: bucket.count, h2hAccum, mentariAccum, totalAccum: h2hAccum + mentariAccum });
    }
    monthsSummary.push({ month, h2h: h2hAccum, mentari: mentariAccum, total: h2hAccum + mentariAccum, count });
  }
  const loketRows = [...byLoket.values()]
    .map((entry) => ({ ...entry, total: entry.h2h + entry.mentari }))
    .sort((a, b) => b.total - a.total);
  const totals = monthsSummary.reduce((sum, month) => ({
    h2h: sum.h2h + month.h2h,
    mentari: sum.mentari + month.mentari,
    total: sum.total + month.total,
    count: sum.count + month.count,
  }), { h2h: 0, mentari: 0, total: 0, count: 0 });
  return { status: 200, body: { months: window.months, days, monthsSummary, lokets: loketRows, totals } };
}

export async function handleFeeAudit(method: string, pathname: string, search: string, caller: Caller, env: LedgerEnv) {
  if (caller.role !== "super_admin") return { status: 403, body: { error: "Rincian fee hanya untuk Super Admin." } };
  if (!env.supabaseUrl || !env.serviceRoleKey) return { status: 500, body: { error: "Konfigurasi database belum lengkap." } };
  if (pathname === "/api/fee-audit/sync" && method === "POST") {
    const checked = await syncOpenNetworkSales(env, true);
    return { status: 200, body: { checked } };
  }
  if (pathname === "/api/fee-report" && method === "GET") return feeReport(env);
  if (pathname !== "/api/fee-audit" || method !== "GET") return null;
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const month = monthWindow(query.get("month") || "") ? query.get("month") || "" : currentMonth();
  const window = monthWindow(month);
  if (!window) return { status: 400, body: { error: "Periode bulan tidak valid." } };
  const status = query.get("status") || "success";
  const product = (query.get("product") || "").trim().slice(0, 80);
  const loketId = (query.get("loket") || "").trim();
  const params = new URLSearchParams();
  params.set("select", "id,user_id,product_name_snapshot,category_slug_snapshot,customer_number,customer_name,amount,cost_price,sell_price,profit,status,created_at,provider_response");
  params.set("channel", "eq.production");
  params.set("created_at", `gte.${window.start}`);
  params.append("created_at", `lt.${window.end}`);
  params.set("order", "created_at.desc");
  params.set("limit", "800");
  if (status && status !== "semua") params.set("status", `eq.${status}`);
  if (/^[0-9a-f-]{36}$/i.test(loketId)) params.set("user_id", `eq.${loketId}`);
  if (product) params.set("product_name_snapshot", `ilike.*${product.replace(/[%*,()]/g, "")}*`);
  const [stored, lokets] = await Promise.all([readRows(env, params), loketDirectory(env)]);
  if (!stored.ok) return { status: 502, body: { error: "Rincian transaksi belum dapat dibaca." } };
  const names = new Map(lokets.map((loket) => [loket.id, loket]));
  const rows = stored.rows.map((row) => {
    const meta = row.provider_response ?? {};
    const parts = splitFee({
      amount: Number(row.amount) || 0,
      tagihan: Number(meta.tagihan) || 0,
      denda: Number(meta.denda) || 0,
      providerCost: Number(meta.providerCost) || Number(row.cost_price) || 0,
      providerAdmin: Number(meta.providerAdmin) || 0,
      profit: Number(row.profit) || 0,
      status: row.status,
    });
    const loket = names.get(row.user_id);
    return {
      id: row.id,
      at: row.created_at,
      loketId: row.user_id,
      loketName: loket ? loket.name : "Loket",
      loketCode: loket?.code || "",
      product: row.product_name_snapshot,
      category: row.category_slug_snapshot,
      customerNumber: row.customer_number,
      customerName: row.customer_name || "",
      status: row.status,
      sn: displayToken(meta.sn || "") || meta.sn || "",
      ...parts,
    };
  });
  const settled = rows.filter((row) => row.status === "success");
  const totals = settled.reduce((sum, row) => ({
    count: sum.count + 1,
    nominal: sum.nominal + row.nominal,
    modal: sum.modal + row.modal,
    h2hFee: sum.h2hFee + row.h2hFee,
    mentariFee: sum.mentariFee + row.mentariFee,
    amount: sum.amount + row.amount,
  }), { count: 0, nominal: 0, modal: 0, h2hFee: 0, mentariFee: 0, amount: 0 });
  return { status: 200, body: { month, rows, totals, lokets } };
}
