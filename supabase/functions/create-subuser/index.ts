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
  super_admin: ["mitra", "loket"],
  mitra: ["submitra", "loket"],
  submitra: ["loket"],
};
const PARENT_ROLES: Record<TargetRole, string[]> = {
  mitra: ["super_admin"],
  submitra: ["mitra"],
  loket: ["mitra", "submitra"],
};
const VALID_LOKET_TYPES = ["konter", "minimarket", "agen", "lainnya"];
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
}

function profileStatus(row: Record<string, unknown>) {
  const explicit = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  if (explicit === "pending" || explicit === "active" || explicit === "suspended") return explicit;
  if (row.is_active === false) return "suspended";
  return "active";
}

async function loadProfile(admin: SupabaseClient, id: string): Promise<ProfileRow | null> {
  const loaded = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (loaded.error) throw new Error(`Gagal membaca profil: ${loaded.error.message}`);
  if (!loaded.data) return null;
  const row = loaded.data as Record<string, unknown>;
  return {
    id: String(row.id),
    role: String(row.role ?? ""),
    status: profileStatus(row),
    parent_id: (row.parent_id as string | null) ?? null,
    email: String(row.email ?? ""),
    full_name: String(row.full_name ?? row.username ?? ""),
    username: (row.username as string | null) ?? null,
  };
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

function field(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = clean(record[key]);
    if (value) return value;
  }
  return "";
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1]
    || message.match(/column "([^"]+)"/)?.[1]
    || "";
}

