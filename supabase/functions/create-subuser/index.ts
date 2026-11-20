// Edge Function: create-subuser
//
// Membuat akun Mitra, Sub Mitra, atau Loket di bawah jaringan pemanggil, lalu
// mengirim email password sementara dari Mentari Nusantara.
// Aksi tambahan:
// - "resend": kirim ulang password sementara untuk akun yang belum pernah login.
// - "update_email": ubah email akun target di Supabase Auth + profiles.
// - "reset_password": buat password sementara baru dan kirim email "Password Baru Anda".
// Pemanggil diverifikasi dari JWT, role dan hierarki diperiksa di server.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ROLES = ["mitra", "submitra", "loket"] as const;
type TargetRole = (typeof ROLES)[number];
const ALLOWED_TARGETS: Record<string, TargetRole[]> = {
  super_admin: ["mitra"],
  mitra: ["submitra", "loket"],
  submitra: ["loket"],
};
const PARENT_ROLES: Record<TargetRole, string[]> = {
  mitra: ["super_admin"],
  submitra: ["mitra"],
  loket: ["mitra", "submitra"],
};
const VALID_LOKET_TYPES = ["konter", "minimarket", "agen", "lainnya"];
const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL_PATTERN = /^https?:\/\/[^\s]+$/;
const DEFAULT_SENDER_NAME = "Mentari Nusantara";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface ProfileRow {
  id: string;
  role: string;
  status: string;
  parent_id: string | null;
  email: string;
  full_name: string;
  username: string | null;
  deleted_at: string | null;
}

async function loadProfile(admin: SupabaseClient, id: string): Promise<ProfileRow | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, role, status, parent_id, email, full_name, username, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Gagal membaca profil: ${error.message}`);
  return (data as ProfileRow) ?? null;
}

async function isInNetwork(admin: SupabaseClient, nodeId: string, ancestorId: string): Promise<boolean> {
  let currentId: string | null = nodeId;
  for (let depth = 0; depth < 6 && currentId; depth++) {
    if (currentId === ancestorId) return true;
    const node = await loadProfile(admin, currentId);
    currentId = node?.parent_id ?? null;
  }
  return false;
}

function generateTempPassword(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 10).toString()).join("");
}

function generateUsername(fullName: string): string {
  const base = fullName.toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8) || "mitra";
  const suffix = Math.floor(1000 + Math.random() * 9000).toString();
  return `${base}${suffix}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mailIdentity() {
  const senderName = (Deno.env.get("SENDER_NAME") || DEFAULT_SENDER_NAME).trim() || DEFAULT_SENDER_NAME;
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
  username?: string;
  email?: string;
  supportEmail?: string;
  kind: "registration" | "reset";
}) {
  const name = input.name.trim() || "Pengguna";
  const help = input.supportEmail
    ? `Jika Anda tidak meminta email ini atau mengalami kendala, hubungi ${input.supportEmail}.`
    : `Jika Anda tidak meminta email ini atau mengalami kendala, hubungi administrator ${input.senderName}.`;
  const intro = input.kind === "registration"
    ? `Akun ${input.senderName} Anda sudah dibuat. Berikut password sementara untuk masuk pertama kali.`
    : `Permintaan reset password akun ${input.senderName} Anda sudah diproses. Berikut password sementara yang baru.`;
  const identity = [
    ["Nama", name],
    ["Username", input.username?.trim() || ""],
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
  toEmail: string,
  fullName: string,
  tempPassword: string,
  kind: "registration" | "reset",
  username?: string,
): Promise<string | null> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return "RESEND_API_KEY belum dikonfigurasi. Email tidak terkirim.";
  }
  const { senderName, senderEmail, supportEmail } = mailIdentity();
  if (!senderEmail.includes("@")) {
    return "Secret SENDER_EMAIL belum diisi di Edge Function Supabase. Email tidak dikirim.";
  }
  const message = temporaryPasswordMessage({
    senderName,
    name: fullName,
    password: tempPassword,
    username,
    email: toEmail.endsWith("@loket.local") ? "" : toEmail,
    supportEmail,
    kind,
  });
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
    return `Resend API error (${res.status}): ${errText}`;
  }

  return null;
}

