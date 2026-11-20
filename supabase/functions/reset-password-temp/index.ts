// Edge Function: reset-password-temp
//
// Alur reset password dengan kode sandi sementara:
// 1. Menerima email pengguna dari frontend.
// 2. Memastikan pemanggil login, lalu menolak target di luar hak aksesnya.
//    Super Admin: akun mana pun. Mitra: Sub Mitra/Loket di jaringannya.
//    Sub Mitra: Loket di bawahnya. Loket: tidak boleh mereset akun lain.
// 3. Mencari user di profiles berdasarkan email.
// 4. Membuat kode sandi sementara acak (tepat 6 digit angka).
// 5. Memperbarui password lewat RPC admin_set_user_password dengan JWT pemanggil.
// 6. Mengirim email "Password Baru Anda" ke pengguna via Resend API.
// 7. Menandai must_change_password = true agar pengguna wajib ganti password setelah login.
//
// TIDAK menggunakan supabase.auth.resetPasswordForEmail. Semua dilakukan via service_role.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function generateTempPassword(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 10).toString()).join("");
}

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  is_active: boolean | null;
}

interface AccessProfile {
  id: string;
  role: string;
  parent_id: string | null;
  created_by: string | null;
  is_active: boolean | null;
}

function deliverableEmail(...candidates: string[]) {
  for (const value of candidates) {
    const email = value.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) continue;
    if (email.endsWith("@loket.local") || email.endsWith("@gigamentarinusantara.id")) continue;
    return email;
  }
  return "";
}

function asProfile(row: {
  id: string;
  username?: string | null;
  role?: string | null;
  is_active?: boolean | null;
}, authEmail = "", fullName = ""): ProfileRow {
  const active = row.is_active !== false;
  return {
    id: row.id,
    email: authEmail,
    full_name: fullName || row.username || "Pengguna",
    role: clean(row.role),
    status: active ? "active" : "suspended",
    is_active: row.is_active ?? null,
  };
}

async function findProfileById(admin: SupabaseClient, id: string): Promise<(ProfileRow & { deliverTo: string }) | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, username, role, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const authUser = await admin.auth.admin.getUserById(id);
  const user = authUser.data.user;
  const meta = (user?.user_metadata ?? {}) as { contact_email?: string; full_name?: string };
  const contact = clean(meta.contact_email);
  const authEmail = clean(user?.email);
  const row = asProfile(data, authEmail, clean(meta.full_name));
  return { ...row, deliverTo: deliverableEmail(contact) || contact || authEmail };
}

async function findProfileByEmail(admin: SupabaseClient, email: string): Promise<ProfileRow | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, username, role, is_active, email")
    .eq("email", email)
    .limit(1);
  if (error || !data?.length) return null;
  const row = data[0] as { id: string; username?: string | null; role?: string | null; is_active?: boolean | null; email?: string | null };
  return asProfile(row, clean(row.email), clean(row.username));
}

async function findAccount(admin: SupabaseClient, email: string): Promise<(ProfileRow & { deliverTo: string }) | null> {
  const direct = await findProfileByEmail(admin, email);
  if (direct) {
    return { ...direct, deliverTo: deliverableEmail(email, direct.email) || email };
  }
  for (let page = 1; page <= 8; page++) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error || !listed.data) break;
    const users = listed.data.users ?? [];
    const match = users.find((user) => {
      const authEmail = clean(user.email).toLowerCase();
      const contact = clean((user.user_metadata as { contact_email?: string } | undefined)?.contact_email).toLowerCase();
      return authEmail === email || contact === email;
    });
    if (match) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id, username, role, is_active")
        .eq("id", match.id)
        .limit(1);
      const contact = clean((match.user_metadata as { contact_email?: string } | undefined)?.contact_email);
      const named = clean((match.user_metadata as { full_name?: string } | undefined)?.full_name);
      const row = profile?.[0]
        ? asProfile(profile[0], clean(match.email), named)
        : asProfile({
          id: match.id,
          username: named || "Pengguna",
          role: clean((match.user_metadata as { role?: string } | undefined)?.role),
          is_active: true,
        }, clean(match.email), named);
      return { ...row, deliverTo: deliverableEmail(email, contact, row.email) || email };
    }
    if (users.length < 200) break;
  }
  return null;
}

function mailIdentity() {
  const senderName = (Deno.env.get("SENDER_NAME") || "Mentari Nusantara").trim() || "Mentari Nusantara";
  const senderEmail = (Deno.env.get("SENDER_EMAIL") || Deno.env.get("EMAIL_FROM_ADDRESS") || "").trim();
  const supportEmail = (Deno.env.get("SUPPORT_EMAIL") || "").trim();
  return { senderName, senderEmail, supportEmail };
}

function fromHeader(senderName: string, senderEmail: string) {
  return `${senderName} <${senderEmail}>`;
}

