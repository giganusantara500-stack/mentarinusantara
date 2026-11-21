import { readDotEnv, sendAccountEmail, sendPasswordEmail } from "./mail";
import { codeFromMetadata, listAuthUsers, makeLoketCode } from "./loketCode";

export interface CreateAccountInput {
  role: string;
  fullName: string;
  email?: string;
  phone?: string;
  businessName?: string;
  address?: string;
  city?: string;
  status?: string;
  parentId?: string;
  loketType?: string;
}

export interface CreateAccountResult {
  success: true;
  user_id: string;
  username: string;
  temp_password: string;
  email_sent: boolean;
  email_error: string | null;
  loket_code: string | null;
  must_change_password: true;
  mfa_required: boolean;
  account: Record<string, unknown>;
}

interface Env {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  resendApiKey?: string;
  emailFrom?: string;
  senderName?: string;
  senderEmail?: string;
  supportEmail?: string;
}

const ALLOWED: Record<string, string[]> = {
  super_admin: ["mitra", "loket"],
  mitra: ["submitra", "loket"],
  submitra: ["loket"],
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(role: string) {
  const value = role.trim().toLowerCase().replace(/\s+/g, "_");
  if (value === "superadmin" || value === "super_admin") return "super_admin";
  if (value === "sub_mitra" || value === "submitra") return "submitra";
  if (value === "mitra" || value === "loket") return value;
  return "";
}

function generatePassword() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => String(byte % 10)).join("");
}

export function usernameBase(fullName: string) {
  return fullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || "akun";
}

export function nextUsername(base: string, existing: string[]) {
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  if (!taken.has(base)) return base;
  let number = 1;
  while (taken.has(`${base}${number}`)) number += 1;
  return `${base}${number}`;
}

function supabaseError(body: unknown) {
  if (!body || typeof body !== "object") return "Supabase tidak mengembalikan detail error.";
  const record = body as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
  const parts = [
    record.message, record.msg, record.error_description, record.hint, record.details, record.code, record.error_code,
    nested?.message, nested?.msg,
    typeof record.error === "string" ? record.error : "",
  ].filter((value) => typeof value === "string" && value.trim());
  return parts.join(" | ") || JSON.stringify(body);
}

function columnName(message: string) {
  return message.match(/'([^']+)' column/)?.[1]
    || message.match(/column "([^"]+)"/)?.[1]
    || "";
}

