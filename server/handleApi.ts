import type { IncomingMessage, ServerResponse } from "node:http";
import { createNetworkAccount, requestPasswordReset, resetAccountPassword, type CreateAccountInput } from "./createAccount";
import { digiflazzReady } from "./digiflazz";
import { handleBillerRequest, handleDigiflazzCallback } from "./biller";
import { handleDepositRequest, loadCaller } from "./deposits";
import { handleFeeAudit } from "./feeAudit";
import { importLegacyLedger } from "./ledgerSync";
import { handleOpsRequest } from "./ops";
import { allocateBalance, assignOwnRole, getUserDetail, listAccounts, sessionProfile, updateUserDetails } from "./accountAdmin";

export interface ApiEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  resendApiKey?: string;
  emailFrom?: string;
  senderName?: string;
  senderEmail?: string;
  supportEmail?: string;
}

export function apiEnvFrom(source: Record<string, string | undefined>): ApiEnv {
  return {
    supabaseUrl: source.VITE_SUPABASE_URL || source.SUPABASE_URL || "",
    anonKey: source.VITE_SUPABASE_ANON_KEY || source.SUPABASE_ANON_KEY || "",
    serviceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY || "",
    resendApiKey: source.RESEND_API_KEY,
    emailFrom: source.EMAIL_FROM_ADDRESS,
    senderName: source.SENDER_NAME,
    senderEmail: source.SENDER_EMAIL,
    supportEmail: source.SUPPORT_EMAIL,
  };
}

export async function handleApi(input: {
  method: string;
  pathname: string;
  search?: string;
  authorization: string;
  callbackSecret?: string;
  body: Record<string, unknown>;
  env: ApiEnv;
}) {
  const { env } = input;
  if (input.method === "POST" && input.pathname === "/api/loket-sales") {
    const product = typeof input.body.product === "string" ? input.body.product.trim() : "";
    const ref = typeof input.body.clientRef === "string" ? input.body.clientRef : "";
    const tail = ref.replace(/[^a-z0-9]/gi, "").slice(-6) || "------";
    console.log(`[bayar] diterima ${product || "transaksi"} ref···${tail}`);
  }
  if (!env.supabaseUrl || !env.anonKey || !env.serviceRoleKey) {
    return { status: 500, body: { error: "Konfigurasi Supabase di hosting belum lengkap." } };
  }
  await importLegacyLedger(env);
  return routeApi(input);
}

async function routeApi(input: {
  method: string;
  pathname: string;
  search?: string;
  authorization: string;
  callbackSecret?: string;
  body: Record<string, unknown>;
  env: ApiEnv;
}) {
  const { method, pathname, authorization, body, env } = input;
  if (pathname === "/api/health" && method === "GET") {
    return { status: 200, body: { ok: true, digiflazz: digiflazzReady(), testing: (process.env.DIGIFLAZZ_TESTING || "").trim().toLowerCase() === "true" } };
  }
  if (method === "POST" && (pathname === "/api/digiflazz/callback" || pathname.startsWith("/api/digiflazz/callback/"))) {
    return handleDigiflazzCallback(method, pathname, body, input.callbackSecret || "", env);
  }
  if (pathname === "/api/me" && method === "GET") return sessionProfile(authorization, env);
  if (pathname === "/api/assign-role" && method === "POST") return assignOwnRole(authorization, String(body.role ?? ""), env);
  if (pathname === "/api/create-account" && method === "POST") return createNetworkAccount(authorization, body as CreateAccountInput, env);
  if (pathname === "/api/forgot-password" && method === "POST") return requestPasswordReset(String(body.email ?? ""), env);
  if (pathname === "/api/accounts" && method === "GET") return listAccounts(authorization, env);
  if (pathname === "/api/user-detail" && method === "GET") {
    const id = new URLSearchParams(input.search ?? "").get("id") ?? "";
    return getUserDetail(authorization, id, env);
  }
  if (pathname === "/api/update-account" && method === "POST") return updateUserDetails(authorization, body, env);
  if (pathname === "/api/allocate" && method === "POST") return allocateBalance(authorization, String(body.userId ?? ""), Number(body.amount), env);
  if (pathname === "/api/reset-password" && method === "POST") return resetAccountPassword(authorization, String(body.userId ?? ""), env);
  const caller = await loadCaller(authorization, env);
  if (caller && (pathname === "/api/fee-audit" || pathname === "/api/fee-audit/sync")) {
    const audit = await handleFeeAudit(method, pathname, input.search || "", caller, env);
    if (audit) return audit;
  }
  if (caller) {
    const biller = await handleBillerRequest(method, pathname, body, caller.id, env);
    if (biller) return biller;
    const ops = await handleOpsRequest(method, pathname, body, caller, authorization, env);
    if (ops) return ops;
  }
  if (!caller) return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };
  const deposit = await handleDepositRequest(method, pathname, body, caller, env, authorization);
  if (!deposit) return { status: 404, body: { error: "Permintaan tidak dikenali." } };
  return deposit;
}

export async function handleNodeApi(req: IncomingMessage, res: ServerResponse, env: ApiEnv) {
  const url = new URL(req.url ?? "", "http://localhost");
  const chunks: Buffer[] = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
  }
  let body: Record<string, unknown> = {};
  if (chunks.length > 0) {
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Format data tidak valid." }));
      return;
    }
  }
  const secretHeader = req.headers["x-callback-secret"];
  const result = await handleApi({
    method: req.method ?? "GET",
    pathname: url.pathname,
    search: url.search,
    authorization: req.headers.authorization ?? "",
    callbackSecret: Array.isArray(secretHeader) ? secretHeader[0] : secretHeader ?? "",
    body,
    env,
  });
  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(result.body));
}
