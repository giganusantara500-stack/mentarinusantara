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

export async function handleFeeAudit(method: string, pathname: string, search: string, caller: Caller, env: LedgerEnv) {
  if (caller.role !== "super_admin") return { status: 403, body: { error: "Rincian fee hanya untuk Super Admin." } };
  if (!env.supabaseUrl || !env.serviceRoleKey) return { status: 500, body: { error: "Konfigurasi database belum lengkap." } };
  if (pathname === "/api/fee-audit/sync" && method === "POST") {
    const checked = await syncOpenNetworkSales(env);
    return { status: 200, body: { checked } };
  }
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