function temporaryPasswordMessage(input: {
  senderName: string;
  name: string;
  password: string;
  email?: string;
  supportEmail?: string;
}) {
  const name = input.name.trim() || "Pengguna";
  const help = input.supportEmail
    ? `Jika Anda tidak meminta email ini atau mengalami kendala, hubungi ${input.supportEmail}.`
    : `Jika Anda tidak meminta email ini atau mengalami kendala, hubungi administrator ${input.senderName}.`;
  const intro = `Permintaan reset password akun ${input.senderName} Anda sudah diproses. Berikut password sementara yang baru.`;
  const identity = [
    ["Nama", name],
    ["Email", input.email?.trim() || ""],
  ].filter((row) => row[1]);
  const identityHtml = identity.map(([label, value]) =>
    `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:110px;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(value)}</td></tr>`,
  ).join("");
  const html = `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background-color:#1e3a5f;padding:28px 32px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#ffffff;">${escapeHtml(input.senderName)}</div>
              <div style="font-size:11px;color:#cbd5e1;letter-spacing:1.5px;margin-top:6px;">PASSWORD SEMENTARA</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Password Baru Anda</h1>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#475569;">Halo <strong>${escapeHtml(name)}</strong>,<br>${escapeHtml(intro)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${identityHtml}</table>
              <div style="background-color:#f8fafc;border:2px solid #1e3a5f;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
                <div style="font-size:12px;color:#64748b;letter-spacing:1px;margin-bottom:8px;">PASSWORD SEMENTARA</div>
                <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1e3a5f;font-family:'Courier New',Courier,monospace;">${escapeHtml(input.password)}</div>
              </div>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569;">Gunakan password di atas untuk login. Segera ganti dengan password baru milik Anda setelah berhasil masuk. Jangan membagikan password ini kepada siapa pun.</p>
              <div style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#92400e;"><strong>Masa berlaku:</strong> password sementara ini berlaku sampai Anda menggantinya setelah login. ${escapeHtml(help)}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;padding:18px 28px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.5;">Email ini dikirim oleh sistem ${escapeHtml(input.senderName)}. Mohon tidak membalas email ini.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = [
    `${input.senderName} — Password Baru Anda`,
    "",
    `Halo ${name},`,
    intro,
    ...identity.map(([label, value]) => `${label}: ${value}`),
    "",
    `Password sementara: ${input.password}`,
    "",
    "Gunakan password di atas untuk login. Segera ganti dengan password baru milik Anda setelah berhasil masuk.",
    `Masa berlaku: password sementara ini berlaku sampai Anda menggantinya setelah login. ${help}`,
  ].join("\n");
  return { html, text };
}

async function sendTempPasswordEmail(
  resendApiKey: string,
  toEmail: string,
  fullName: string,
  tempPassword: string,
): Promise<string | null> {
  const { senderName, senderEmail, supportEmail } = mailIdentity();
  if (!senderEmail.includes("@")) {
    return "Secret SENDER_EMAIL belum diisi di Edge Function Supabase. Email tidak dikirim.";
  }
  const message = temporaryPasswordMessage({
    senderName,
    name: fullName,
    password: tempPassword,
    email: toEmail,
    supportEmail,
  });
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader(senderName, senderEmail),
        to: [toEmail],
        subject: "Password Baru Anda",
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return `Pengiriman email ditolak (${res.status}). ${errText.slice(0, 280)}`;
    }
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Layanan email tidak dapat dihubungi.";
    return detail;
  }
}

async function loadAccessProfile(admin: SupabaseClient, id: string): Promise<AccessProfile | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, role, parent_id, created_by, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as AccessProfile;
}

async function targetIsInNetwork(admin: SupabaseClient, ancestorId: string, target: AccessProfile) {
  let parentId = target.parent_id;
  const seen = new Set<string>();
  for (let depth = 0; depth < 12 && parentId; depth++) {
    if (seen.has(parentId)) return false;
    if (parentId === ancestorId) return true;
    seen.add(parentId);
    const parent = await loadAccessProfile(admin, parentId);
    parentId = parent?.parent_id ?? null;
  }
  return false;
}

function canonRole(role: string) {
  const value = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "superadmin" || value === "super_admin") return "super_admin";
  if (value === "sub_mitra" || value === "submitra") return "submitra";
  if (value === "mitra" || value === "loket") return value;
  return value;
}

async function resetAllowed(admin: SupabaseClient, callerId: string, targetId: string) {
  if (!callerId || !targetId) return false;
  const caller = await loadAccessProfile(admin, callerId);
  const target = await loadAccessProfile(admin, targetId);
  if (!caller || !target) return false;
  const callerRole = canonRole(caller.role);
  const targetRole = canonRole(target.role);
  if (caller.is_active === false) return false;
  if (callerRole === "super_admin") return true;
  if (target.is_active === false) return false;
  if (callerRole === "mitra") {
    if (targetRole !== "submitra" && targetRole !== "loket") return false;
    if (await targetIsInNetwork(admin, caller.id, target)) return true;
    if (target.created_by === caller.id) return true;
    if (!target.created_by) return false;
    const creator = await loadAccessProfile(admin, target.created_by);
    return !!creator && (creator.id === caller.id || await targetIsInNetwork(admin, caller.id, creator));
  }
  if (callerRole === "submitra") {
    if (targetRole !== "loket") return false;
    if (target.created_by === caller.id) return true;
    return targetIsInNetwork(admin, caller.id, target);
  }
  return false;
}

function accessDenied(message: string) {
  return /akses ditolak/i.test(message);
}

async function applyTempPassword(admin: SupabaseClient, userClient: SupabaseClient, userId: string) {
  let lastError = "Password gagal diperbarui.";
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = generateTempPassword();
    const rpc = await userClient.rpc("admin_set_user_password", {
      p_user_id: userId,
      p_password: password,
    });
    if (!rpc.error) return { password, error: null as string | null };
    const rpcMessage = rpc.error.message || lastError;
    if (accessDenied(rpcMessage)) {
      return { password: "", error: "Anda tidak berhak mereset password akun ini." };
    }
    if (!/weak|easy to guess|pwned|hibp/i.test(rpcMessage)) {
      return { password: "", error: rpcMessage };
    }
    const updated = await admin.auth.admin.updateUserById(userId, { password });
    if (!updated.error) return { password, error: null as string | null };
    lastError = updated.error.message || rpcMessage;
    if (!/weak|easy to guess|pwned|hibp|password/i.test(lastError)) break;
  }
  return { password: "", error: lastError };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: "Server belum dikonfigurasi dengan benar." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sesi tidak valid. Silakan login ulang." }, 401);
    let callerId = "";
    try {
      const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
      if (callerErr || !callerData.user) {
        return json({ error: "Sesi tidak valid. Silakan login ulang." }, 401);
      }
      callerId = callerData.user.id;
    } catch {
      return json({ error: "Sesi tidak valid. Silakan login ulang." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Data tidak terbaca." }, 400);

    const email = clean(body.email).toLowerCase();
    const requestedId = clean(body.user_id || body.userId);
    if (!requestedId && !EMAIL_PATTERN.test(email)) {
      return json({ error: "Akun yang akan direset tidak dikenali." }, 400);
    }

    const profile = (requestedId ? await findProfileById(admin, requestedId) : null)
      ?? (EMAIL_PATTERN.test(email) ? await findAccount(admin, email) : null);
    if (!profile) {
      return json({ error: "Akun tidak ditemukan." }, 404);
    }

    if (!(await resetAllowed(admin, callerId, profile.id))) {
      return json({ error: "Anda tidak berhak mereset password akun ini." }, 403);
    }

    const caller = await loadAccessProfile(admin, callerId);
    if (profile.is_active === false && canonRole(caller?.role || "") !== "super_admin") {
      return json({ error: "Akun ini dinonaktifkan. Hubungi administrator." }, 403);
    }

    const applied = await applyTempPassword(admin, userClient, profile.id);
    if (applied.error && accessDenied(applied.error)) {
      return json({ error: applied.error }, 403);
    }
    if (!applied.password) {
      return json({ error: applied.error || "Password gagal diperbarui." }, 422);
    }
    const tempPassword = applied.password;

    await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", profile.id)
      .then(() => undefined, () => undefined);

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    let emailError: string | null = null;
    const recipient = deliverableEmail(profile.deliverTo, email) || email;

    if (!resendApiKey) {
      emailError = "Secret RESEND_API_KEY belum tersedia di Edge Function Supabase. Password sementara tetap ditampilkan di layar.";
    } else if (!deliverableEmail(recipient)) {
      emailError = "Akun ini belum memiliki email terdaftar yang bisa menerima pesan. Password sementara tetap ditampilkan di layar.";
    } else {
      emailError = await sendTempPasswordEmail(resendApiKey, recipient, profile.full_name, tempPassword);
      emailSent = !emailError;
    }

    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "temp_password_reset",
      target_type: "profile",
      target_id: profile.id,
      details: { email: recipient, email_sent: emailSent },
    }).then(() => undefined, () => undefined);

    return json({
      success: true,
      email: recipient,
      temp_password: tempPassword,
      email_sent: emailSent,
      email_error: emailSent ? null : emailError,
      message: emailSent
        ? "Password sementara telah dikirim ke email terdaftar."
        : "Password sementara sudah dibuat, tetapi email belum terkirim.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan server tidak diketahui.";
    return json({ error: message, temp_password: null, email_sent: false }, 500);
  }
});