interface SetupResult { passwordError: string | null; emailError: string | null; tempPassword: string }

async function sendSetupEmail(admin: SupabaseClient, targetId: string, email: string, fullName: string, username?: string, kind: "registration" | "reset" = "reset"): Promise<SetupResult> {
  const tempPassword = generateTempPassword();
  const { error: rpcErr } = await admin.rpc("admin_set_user_password", {
    p_user_id: targetId,
    p_password: tempPassword,
  });
  if (rpcErr) return { passwordError: `Gagal memperbarui password: ${rpcErr.message}`, emailError: null, tempPassword };

  await admin.from("profiles").update({ must_change_password: true }).eq("id", targetId);

  const emailErr = await sendTempPasswordEmail(email, fullName, tempPassword, kind, username);
  return { passwordError: null, emailError: emailErr, tempPassword };
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
    const callerId = userData.user.id;

    const caller = await loadProfile(admin, callerId);
    if (!caller || caller.status !== "active" || caller.deleted_at) {
      return json({ error: "Akun pemanggil tidak aktif." }, 403);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Data formulir tidak terbaca." }, 400);

    const appUrl = clean(body.app_url).replace(/\/+$/, "");
    if (!APP_URL_PATTERN.test(appUrl)) {
      return json({ error: "Alamat aplikasi tidak valid." }, 400);
    }

    // --- Action: resend ---
    if (body.action === "resend") {
      const targetId = clean(body.user_id);
      const target = targetId ? await loadProfile(admin, targetId) : null;
      if (!target) return json({ error: "Pengguna tidak ditemukan." }, 404);
      if (target.deleted_at) return json({ error: "Akun sudah dihapus." }, 400);
      if (caller.role !== "super_admin" && !(await isInNetwork(admin, targetId, callerId))) {
        return json({ error: "Akun berada di luar jaringan Anda." }, 403);
      }
      const { data: authTarget, error: authErr } = await admin.auth.admin.getUserById(target.id);
      if (authErr || !authTarget.user) {
        return json({ error: "Akun autentikasi tidak ditemukan." }, 404);
      }
      if (authTarget.user.last_sign_in_at) {
        return json({ error: "Akun ini sudah pernah login. Gunakan fitur lupa password." }, 409);
      }
      const result = await sendSetupEmail(admin, target.id, target.email, target.full_name, target.username ?? undefined, "registration");
      if (result.passwordError) return json({ error: result.passwordError, email_sent: false }, 502);
      return json({ success: true, email_sent: !result.emailError, email_error: result.emailError, temp_password: result.tempPassword });
    }

    // --- Action: reset_password ---
    if (body.action === "reset_password") {
      const targetId = clean(body.user_id);
      const target = targetId ? await loadProfile(admin, targetId) : null;
      if (!target) return json({ error: "Pengguna tidak ditemukan." }, 404);
      if (target.deleted_at) return json({ error: "Akun sudah dihapus." }, 400);
      if (target.id === callerId) return json({ error: "Gunakan halaman keamanan untuk reset password sendiri." }, 400);
      if (caller.role !== "super_admin" && !(await isInNetwork(admin, target.id, caller.id))) {
        return json({ error: "Akun berada di luar jaringan Anda." }, 403);
      }
      const result = await sendSetupEmail(admin, target.id, target.email, target.full_name, target.username ?? undefined);
      if (result.passwordError) return json({ error: result.passwordError, email_sent: false }, 502);

      await admin.from("audit_logs").insert({
        actor_id: callerId,
        action: "admin_password_reset_request",
        target_type: "profile",
        target_id: target.id,
        details: { email: target.email, email_sent: !result.emailError },
      });

      return json({ success: true, email_sent: !result.emailError, email_error: result.emailError, temp_password: result.tempPassword });
    }

    // --- Action: update_email ---
    if (body.action === "update_email") {
      const targetId = clean(body.user_id);
      const newEmail = clean(body.email).toLowerCase();
      const target = targetId ? await loadProfile(admin, targetId) : null;
      if (!target) return json({ error: "Pengguna tidak ditemukan." }, 404);
      if (target.deleted_at) return json({ error: "Akun sudah dihapus." }, 400);
      if (target.role === "super_admin") return json({ error: "Tidak dapat mengubah Super Admin." }, 403);
      if (target.id === callerId) return json({ error: "Tidak dapat mengubah email sendiri." }, 400);
      if (caller.role !== "super_admin" && !(await isInNetwork(admin, target.id, caller.id))) {
        return json({ error: "Akun berada di luar jaringan Anda." }, 403);
      }
      if (!EMAIL_PATTERN.test(newEmail)) return json({ error: "Format email tidak valid." }, 400);

      const { data: dupEmail } = await admin
        .from("profiles").select("id").eq("email", newEmail).neq("id", target.id).maybeSingle();
      if (dupEmail) return json({ error: "Email sudah digunakan akun lain." }, 409);

      const { error: authUpdateErr } = await admin.auth.admin.updateUserById(target.id, {
        email: newEmail,
        email_confirm: true,
      });
      if (authUpdateErr) {
        return json({ error: `Gagal mengubah email di Auth: ${authUpdateErr.message}` }, 500);
      }

      await admin.from("audit_logs").insert({
        actor_id: callerId,
        action: "update_user_email",
        target_type: "profile",
        target_id: target.id,
        details: { old_email: target.email, new_email: newEmail },
      });

      return json({ success: true, old_email: target.email, new_email: newEmail });
    }

    // --- Action: create (default) ---
    const callerRole = caller.role === "sub_mitra" ? "submitra" : caller.role;
    const roleInput = clean(body.role);
    const role = (roleInput === "sub_mitra" ? "submitra" : roleInput) as TargetRole;
    const fullName = clean(body.full_name);
    let username = "";
    let email = clean(body.email).toLowerCase();
    const phone = clean(body.phone);
    const businessName = clean(body.business_name);
    const address = clean(body.address);
    const status = body.status === "suspended" ? "suspended" : "active";
    const requestedParentId = clean(body.parent_id);
    const loketType = clean(body.loket_type);

    if (!ROLES.includes(role)) return json({ error: "Jenis akun tidak valid." }, 400);
    if (!ALLOWED_TARGETS[callerRole]?.includes(role)) {
      return json({ error: "Anda tidak dapat membuat akun dengan peran ini." }, 403);
    }
    if (!fullName) return json({ error: "Nama lengkap wajib diisi." }, 400);
    username = generateUsername(fullName);
    if (!USERNAME_PATTERN.test(username)) {
      return json({ error: "Username otomatis tidak valid. Periksa nama akun." }, 400);
    }
    if (role !== "loket") {
      if (!EMAIL_PATTERN.test(email)) return json({ error: "Format email tidak valid." }, 400);
    }
    if (!phone) return json({ error: "Nomor HP wajib diisi." }, 400);
    if (role !== "loket") {
      if (!businessName) return json({ error: "Nama usaha wajib diisi." }, 400);
      if (!address) return json({ error: "Alamat wajib diisi." }, 400);
    }

    // loket_type untuk role loket
    let loketTypeValue: string | null = null;
    if (role === "loket") {
      loketTypeValue = VALID_LOKET_TYPES.includes(loketType) ? loketType : "lainnya";
    }

    const parentId = requestedParentId || callerId;
    if (!parentId) return json({ error: "Atasan langsung wajib dipilih." }, 400);

    const parent = await loadProfile(admin, parentId);
    if (!parent || parent.status !== "active" || !PARENT_ROLES[role].includes(parent.role === "sub_mitra" ? "submitra" : parent.role)) {
      const expected = role === "loket" ? "Mitra atau Sub Mitra" : role === "submitra" ? "Mitra" : "Super Admin";
      return json({ error: `Atasan harus berperan sebagai ${expected} yang aktif.` }, 400);
    }
    if (callerRole === "super_admin" && parent.id !== callerId) {
      return json({ error: "Mitra harus berada di bawah Super Admin yang membuatnya." }, 403);
    }
    if (callerRole === "mitra" && role === "submitra" && parent.id !== callerId) {
      return json({ error: "Sub Mitra harus berada langsung di bawah Mitra yang membuatnya." }, 403);
    }
    if (callerRole === "mitra" && role === "loket" && parent.id !== callerId && parent.role !== "submitra" && parent.role !== "sub_mitra") {
      return json({ error: "Loket hanya dapat berada di bawah Mitra atau Sub Mitra di jaringannya." }, 403);
    }
    if (callerRole === "submitra" && parent.id !== callerId) {
      return json({ error: "Sub Mitra hanya dapat membuat loket di bawah akunnya sendiri." }, 403);
    }
    if (callerRole !== "super_admin" && !(await isInNetwork(admin, parent.id, callerId))) {
      return json({ error: "Atasan berada di luar jaringan Anda." }, 403);
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: dupUsername } = await admin
        .from("profiles").select("id").eq("username", username).maybeSingle();
      if (!dupUsername) break;
      username = generateUsername(fullName);
      if (attempt === 4) return json({ error: "Username otomatis bentrok. Coba simpan lagi." }, 409);
    }
    if (role === "loket" && !email) {
      email = `${username}@loket.local`;
    }

    // Only check email duplication for real emails (not auto-generated @loket.local)
    if (!email.endsWith("@loket.local")) {
      const { data: dupEmail } = await admin
        .from("profiles").select("id").eq("email", email).maybeSingle();
      if (dupEmail) return json({ error: "Email sudah terdaftar." }, 409);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr || !created.user) {
      const msg = createErr?.message ?? "";
      if (/already|registered|exists/i.test(msg)) {
        return json({ error: "Email sudah terdaftar." }, 409);
      }
      return json({ error: `Akun Auth gagal dibuat: ${msg || "kesalahan tidak diketahui"}` }, 500);
    }
    const newId = created.user.id;

    const profileUpdate: Record<string, unknown> = {
      role,
      parent_id: parent.id,
      status,
      full_name: fullName,
      username,
      phone,
      business_name: businessName,
      address,
      created_by: callerId,
      must_change_password: true,
    };
    if (role === "loket" && loketTypeValue) {
      profileUpdate.loket_type = loketTypeValue;
    }

    const { data: updated, error: profileErr } = await admin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", newId)
      .select("id")
      .maybeSingle();

    if (profileErr || !updated) {
      await admin.auth.admin.deleteUser(newId);
      const reason = profileErr?.message ?? "profil tidak ditemukan setelah akun dibuat";
      return json({ error: `Profil gagal disimpan, akun dibatalkan: ${reason}` }, 500);
    }

    const tempPassword = generateTempPassword();
    const { error: pwdErr } = await admin.rpc("admin_set_user_password", {
      p_user_id: newId,
      p_password: tempPassword,
    });
    if (pwdErr) {
      await admin.auth.admin.deleteUser(newId);
      return json({ error: `Gagal mengatur password: ${pwdErr.message}` }, 500);
    }
    await admin.from("profiles").update({ must_change_password: true }).eq("id", newId);
    let emailErr: string | null = null;
    if (EMAIL_PATTERN.test(email) && !email.endsWith("@loket.local")) {
      emailErr = await sendTempPasswordEmail(email, fullName, tempPassword, "registration", username);
    }
    const setupResult: SetupResult = { passwordError: null, emailError: emailErr, tempPassword };

    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "create_subuser",
      target_type: "profile",
      target_id: newId,
      details: { email, role, parent_id: parent.id, username, status, email_sent: !setupResult.emailError, loket_type: loketTypeValue },
    });

    return json({
      success: true,
      user_id: newId,
      username,
      temp_password: setupResult.tempPassword,
      email_sent: !setupResult.emailError,
      email_error: setupResult.emailError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan server tidak diketahui.";
    return json({ error: message }, 500);
  }
});
