// Edge Function: setup-first-superadmin
//
// Penyiapan akun Super Admin pertama. Hanya berhasil jika belum ada Super Admin aktif.
// Dilindungi secret FIRST_SUPERADMIN_BOOTSTRAP_TOKEN. Kebijakan password mengikuti
// Supabase Auth. Jika pembuatan profil gagal, akun Auth yang baru dibuat dihapus
// kembali agar tidak tersisa akun setengah jadi.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FUNCTION_VERSION = "2026-11-03-diag-v2";
const PRESET_EMAIL = "gigamentarinusantara@gmail.com";
const PRESET_NAME = "Giga Mentari Nusantara Super Admin";
const PRESET_USERNAME = "giganusantara";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Metode tidak diizinkan." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const bootstrapToken = (Deno.env.get("FIRST_SUPERADMIN_BOOTSTRAP_TOKEN") ?? "").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server belum dikonfigurasi dengan benar." }, 500);
    }
    if (!bootstrapToken) {
      return json({
        error: "Secret FIRST_SUPERADMIN_BOOTSTRAP_TOKEN belum dibuat di server.",
        diagnostics: { FUNCTION_VERSION, SECRET_CONFIGURED: false },
      }, 500);
    }

    const body = (await req.json().catch(() => null)) as {
      bootstrap_token?: string;
      password?: string;
      full_name?: string;
    } | null;
    const bootstrapTokenInput = (body?.bootstrap_token ?? "").trim();
    const password = body?.password ?? "";
    const fullName = (body?.full_name ?? "").trim() || PRESET_NAME;

    if (bootstrapTokenInput !== bootstrapToken) {
      return json({ error: "Token bootstrap tidak valid." }, 401);
    }
    if (!password) {
      return json({ error: "Password wajib diisi." }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: existing, error: existErr } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("role", "super_admin")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (existErr) {
      return json({ error: "Gagal memeriksa Super Admin yang ada." }, 500);
    }
    if (existing) {
      return json({
        error: "Super Admin sudah ada. Bootstrap tidak dapat dijalankan lagi.",
      }, 409);
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: PRESET_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createErr || !created?.user) {
      const msg = (createErr?.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) {
        return json({
          error: "Akun dengan email ini sudah terdaftar tetapi belum berperan Super Admin. Hubungi pengelola untuk memperbaikinya.",
        }, 409);
      }
      if (msg.includes("password")) {
        return json({
          error: "Password ditolak oleh kebijakan Supabase Auth: " + (createErr?.message ?? ""),
        }, 400);
      }
      return json({ error: "Gagal membuat akun: " + (createErr?.message ?? "tidak diketahui") }, 500);
    }

    const userId = created.user.id;
    const payload: Record<string, unknown> = {
      id: userId,
      email: PRESET_EMAIL,
      full_name: fullName,
      username: PRESET_USERNAME,
      role: "super_admin",
      status: "active",
      must_change_password: false,
    };
    let profile: { id: string; role: string } | null = null;
    let profErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const saved = await supabase.from("profiles").upsert(payload, { onConflict: "id" }).select("id, role").maybeSingle();
      profile = saved.data;
      profErr = saved.error;
      if (!saved.error && saved.data?.role === "super_admin") break;
      const missing = saved.error?.message.match(/'([^']+)' column/)?.[1]
        || saved.error?.message.match(/column "([^"]+)"/)?.[1]
        || "";
      if (missing && missing in payload && missing !== "id" && missing !== "role") {
        delete payload[missing];
        continue;
      }
      break;
    }

    if (profErr || !profile || profile.role !== "super_admin") {
      await supabase.auth.admin.deleteUser(userId);
      return json({
        error: "Pembuatan profil Super Admin gagal sehingga akun dibatalkan. Coba lagi.",
      }, 500);
    }

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action: "bootstrap_super_admin",
      target_type: "profile",
      target_id: userId,
      details: { email: PRESET_EMAIL, full_name: fullName, method: "bootstrap" },
    });

    return json({
      success: true,
      message: "Akun Super Admin berhasil dibuat. Silakan login.",
    });
  } catch (err) {
    console.error("setup-first-superadmin error", err);
    return json({ error: "Terjadi kesalahan pada server." }, 500);
  }
});