function serviceHeaders(env: Env, prefer?: string) {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function firstRow(body: unknown) {
  if (Array.isArray(body)) return body[0] as Record<string, unknown> | undefined;
  if (body && typeof body === "object" && "id" in body) return body as Record<string, unknown>;
  return undefined;
}

async function saveProfile(env: Env, userId: string, fields: Record<string, unknown>) {
  const payload = { ...fields };
  let lastError = "Profil gagal disimpan.";
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const listed = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=*`, { headers: serviceHeaders(env) });
    const rows = await readJson(listed);
    if (!listed.ok) {
      lastError = supabaseError(rows);
      const missing = columnName(lastError);
      if (missing && missing in payload) {
        delete payload[missing];
        continue;
      }
      return { ok: false as const, error: lastError };
    }
    const row = firstRow(rows);
    const write = async (method: "PATCH" | "POST", body: Record<string, unknown>) => {
      const url = method === "PATCH"
        ? `${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`
        : `${env.supabaseUrl}/rest/v1/profiles`;
      return fetch(url, {
        method,
        headers: serviceHeaders(env, "return=representation"),
        body: JSON.stringify(body),
      });
    };
    if (row) {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (key in row) patch[key] = value;
      }
      if (Object.keys(patch).length === 0) return { ok: true as const, row };
      const response = await write("PATCH", patch);
      const detail = await readJson(response);
      if (response.ok) return { ok: true as const, row: firstRow(detail) ?? { ...row, ...patch } };
      lastError = supabaseError(detail);
      const missing = columnName(lastError);
      if (missing && missing in payload) {
        delete payload[missing];
        continue;
      }
      console.error("Supabase profil gagal diperbarui:", lastError);
      return { ok: false as const, error: lastError };
    }
    const response = await write("POST", { id: userId, ...payload });
    const detail = await readJson(response);
    if (response.ok) return { ok: true as const, row: firstRow(detail) ?? { id: userId, ...payload } };
    lastError = supabaseError(detail);
    const missing = columnName(lastError);
    if ((missing && missing in payload) || /duplicate key|23505/i.test(lastError)) {
      if (missing) delete payload[missing];
      continue;
    }
    console.error("Supabase profil gagal disimpan:", lastError);
    return { ok: false as const, error: lastError };
  }
  return { ok: false as const, error: lastError };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function createNetworkAccount(authorization: string, input: CreateAccountInput, env: Env) {
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };

  const callerResponse = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  const callerAuth = await readJson(callerResponse);
  const callerId = callerAuth?.id as string | undefined;
  if (!callerResponse.ok || !callerId) {
    return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };
  }

  const serviceHeaders = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const callerProfileResponse = await fetch(
    `${env.supabaseUrl}/rest/v1/profiles?id=eq.${callerId}&select=*`,
    { headers: serviceHeaders },
  );
  const callerRows = await readJson(callerProfileResponse);
  if (!callerProfileResponse.ok) {
    const message = supabaseError(callerRows);
    console.error("Supabase gagal membaca profil pemanggil:", callerProfileResponse.status, message);
    return { status: callerProfileResponse.status || 500, body: { error: message } };
  }
  const caller = Array.isArray(callerRows) ? callerRows[0] : null;
  const callerRole = normalizeRole(clean(caller?.role));
  if (!caller || caller.is_active === false || caller.status === "suspended" || !ALLOWED[callerRole]) {
    return { status: 403, body: { error: "Akun pemanggil tidak berhak membuat pengguna." } };
  }

  const role = normalizeRole(clean(input.role));
  const fullName = clean(input.fullName);
  const phone = clean(input.phone);
  const city = clean(input.city);
  const parentId = clean(input.parentId) || callerId;
  if (!ALLOWED[callerRole].includes(role)) {
    return { status: 403, body: { error: "Anda tidak dapat membuat akun dengan peran ini." } };
  }
  if (!fullName || !phone) return { status: 400, body: { error: "Nama dan nomor HP wajib diisi." } };
  if (!city) return { status: 400, body: { error: "Kota atau wilayah wajib diisi." } };
  const contactEmail = clean(input.email).toLowerCase();
  if (!contactEmail) return { status: 400, body: { error: "Email wajib diisi." } };

  if (callerRole === "super_admin" && role === "mitra" && parentId !== callerId) {
    return { status: 403, body: { error: "Mitra harus berada di bawah Super Admin yang membuatnya." } };
  }
  if (callerRole === "super_admin" && role === "loket" && parentId !== callerId) {
    return { status: 403, body: { error: "Loket yang dibuat Super Admin berada langsung di bawah Super Admin." } };
  }
  if (callerRole === "mitra" && role === "submitra" && parentId !== callerId) {
    return { status: 403, body: { error: "Sub Mitra harus berada langsung di bawah Mitra yang membuatnya." } };
  }
  if (callerRole === "submitra" && parentId !== callerId) {
    return { status: 403, body: { error: "Sub Mitra hanya dapat membuat loket di bawah akunnya sendiri." } };
  }
  if (parentId !== callerId) {
    const parentProfileResponse = await fetch(
      `${env.supabaseUrl}/rest/v1/profiles?id=eq.${parentId}&select=*`,
      { headers: serviceHeaders },
    );
    const parentRows = await readJson(parentProfileResponse);
    const parent = Array.isArray(parentRows) ? parentRows[0] : null;
    const parentRole = normalizeRole(clean(parent?.role));
    if (!parent || parent.is_active === false || parent.status === "suspended" || parentRole !== "submitra" || callerRole !== "mitra") {
      return { status: 403, body: { error: "Loket hanya dapat berada di bawah Anda atau Sub Mitra di jaringan Anda." } };
    }
    const parentAuthResponse = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${parentId}`, { headers: serviceHeaders });
    const parentAuth = await readJson(parentAuthResponse);
    if (parentAuth?.user_metadata?.parent_id !== callerId) {
      return { status: 403, body: { error: "Sub Mitra itu berada di luar jaringan Anda." } };
    }
  }

  const base = usernameBase(fullName);
  const listed = await fetch(
    `${env.supabaseUrl}/rest/v1/profiles?or=(username.eq.${base},username.like.${base}*)&select=username`,
    { headers: serviceHeaders },
  );
  const listedRows = await readJson(listed);
  const existingNames = Array.isArray(listedRows)
    ? listedRows.map((row) => clean(row?.username)).filter(Boolean)
    : [];
  let username = nextUsername(base, existingNames);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const clash = await fetch(
      `${env.supabaseUrl}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`,
      { headers: serviceHeaders },
    );
    const clashRows = await readJson(clash);
    if (Array.isArray(clashRows) && clashRows.length === 0) break;
    existingNames.push(username);
    username = nextUsername(base, existingNames);
  }

  let mitraId: string | null = null;
  if (callerRole === "mitra") mitraId = callerId;
  if (callerRole === "submitra") {
    const callerAuthResponse = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${callerId}`, { headers: serviceHeaders });
    const callerAuth = await readJson(callerAuthResponse);
    const linked = callerAuth?.user_metadata?.mitra_id || callerAuth?.user_metadata?.parent_id;
    mitraId = typeof linked === "string" && linked ? linked : null;
  }

  const tempPassword = generatePassword();
  const loginEmail = `${username}@gigamentarinusantara.id`;
  let loketCode: string | null = null;
  if (role === "loket") {
    const users = await listAuthUsers(env);
    const taken = new Set(users.map((user) => codeFromMetadata(user.user_metadata)).filter(Boolean));
    loketCode = makeLoketCode(taken);
  }
  const createdResponse = await fetch(`${env.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      email: loginEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        phone,
        business_name: clean(input.businessName),
        address: clean(input.address),
        city,
        contact_email: contactEmail,
        parent_id: parentId,
        mitra_id: mitraId,
        created_by: callerId,
        role,
        status: input.status === "suspended" ? "suspended" : "active",
        username,
        loket_type: role === "loket" ? (clean(input.loketType) || "lainnya") : null,
        loket_code: loketCode,
        mfa_enabled: false,
        mfa_status: role === "mitra" || role === "submitra" ? "pending" : "off",
        must_change_password: true,
      },
    }),
  });
  const created = await readJson(createdResponse);
  const userId = created?.id ?? created?.user?.id;
  if (!createdResponse.ok || !userId) {
    const message = supabaseError(created);
    console.error("Supabase Auth gagal membuat akun:", createdResponse.status, message);
    return { status: createdResponse.status || 500, body: { error: message } };
  }

  const active = input.status !== "suspended";
  const savedProfile = await saveProfile(env, userId, {
    username,
    role,
    is_active: active,
    email: contactEmail,
    full_name: fullName,
    phone,
    business_name: clean(input.businessName),
    address: clean(input.address),
    city,
    parent_id: parentId,
    mitra_id: mitraId,
    created_by: callerId,
    status: active ? "active" : "suspended",
    loket_type: role === "loket" ? (clean(input.loketType) || "lainnya") : null,
    loket_code: loketCode,
    mfa_enabled: false,
    must_change_password: true,
  });
  if (!savedProfile.ok) {
    await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: serviceHeaders });
    return { status: 500, body: { error: savedProfile.error } };
  }

  const savedResponse = await fetch(
    `${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=*`,
    { headers: serviceHeaders },
  );
  const savedRows = await readJson(savedResponse);
  const saved = (Array.isArray(savedRows) ? savedRows[0] : null) ?? savedProfile.row ?? null;
  const savedRole = normalizeRole(clean(saved?.role));
  if (saved && savedRole && savedRole !== role) {
    await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: serviceHeaders });
    return { status: 500, body: { error: `Peran akun tersimpan sebagai ${savedRole}, bukan ${role}. Akun dibatalkan.` } };
  }

  const apiKey = (env.resendApiKey || readDotEnv("RESEND_API_KEY")).trim();
  const sender = mailSender(env);
  let emailSent = false;
  let emailError: string | null = null;
  if (!apiKey) {
    emailError = "Layanan email belum dikonfigurasi. Username dan password sementara tetap tersedia di layar.";
  } else {
    const mailed = await sendAccountEmail({
      apiKey,
      from: sender.from,
      senderName: sender.name,
      supportEmail: sender.supportEmail,
      to: contactEmail,
      name: fullName,
      username,
      email: contactEmail,
      password: tempPassword,
    });
    emailSent = mailed.sent;
    emailError = mailed.sent ? null : mailed.error;
  }

  await markMustChangePassword(env, userId);
  const mfaRequired = role === "mitra" || role === "submitra";
  const result: CreateAccountResult = {
    success: true,
    user_id: userId,
    username: clean(saved?.username) || username,
    temp_password: tempPassword,
    email_sent: emailSent,
    email_error: emailError,
    loket_code: clean(saved?.loket_code) || loketCode,
    must_change_password: true,
    mfa_required: mfaRequired,
    account: {
      id: userId,
      username: clean(saved?.username) || username,
      role: savedRole || role,
      email: contactEmail,
      full_name: fullName,
      phone,
      city,
      must_change_password: true,
      mfa_enabled: false,
      mfa_required: mfaRequired,
      loket_code: clean(saved?.loket_code) || loketCode,
    },
  };
  return { status: 200, body: result };
}

