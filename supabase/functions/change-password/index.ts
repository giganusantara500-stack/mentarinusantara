// Edge Function: change-password
//
// Memperbarui password pengguna yang sedang login.
// Menggunakan RPC admin_set_user_password yang menulis bcrypt hash langsung
// ke auth.users, melewati pipeline GoTrue sehingga TIDAK ada cek HIBP /
// "password is known to be weak". Mitra dapat menggunakan password angka
// sederhana (minimal 6 digit).
// Setelah password berhasil diubah, flag must_change_password diturunkan.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server belum dikonfigurasi dengan benar." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sesi tidak valid. Silakan login ulang." }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return json({ error: "Sesi tidak valid. Silakan login ulang." }, 401);
    }
    const userId = userData.user.id;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Data tidak terbaca." }, 400);

    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 6) {
      return json({ error: "Password minimal 6 karakter." }, 400);
    }

    const { error: rpcErr } = await admin.rpc("admin_set_user_password", {
      p_user_id: userId,
      p_password: password,
    });
    if (rpcErr) {
      return json({ error: `Gagal mengubah password: ${rpcErr.message}` }, 500);
    }

    await admin.from("profiles").update({ must_change_password: false }).eq("id", userId);

    return json({ success: true, message: "Password berhasil diubah." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan server tidak diketahui.";
    return json({ error: message }, 500);
  }
});
