import { supabase } from "@/lib/supabase";

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

async function invokeBody(data: unknown, error: unknown) {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const parsed = await context.json();
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* respons fungsi bukan JSON */
    }
  }
  const message = error instanceof Error ? error.message : "";
  return { error: message || "Fungsi tiket deposit tidak dapat dihubungi." };
}

async function invokeDeposit(action: string, payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("deposit-ticket", { body: { ...payload, action } });
  const body = await invokeBody(data, error);
  const status = typeof body.status === "number" ? body.status : body.error ? 400 : 200;
  return { ok: status < 400 && !body.error, status, body };
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
    /* hosting statis atau koneksi putus: lanjut ke fungsi Supabase */
  }
  const decision = action === "decide" ? String(payload.action ?? "") : "";
  return invokeDeposit(action, action === "decide" ? { ...payload, decision } : payload);
}
