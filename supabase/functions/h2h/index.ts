// Kerangka H2H. Kredensial hanya dibaca dari environment fungsi ini.
// Browser tidak pernah menerima nilai secret.

import { createClient } from "npm:@supabase/supabase-js@2";

function corsHeaders(req?: Request) {
  const requested = req?.headers.get("Access-Control-Request-Headers");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": requested || "authorization, apikey, content-type, x-client-info, x-h2h-callback-secret, x-h2h-signature",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const SECRET_KEY = /secret|password|token|api[_-]?key|authorization|signature/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value ?? null;
}

function endpointParts(raw: string) {
  try {
    const url = new URL(raw);
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: "", path: "" };
  }
}

function credentials() {
  return {
    baseUrl: clean(Deno.env.get("H2H_BASE_URL")),
    partnerId: clean(Deno.env.get("H2H_PARTNER_ID")),
    apiKey: clean(Deno.env.get("H2H_API_KEY")),
    apiSecret: clean(Deno.env.get("H2H_API_SECRET")),
    callbackUrl: clean(Deno.env.get("H2H_CALLBACK_URL")),
    callbackSecret: clean(Deno.env.get("H2H_CALLBACK_SECRET")),
    enabled: clean(Deno.env.get("H2H_ENABLED")).toLowerCase() === "true",
  };
}