function mailSender(env: Env) {
  return {
    from: (env.senderEmail || readDotEnv("SENDER_EMAIL") || env.emailFrom || readDotEnv("EMAIL_FROM_ADDRESS")).trim(),
    name: (env.senderName || readDotEnv("SENDER_NAME") || "Mentari Nusantara").trim() || "Mentari Nusantara",
    supportEmail: (env.supportEmail || readDotEnv("SUPPORT_EMAIL")).trim(),
  };
}

async function markMustChangePassword(env: Env, userId: string) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ must_change_password: true }),
  });
  if (!response.ok) {
    const detail = await readJson(response);
    console.error("Profil gagal ditandai wajib ganti password:", supabaseError(detail));
  }
}

export async function requestPasswordReset(emailOrUsername: string, env: Env) {
  const needle = emailOrUsername.trim().toLowerCase();
  if (!needle) return { status: 400, body: { error: "Email wajib diisi." } };
  const users = await listAuthUsers(env) as Array<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>;
  const user = users.find((item) => {
    const contact = clean(item.user_metadata?.contact_email).toLowerCase();
    const authEmail = clean(item.email).toLowerCase();
    const username = clean(item.user_metadata?.username).toLowerCase();
    return contact === needle || authEmail === needle || username === needle;
  });
  if (!user?.email) return { status: 404, body: { error: "Email tidak ditemukan pada akun terdaftar." } };
  const recipient = clean(user.user_metadata?.contact_email) || (user.email.endsWith("@gigamentarinusantara.id") ? "" : user.email);
  if (!recipient) return { status: 400, body: { error: "Akun ini belum memiliki email terdaftar." } };
  const apiKey = (env.resendApiKey || readDotEnv("RESEND_API_KEY")).trim();
  if (!apiKey) {
    return { status: 500, body: { error: "RESEND_API_KEY belum ada, jadi password tidak diubah dan email tidak terkirim." } };
  }
  const tempPassword = generatePassword();
  const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const updated = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password: tempPassword }),
  });
  if (!updated.ok) {
    const detail = await readJson(updated);
    return { status: 500, body: { error: supabaseError(detail) || "Password gagal diperbarui." } };
  }
  await markMustChangePassword(env, user.id);
  const sender = mailSender(env);
  const mailed = await sendPasswordEmail({
    apiKey,
    from: sender.from,
    senderName: sender.name,
    supportEmail: sender.supportEmail,
    to: recipient,
    name: clean(user.user_metadata?.full_name) || clean(user.user_metadata?.username) || "Pengguna",
    username: clean(user.user_metadata?.username),
    email: recipient,
    password: tempPassword,
  });
  if (!mailed.sent) {
    return {
      status: 502,
      body: {
        error: `Password baru sudah disimpan, tetapi email gagal dikirim. ${mailed.error} Hubungi administrator untuk mengirim ulang password.`,
        email_sent: false,
      },
    };
  }
  return { status: 200, body: { success: true, email_sent: true } };
}

