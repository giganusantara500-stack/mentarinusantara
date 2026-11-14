import { readDotEnv, sendPasswordEmail } from "./mail";
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
  email_sent: false;
  loket_code: string | null;
}

interface Env {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  resendApiKey?: string;
  emailFrom?: string;
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
    `${env.supabaseUrl}/rest/v1/profiles?id=eq.${callerId}&select=id,username,role,is_active`,
    { headers: serviceHeaders },
  );
  const callerRows = await readJson(callerProfileResponse);
  const caller = Array.isArray(callerRows) ? callerRows[0] : null;
  const callerRole = normalizeRole(clean(caller?.role));
  if (!caller || caller.is_active === false || !ALLOWED[callerRole]) {
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
  if (role !== "loket" && !clean(input.email)) return { status: 400, body: { error: "Email wajib diisi." } };

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
      `${env.supabaseUrl}/rest/v1/profiles?id=eq.${parentId}&select=id,role,is_active`,
      { headers: serviceHeaders },
    );
    const parentRows = await readJson(parentProfileResponse);
    const parent = Array.isArray(parentRows) ? parentRows[0] : null;
    const parentRole = normalizeRole(clean(parent?.role));
    if (!parent || parent.is_active === false || parentRole !== "submitra" || callerRole !== "mitra") {
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
        contact_email: clean(input.email),
        parent_id: parentId,
        role,
        status: input.status === "suspended" ? "suspended" : "active",
        username,
        loket_type: role === "loket" ? (clean(input.loketType) || "lainnya") : null,
        loket_code: loketCode,
      },
    }),
  });
  const created = await readJson(createdResponse);
  const userId = created?.id ?? created?.user?.id;
  if (!createdResponse.ok || !userId) {
    const message = created?.msg || created?.message || created?.error_description || "Akun autentikasi gagal dibuat.";
    return { status: createdResponse.status || 500, body: { error: String(message) } };
  }

  const active = input.status !== "suspended";
  const profileResponse = await fetch(`${env.supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: userId,
      username,
      role,
      is_active: active,
    }),
  });
  if (!profileResponse.ok) {
    const repaired = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ username, role, is_active: active }),
    });
    if (!repaired.ok) {
      await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: serviceHeaders });
      const profileError = await readJson(profileResponse);
      return { status: 500, body: { error: profileError?.message || "Profil gagal disimpan. Akun dibatalkan." } };
    }
  }

  const savedResponse = await fetch(
    `${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=role,is_active`,
    { headers: serviceHeaders },
  );
  const savedRows = await readJson(savedResponse);
  const saved = Array.isArray(savedRows) ? savedRows[0] : null;
  if (normalizeRole(clean(saved?.role)) !== role || (active && saved?.is_active === false)) {
    const repaired = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ username, role, is_active: active }),
    });
    if (!repaired.ok) {
      await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: serviceHeaders });
      return { status: 500, body: { error: "Peran akun tidak tersimpan. Akun dibatalkan." } };
    }
  }

  const result: CreateAccountResult = {
    success: true,
    user_id: userId,
    username,
    temp_password: tempPassword,
    email_sent: false,
    loket_code: loketCode,
  };
  return { status: 200, body: result };
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
  const profiles = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=in.(${caller.id},${userId})&select=id,role,is_active`, { headers });
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
  const contactEmail = typeof targetUser?.user_metadata?.contact_email === "string" ? targetUser.user_metadata.contact_email.trim() : "";
  const authEmail = typeof targetUser?.email === "string" ? targetUser.email.trim() : "";
  const recipient = contactEmail || (authEmail.endsWith("@gigamentarinusantara.id") ? "" : authEmail);
  const name = targetUser?.user_metadata?.full_name || target?.username || "Pengguna";
  const apiKey = (env.resendApiKey || readDotEnv("RESEND_API_KEY")).trim();
  if (!apiKey || !recipient) {
    return {
      status: 200,
      body: {
        success: true,
        temp_password: tempPassword,
        email_sent: false,
        email_error: !apiKey
          ? "RESEND_API_KEY belum ada di file .env. Password baru tampil di layar ini."
          : "Akun ini belum memiliki email terdaftar. Password baru tampil di layar ini.",
      },
    };
  }
  const mailed = await sendPasswordEmail({
    apiKey,
    to: recipient,
    name,
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
  const profiles = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=in.(${caller.id},${userId})&select=id,role,is_active`, { headers });
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