function ready(config: ReturnType<typeof credentials>) {
  return Boolean(config.baseUrl && config.partnerId && config.apiKey && config.apiSecret && config.callbackUrl && config.callbackSecret);
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders(req) });
  if (req.method !== "POST") return json({ error: "Metode tidak didukung." }, 405, req);

  const respond = (obj: unknown, status = 200) => json(obj, status, req);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) return respond({ error: "Konfigurasi Supabase pada fungsi H2H belum lengkap." }, 500);

  const raw = await req.text();
  const body = raw ? await Promise.resolve().then(() => JSON.parse(raw) as Record<string, unknown>).catch(() => null) : {};
  if (body === null) return respond({ error: "Isi permintaan tidak valid." }, 400);

  const config = credentials();
  const callbackHeader = clean(req.headers.get("x-h2h-callback-secret"));
  const isCallback = Boolean(callbackHeader) || new URL(req.url).pathname.endsWith("/callback");
  const admin = createClient(url, service);

  if (isCallback) {
    if (!config.callbackSecret || !safeEqual(callbackHeader, config.callbackSecret)) {
      return respond({ error: "Callback H2H ditolak." }, 401);
    }
    const signature = clean(req.headers.get("x-h2h-signature")).toLowerCase();
    if (signature) {
      if (!config.apiSecret) return respond({ error: "Callback H2H ditolak." }, 401);
      const expected = await hmacHex(config.apiSecret, raw);
      if (!safeEqual(signature, expected)) return respond({ error: "Callback H2H ditolak." }, 401);
    }
    const providerStatus = clean(body.status) || clean(body.rc) || clean(body.providerStatus);
    const result = await admin.rpc("h2h_service", {
      p_action: "apply_callback",
      p_payload: {
        refId: clean(body.ref_id) || clean(body.refId),
        providerStatus,
        providerReference: clean(body.provider_reference) || clean(body.providerReference) || clean(body.sn),
        note: clean(body.message) || clean(body.note),
        signatureChecked: Boolean(signature),
        payload: redact(body),
      },
    });
    if (result.error) return respond({ error: "Callback H2H gagal dicatat." }, 500);
    const data = (result.data ?? {}) as { error?: string; status?: number; transaction?: unknown; duplicate?: boolean };
    if (data.error) return respond({ error: data.error }, data.status || 400);
    return respond({ ok: true, duplicate: Boolean(data.duplicate), transaction: data.transaction });
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const userResult = await userClient.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return respond({ error: "Sesi tidak valid. Silakan login ulang." }, 401);

  const action = clean(body.action) || "list";
  if (action === "status") {
    const profile = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = clean(profile.data?.role).toLowerCase().replace(/[\s-]+/g, "_");
    if (role !== "super_admin" && role !== "superadmin") {
      return respond({ error: "Status koneksi H2H hanya dapat dibuka Super Admin." }, 403);
    }
    return respond({
      enabled: config.enabled,
      ready: ready(config),
      fields: {
        baseUrl: Boolean(config.baseUrl),
        partnerId: Boolean(config.partnerId),
        apiKey: Boolean(config.apiKey),
        apiSecret: Boolean(config.apiSecret),
        callbackUrl: Boolean(config.callbackUrl),
        callbackSecret: Boolean(config.callbackSecret),
      },
    });
  }

  const rpcAction = action === "save-product" ? "save_product" : action;
  if (!["products", "save_product", "prepare", "list", "logs"].includes(rpcAction)) {
    return respond({ error: "Aksi H2H tidak dikenali." }, 404);
  }
  const payload = {
    sku: body.sku,
    name: body.name,
    category: body.category,
    costPrice: body.costPrice,
    active: body.active,
    refId: body.refId,
    customerNumber: body.customerNumber,
    amount: body.amount,
  };
  const result = await userClient.rpc("h2h_api", { p_action: rpcAction, p_payload: payload });
  if (result.error) return respond({ error: "Permintaan H2H gagal diproses." }, 500);
  const data = (result.data ?? {}) as {
    error?: string;
    status?: number;
    duplicate?: boolean;
    transaction?: { id?: string; refId?: string; actorId?: string; actorRole?: string; sku?: string; customerNumber?: string; amount?: number; status?: string };
    products?: unknown;
    requests?: unknown;
    callbacks?: unknown;
    product?: unknown;
  };
  if (data.error) return respond({ error: data.error }, data.status || 400);
  if (rpcAction !== "prepare" || !data.transaction) return respond(data);

  const transaction = data.transaction;
  if (data.duplicate) return respond({ transaction, duplicate: true, dispatch: "existing" });

  const target = endpointParts(config.baseUrl);
  const outbound = {
    ref_id: transaction.refId,
    sku: transaction.sku,
    customer_number: transaction.customerNumber,
    amount: transaction.amount,
  };
  let outcome: "skipped" | "sent" | "error" = "skipped";
  let httpStatus: number | null = null;
  let responseBody: unknown = null;
  let errorText = "";
  const canSend = config.enabled && ready(config);

  if (canSend) {
    try {
      const requestText = JSON.stringify({ partner_id: config.partnerId, ...outbound });
      const signature = await hmacHex(config.apiSecret, requestText);
      const response = await fetch(config.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": config.apiKey,
          "X-Signature": signature,
        },
        body: requestText,
        signal: AbortSignal.timeout(15000),
      });
      httpStatus = response.status;
      const responseText = await response.text();
      try {
        responseBody = responseText ? redact(JSON.parse(responseText)) : null;
      } catch {
        responseBody = responseText ? redact(responseText) : null;
      }
      outcome = response.ok ? "sent" : "error";
      if (!response.ok) errorText = `Provider menjawab ${response.status}.`;
    } catch {
      outcome = "error";
      errorText = "Provider tidak terjangkau. Transaksi tetap pending dan tidak dikirim ulang.";
    }
  }

  await admin.rpc("h2h_service", {
    p_action: "log_request",
    p_payload: {
      transactionId: transaction.id,
      refId: transaction.refId,
      actorId: transaction.actorId,
      host: target.host,
      path: target.path,
      outcome,
      httpStatus,
      request: redact(outbound),
      response: responseBody,
      error: errorText,
    },
  });

  const privileged = transaction.actorRole === "super_admin";
  return respond({
    transaction,
    duplicate: false,
    dispatch: outcome === "skipped" && !privileged ? "queued" : outcome,
    ...(privileged && !canSend ? { reason: config.enabled ? "credentials" : "disabled" } : {}),
    ...(errorText && privileged ? { error: errorText } : {}),
  });
});
