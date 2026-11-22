// Tiket deposit untuk hosting statis. Browser memanggil fungsi ini bila
// POST /api/deposits tidak tersedia (misalnya 405 pada Cloudflare Workers).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEPOSIT_ACCOUNT = {
  bank: "BRI",
  accountNumber: "686601009504534",
  holder: "Aris Purwanto",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function canonRole(value: unknown) {
  const stored = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (stored === "super_admin" || stored === "superadmin") return "super_admin";
  if (stored === "mitra") return "mitra";
  if (stored === "submitra" || stored === "sub_mitra") return "submitra";
  if (stored === "loket" || stored === "role_loket") return "loket";
  return "";
}

function databaseMessage(error: { message?: string; details?: string; hint?: string; code?: string } | null) {
  const parts = [error?.message, error?.details, error?.hint, error?.code].map((part) => clean(part)).filter(Boolean);
  return parts.join(" — ") || "Database menolak permintaan tiket deposit.";
}

async function ledger(
  admin: SupabaseClient,
  action: string,
  actorId: string,
  payload: Record<string, unknown>,
) {
  const result = await admin.rpc("ledger_api", { p_action: action, p_actor: actorId, p_payload: payload });
  if (result.error) return { status: 500, body: { error: databaseMessage(result.error) } };
  const data = (result.data ?? {}) as { error?: string; status?: number; ticket?: unknown; tickets?: unknown; mutations?: unknown; balance?: number };
  if (data.error) return { status: data.status || 400, body: { error: data.error } };
  return { status: data.status || 200, body: data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) return json({ error: "Konfigurasi Supabase pada fungsi tiket belum lengkap." }, 500);

  const authorization = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const userResult = await userClient.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return json({ error: "Sesi tidak valid. Silakan login ulang." }, 401);

  const admin = createClient(url, service);
  const profileResult = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (profileResult.error) return json({ error: `Profil tidak terbaca: ${profileResult.error.message}` }, 500);
  const profile = (profileResult.data ?? null) as Record<string, unknown> | null;
  if (!profile || profile.is_active === false || profile.status === "suspended") {
    return json({ error: "Akun tidak aktif, jadi tiket deposit tidak dapat dibuat." }, 403);
  }
  const role = canonRole(profile.role) || canonRole(user.user_metadata?.role);
  if (!role) return json({ error: "Peran akun tidak dikenali, jadi tiket deposit tidak dapat dibuat." }, 403);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = clean(body.action) || "create";

  if (action === "list") {
    const [tickets, mutations, balance] = await Promise.all([
      ledger(admin, "tickets", user.id, {}),
      ledger(admin, "mutations", user.id, {}),
      ledger(admin, "balance", user.id, { userId: user.id }),
    ]);
    const failure = [tickets, mutations, balance].find((item) => item.status >= 400);
    if (failure) return json(failure.body, failure.status);
    return json({
      tickets: tickets.body.tickets ?? [],
      mutations: mutations.body.mutations ?? [],
      balance: balance.body.balance ?? 0,
      accounts: [DEPOSIT_ACCOUNT],
    });
  }

  if (action === "create") {
    if (!["loket", "mitra", "submitra"].includes(role)) {
      return json({ error: "Hanya Mitra, Sub Mitra, atau Loket yang dapat membuat tiket deposit." }, 403);
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 10000) return json({ error: "Nominal deposit minimal Rp10.000." }, 400);
    const bank = clean(body.bank) || DEPOSIT_ACCOUNT.bank;
    if (bank !== DEPOSIT_ACCOUNT.bank) return json({ error: "Rekening tujuan yang dipilih tidak dikenali." }, 400);
    const parentId = clean(profile.parent_id);
    const parent = parentId
      ? await admin.from("profiles").select("role,full_name,username").eq("id", parentId).maybeSingle()
      : null;
    const parentRow = (parent?.data ?? null) as Record<string, unknown> | null;
    const created = await ledger(admin, "create_ticket", user.id, {
      amount: Math.round(amount),
      bank: DEPOSIT_ACCOUNT.bank,
      accountNumber: DEPOSIT_ACCOUNT.accountNumber,
      accountHolder: DEPOSIT_ACCOUNT.holder,
      loketName: clean(profile.full_name) || clean(profile.username) || user.email || "Pemohon",
      loketCode: clean(profile.loket_code),
      route: "pusat",
      uplineName: parentRow ? (clean(parentRow.full_name) || clean(parentRow.username) || "Upline") : "Pusat",
      uplineRole: canonRole(parentRow?.role) || "super_admin",
    });
    if (created.status >= 400 || !created.body.ticket) {
      return json({ error: created.body.error || "Database tidak mengembalikan tiket deposit." }, created.status || 500);
    }
    return json({ ticket: created.body.ticket });
  }

  if (action === "cancel" || action === "claim" || action === "decide") {
    const id = clean(body.id);
    if (!id) return json({ error: "Tiket yang dipilih tidak ditemukan." }, 400);
    const decision = clean(body.decision);
    if (action === "decide" && !["approve", "cancel", "pending", "void"].includes(decision)) {
      return json({ error: "Aksi keputusan tiket tidak valid." }, 400);
    }
    const ledgerAction = action === "cancel" ? "cancel_ticket" : action === "claim" ? "claim_ticket" : "decide_ticket";
    const result = await ledger(admin, ledgerAction, user.id, action === "decide" ? { id, action: decision } : { id });
    if (result.status >= 400 || !result.body.ticket) {
      return json({ error: result.body.error || "Status tiket gagal diperbarui." }, result.status || 500);
    }
    return json({ ticket: result.body.ticket, balance: result.body.balance });
  }

  return json({ error: "Aksi tiket deposit tidak dikenali." }, 404);
});