export async function resetAccountPassword(authorization: string, userId: string, env: Env) {
  const token = authorization.replace(/^Bearer\s+/i, "");
  const callerResponse = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  const caller = await callerResponse.json().catch(() => null);
  if (!callerResponse.ok || !caller?.id) return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };
  if (caller.id === userId) return { status: 400, body: { error: "Gunakan halaman keamanan untuk mengganti password sendiri." } };

  const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const profiles = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=in.(${caller.id},${userId})&select=*`, { headers });
  const rows = await profiles.json();
  const callerProfile = Array.isArray(rows) ? rows.find((row) => row.id === caller.id) : null;
  const target = Array.isArray(rows) ? rows.find((row) => row.id === userId) : null;
  const callerRole = callerProfile?.role === "sub_mitra" ? "submitra" : callerProfile?.role;
  const targetRole = target?.role === "sub_mitra" ? "submitra" : target?.role;
  if (!callerProfile || callerProfile.is_active === false || !target) {
    return { status: 403, body: { error: "Akun tidak dapat diatur." } };
  }
  const targetAuth = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers });
  const targetUser = await targetAuth.json().catch(() => null);
  const parentId = targetUser?.user_metadata?.parent_id as string | undefined;
  let parentOfParent: string | undefined;
  if (parentId) {
    const parentAuth = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${parentId}`, { headers });
    const parentUser = await parentAuth.json().catch(() => null);
    parentOfParent = parentUser?.user_metadata?.parent_id;
  }
  const allowed = callerRole === "super_admin"
    ? targetRole === "mitra" || targetRole === "submitra" || targetRole === "loket"
    : callerRole === "mitra"
      ? (targetRole === "submitra" && parentId === caller.id) || (targetRole === "loket" && (parentId === caller.id || parentOfParent === caller.id))
      : callerRole === "submitra" && targetRole === "loket" && parentId === caller.id;
  if (!allowed) return { status: 403, body: { error: "Anda hanya dapat mereset akun di bawah jaringan Anda." } };

  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const tempPassword = Array.from(bytes, (byte) => String(byte % 10)).join("");
  const updated = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ password: tempPassword }),
  });
  if (!updated.ok) {
    const detail = await updated.json().catch(() => null);
    return { status: 500, body: { error: detail?.msg || detail?.message || "Password gagal diperbarui." } };
  }
  await markMustChangePassword(env, userId);
  const contactEmail = typeof targetUser?.user_metadata?.contact_email === "string" ? targetUser.user_metadata.contact_email.trim() : "";
  const authEmail = typeof targetUser?.email === "string" ? targetUser.email.trim() : "";
  const recipient = contactEmail || (authEmail.endsWith("@gigamentarinusantara.id") ? "" : authEmail);
  const name = targetUser?.user_metadata?.full_name || target?.username || "Pengguna";
  const username = typeof targetUser?.user_metadata?.username === "string" ? targetUser.user_metadata.username : "";
  const apiKey = (env.resendApiKey || readDotEnv("RESEND_API_KEY")).trim();
  if (!apiKey || !recipient) {
    return {
      status: 200,
      body: {
        success: true,
        temp_password: tempPassword,
        email_sent: false,
        email_error: !apiKey
          ? "Layanan email belum siap. Password baru tampil di layar ini."
          : "Akun ini belum memiliki email terdaftar. Password baru tampil di layar ini.",
      },
    };
  }
  const sender = mailSender(env);
  const mailed = await sendPasswordEmail({
    apiKey,
    from: sender.from,
    senderName: sender.name,
    supportEmail: sender.supportEmail,
    to: recipient,
    name,
    username,
    email: recipient,
    password: tempPassword,
  });
  return {
    status: 200,
    body: {
      success: true,
      temp_password: mailed.sent ? null : tempPassword,
      email_sent: mailed.sent,
      email_error: mailed.sent ? null : mailed.error,
    },
  };
}

