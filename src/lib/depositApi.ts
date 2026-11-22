import { supabase } from "@/lib/supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface DepositApiResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

function looksLikeApiJson(text: string) {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") || trimmed.startsWith("[")) && !/<!doctype|<html/i.test(trimmed);
}

export function depositErrorText(status: number, body: Record<string, unknown>, fallback: string) {
  const raw = String(body.error || body.message || body.details || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (raw) return raw;
  if (status === 405) return "Hosting menolak pembuatan tiket (405). API deposit tidak berjalan pada domain ini.";
  if (status === 401) return "Sesi login berakhir. Masuk kembali, lalu buat tiket.";
  if (status === 409) return "Masih ada tiket deposit yang menunggu keputusan.";
  return status ? `${fallback} (HTTP ${status}).` : fallback;
}

function missingDatabaseFunction(error: { message?: string; code?: string; details?: string } | null) {
  const text = `${error?.message ?? ""} ${error?.code ?? ""} ${error?.details ?? ""}`;
  return /schema cache|could not find the function|PGRST202/i.test(text);
}

async function saveViaDatabase(action: string, payload: Record<string, unknown>): Promise<DepositApiResult | null> {
  const { data, error } = await supabase.rpc("own_deposit_request", { p_action: action, p_payload: payload });
  if (error) {
    if (missingDatabaseFunction(error)) return null;
    return { ok: false, status: 400, body: { error: [error.message, error.details].filter(Boolean).join(" — ") } };
  }
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const status = typeof body.status === "number" ? body.status : body.error ? 400 : 200;
  return { ok: status < 400 && !body.error, status, body };
}

async function invokeDeposit(action: string, token: string, payload: Record<string, unknown>): Promise<DepositApiResult> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, status: 500, body: { error: "Alamat Supabase belum dikonfigurasi di aplikasi." } };
  }
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/deposit-ticket`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...payload, action }),
    });
  } catch {
    return { ok: false, status: 0, body: { error: "Fungsi deposit-ticket belum terpasang di Supabase, jadi permintaan tidak sampai ke server." } };
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (looksLikeApiJson(text)) {
    body = JSON.parse(text) as Record<string, unknown>;
  } else if (response.status === 404) {
    body = { error: "Fungsi deposit-ticket belum di-deploy ke Supabase." };
  } else {
    body = { error: `Fungsi deposit-ticket membalas HTTP ${response.status}.` };
  }
  if (!body.error && !response.ok) body = { ...body, error: `Fungsi deposit-ticket menolak permintaan (HTTP ${response.status}).` };
  return { ok: response.ok && !body.error, status: response.status, body };
}

export async function depositRequest(path: string, method: "GET" | "POST", token: string, payload: Record<string, unknown> = {}): Promise<DepositApiResult> {
  const action = path.endsWith("/cancel") ? "cancel" : path.endsWith("/claim") ? "claim" : path.endsWith("/decide") ? "decide" : method === "GET" ? "list" : "create";
  try {
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(payload) : undefined,
    });
    const text = await response.text();
    if (looksLikeApiJson(text) && response.status !== 405) {
      const body = JSON.parse(text) as Record<string, unknown>;
      return { ok: response.ok && !body.error, status: response.status, body };
    }
  } catch {
    /* hosting statis atau koneksi putus: lanjut ke database */
  }
  const dbPayload = action === "decide" ? { id: payload.id, decision: payload.action } : payload;
  const saved = await saveViaDatabase(action, dbPayload);
  if (saved) return saved;
  return invokeDeposit(action, token, action === "decide" ? { ...payload, decision: String(payload.action ?? "") } : payload);
}