async function writeProfile(admin: SupabaseClient, userId: string, fields: Record<string, unknown>) {
  const payload = { ...fields };
  let lastError = "Profil gagal disimpan.";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const existing = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    const query = existing.data
      ? admin.from("profiles").update(payload).eq("id", userId)
      : admin.from("profiles").insert({ id: userId, ...payload });
    const written = await query.select("id").maybeSingle();
    if (!written.error && written.data) {
      return { ok: true as const, row: { ...payload, id: (written.data as { id: string }).id } };
    }
    lastError = written.error?.message || "Profil baru tidak kembali dari database.";
    const missing = missingColumn(lastError);
    if (missing && missing in payload) {
      delete payload[missing];
      continue;
    }
    if (/duplicate key|23505/i.test(lastError)) continue;
    return { ok: false as const, error: lastError };
  }
  return { ok: false as const, error: lastError };
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
    if (!caller || caller.status !== "active") {
      return json({ error: "Akun pemanggil tidak aktif." }, 403);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Data formulir tidak terbaca." }, 400);

    const appUrl = clean(body.app_url).replace(/\/+$/, "");
    if (appUrl && !APP_URL_PATTERN.test(appUrl)) {
      return json({ error: "Alamat aplikasi tidak valid." }, 400);
    }

    // --- Action: resend ---
    if (body.action === "resend") {
      const targetId = clean(body.user_id);
      const target = targetId ? await loadProfile(admin, targetId) : null;
      if (!target) return json({ error: "Pengguna tidak ditemukan." }, 404);
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
    const roleInput = field(body, "role");
    const role = (roleInput === "sub_mitra" ? "submitra" : roleInput) as TargetRole;
    const fullName = field(body, "full_name", "fullName");
    const email = field(body, "email").toLowerCase();
    const phone = field(body, "phone");
    const businessName = field(body, "business_name", "businessName");
    const address = field(body, "address");
    const city = field(body, "city");
    const status = body.status === "suspended" ? "suspended" : "active";
    const requestedParentId = field(body, "parent_id", "parentId");
    const loketType = field(body, "loket_type", "loketType");

    if (!ROLES.includes(role)) return json({ error: "Jenis akun tidak valid." }, 400);
    if (!ALLOWED_TARGETS[callerRole]?.includes(role)) {
      return json({ error: "Anda tidak dapat membuat akun dengan peran ini." }, 403);
    }
    if (!fullName || !phone) return json({ error: "Nama dan nomor HP wajib diisi." }, 400);
    if (!city) return json({ error: "Kota atau wilayah wajib diisi." }, 400);
    if (role !== "loket" && !EMAIL_PATTERN.test(email)) return json({ error: "Format email tidak valid." }, 400);
    if (role !== "loket" && (!businessName || !address)) return json({ error: "Nama usaha dan alamat wajib diisi." }, 400);

    let loketTypeValue: string | null = null;
    if (role === "loket") loketTypeValue = VALID_LOKET_TYPES.includes(loketType) ? loketType : "lainnya";

    const parentId = requestedParentId || callerId;
    const parent = await loadProfile(admin, parentId);
    const parentRole = parent?.role === "sub_mitra" ? "submitra" : parent?.role;
    const parentAllowed = Boolean(parent && parent.status === "active" && (
      (callerRole === "super_admin" && parent.id === callerId && (role === "mitra" || role === "loket"))
      || (parentRole ? PARENT_ROLES[role].includes(parentRole) : false)
    ));
    if (!parent || !parentAllowed) {
      const expected = role === "loket" ? "Mitra, Sub Mitra, atau Super Admin" : role === "submitra" ? "Mitra" : "Super Admin";
      return json({ error: `Atasan harus berperan sebagai ${expected} yang aktif.` }, 400);
    }
    if (callerRole === "super_admin" && parent.id !== callerId) {
      return json({ error: role === "loket"
        ? "Loket yang dibuat Super Admin berada langsung di bawah Super Admin."
        : "Mitra harus berada di bawah Super Admin yang membuatnya." }, 403);
    }
    if (callerRole === "mitra" && role === "submitra" && parent.id !== callerId) {
      return json({ error: "Sub Mitra harus berada langsung di bawah Mitra yang membuatnya." }, 403);
    }
    if (callerRole === "mitra" && role === "loket" && parent.id !== callerId && parentRole !== "submitra") {
      return json({ error: "Loket hanya dapat berada di bawah Mitra atau Sub Mitra di jaringannya." }, 403);
    }
    if (callerRole === "submitra" && parent.id !== callerId) {
      return json({ error: "Sub Mitra hanya dapat membuat loket di bawah akunnya sendiri." }, 403);
    }
    if (callerRole !== "super_admin" && !(await isInNetwork(admin, parent.id, callerId))) {
      return json({ error: "Atasan berada di luar jaringan Anda." }, 403);
    }

    const base = fullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || "akun";
    let username = base;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { data: dupUsername } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      if (!dupUsername) break;
      username = `${base}${attempt + 1}`;
    }
    if (email && EMAIL_PATTERN.test(email)) {
      const { data: dupEmail } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (dupEmail) return json({ error: "Email sudah terdaftar." }, 409);
    }

    const tempPassword = generateTempPassword();
    const loginEmail = `${username}@gigamentarinusantara.id`;
    const mfaRequired = role !== "loket" && (role === "mitra" || role === "submitra");
    const loketCode = role === "loket" ? String(1000000 + Math.floor(Math.random() * 9000000)) : null;
    let mitraId: string | null = null;
    if (callerRole === "mitra") mitraId = callerId;
    if (callerRole === "submitra") mitraId = caller.parent_id;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: loginEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        phone,
        business_name: businessName,
        address,
        city,
        contact_email: email,
        parent_id: parent.id,
        mitra_id: mitraId,
        created_by: callerId,
        role,
        status,
        username,
        loket_type: loketTypeValue,
        loket_code: loketCode,
        mfa_enabled: false,
        mfa_status: mfaRequired ? "pending" : "off",
        must_change_password: true,
      },
    });
    if (createErr || !created.user) {
      const msg = createErr?.message ?? "";
      if (/already|registered|exists/i.test(msg)) return json({ error: "Username atau email login sudah terdaftar." }, 409);
      return json({ error: `Akun Auth gagal dibuat: ${msg || "kesalahan tidak diketahui"}` }, 500);
    }
    const newId = created.user.id;
    const saved = await writeProfile(admin, newId, {
      username,
      role,
      is_active: status === "active",
      status,
      email,
      full_name: fullName,
      phone,
      business_name: businessName,
      address,
      city,
      parent_id: parent.id,
      mitra_id: mitraId,
      created_by: callerId,
      loket_type: loketTypeValue,
      loket_code: loketCode,
      mfa_enabled: false,
      must_change_password: true,
    });
    if (!saved.ok) {
      await admin.auth.admin.deleteUser(newId);
      return json({ error: `Profil gagal disimpan, akun dibatalkan: ${saved.error}` }, 500);
    }
    const savedRole = String(saved.row.role ?? role);
    if (savedRole && savedRole !== role && savedRole !== "sub_mitra") {
      await admin.auth.admin.deleteUser(newId);
      return json({ error: `Peran akun tersimpan sebagai ${savedRole}, bukan ${role}. Akun dibatalkan.` }, 500);
    }

    let emailErr: string | null = null;
    if (EMAIL_PATTERN.test(email)) {
      emailErr = await sendTempPasswordEmail(email, fullName, tempPassword, "registration", username);
    } else {
      emailErr = "Email kontak belum diisi. Username dan password sementara tetap tersedia di layar.";
    }
    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "create_subuser",
      target_type: "profile",
      target_id: newId,
      details: { email, role, parent_id: parent.id, username, status, email_sent: !emailErr, loket_type: loketTypeValue, must_change_password: true, mfa_required: mfaRequired },
    }).then(() => undefined, () => undefined);

    return json({
      success: true,
      user_id: newId,
      username: String(saved.row.username ?? username),
      temp_password: tempPassword,
      email_sent: !emailErr,
      email_error: emailErr,
      loket_code: loketCode,
      must_change_password: true,
      mfa_required: mfaRequired,
      account: {
        id: newId,
        username: String(saved.row.username ?? username),
        role,
        email,
        full_name: fullName,
        phone,
        city,
        must_change_password: true,
        mfa_enabled: false,
        mfa_required: mfaRequired,
        loket_code: loketCode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan server tidak diketahui.";
    return json({ error: message }, 500);
  }
});