export async function setLoketActive(authorization: string, userId: string, active: boolean, env: Env) {
  const token = authorization.replace(/^Bearer\s+/i, "");
  const callerResponse = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  const caller = await callerResponse.json().catch(() => null);
  if (!callerResponse.ok || !caller?.id) return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };

  const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const profiles = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=in.(${caller.id},${userId})&select=*`, { headers });
  const rows = await profiles.json();
  const callerProfile = Array.isArray(rows) ? rows.find((row) => row.id === caller.id) : null;
  const target = Array.isArray(rows) ? rows.find((row) => row.id === userId) : null;
  const callerRole = callerProfile?.role === "sub_mitra" ? "submitra" : callerProfile?.role;
  const targetRole = target?.role === "sub_mitra" ? "submitra" : target?.role;
  if (!callerProfile || callerProfile.is_active === false || !target || targetRole !== "loket") {
    return { status: 403, body: { error: "Hanya akun loket yang dapat diblokir dari menu ini." } };
  }
  if (callerRole !== "super_admin" && callerRole !== "mitra" && callerRole !== "submitra") {
    return { status: 403, body: { error: "Anda tidak dapat memblokir loket." } };
  }
  if (callerRole !== "super_admin") {
    const targetAuth = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers });
    const targetUser = await targetAuth.json().catch(() => null);
    const parentId = targetUser?.user_metadata?.parent_id;
    if (callerRole === "submitra" && parentId !== caller.id) {
      return { status: 403, body: { error: "Loket ini berada di luar jaringan Anda." } };
    }
    if (callerRole === "mitra" && parentId !== caller.id) {
      const parentAuth = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${parentId}`, { headers });
      const parentUser = await parentAuth.json().catch(() => null);
      if (parentUser?.user_metadata?.parent_id !== caller.id) {
        return { status: 403, body: { error: "Loket ini berada di luar jaringan Anda." } };
      }
    }
  }
  const updated = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ is_active: active }),
  });
  if (!updated.ok) {
    const detail = await updated.json().catch(() => null);
    return { status: 500, body: { error: detail?.message || "Status loket gagal diperbarui." } };
  }
  if (active) {
    const current = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers });
    const targetUser = await current.json().catch(() => null);
    if (current.ok && targetUser) {
      await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ user_metadata: { ...(targetUser.user_metadata ?? {}), last_activity: new Date().toISOString() } }),
      });
    }
  }
  return { status: 200, body: { success: true, is_active: active } };
}
