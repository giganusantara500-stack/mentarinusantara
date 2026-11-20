import { creditWallet, latestLedgerActivity, walletBalance } from "./ledger";
import { assignMissingLoketCodes } from "./loketCode";

interface Env {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface Caller {
  id: string;
  role: string;
}

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

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

const serviceHeaders = (env: Env) => ({
  apikey: env.serviceRoleKey,
  Authorization: `Bearer ${env.serviceRoleKey}`,
  "Content-Type": "application/json",
});

async function loadCaller(authorization: string, env: Env): Promise<Caller | null> {
  const token = authorization.replace(/^Bearer\s+/i, "");
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  const user = await readJson(response);
  if (!response.ok || !user?.id) return null;
  const profiles = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=role,is_active`, { headers: serviceHeaders(env) });
  const rows = await readJson(profiles);
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || profile.is_active === false) return null;
  return { id: user.id, role: normalizeRole(clean(profile.role)) };
}

async function authUsers(env: Env) {
  const users: Array<{ id: string; email?: string; last_sign_in_at?: string | null; user_metadata?: Record<string, string> }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: serviceHeaders(env) });
    const body = await readJson(response);
    const batch = Array.isArray(body?.users) ? body.users : [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

const IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const sweptAtByCaller = new Map<string, number>();

export async function touchActivity(userId: string, env: Env) {
  if (!userId) return;
  const headers = serviceHeaders(env);
  const current = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers });
  const user = await readJson(current);
  if (!current.ok || !user) return;
  await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ user_metadata: { ...(user.user_metadata ?? {}), last_activity: new Date().toISOString() } }),
  });
}

export async function sweepIdleAccounts(env: Env, caller: Caller) {
  if (!env.serviceRoleKey || !caller || !["super_admin", "mitra", "submitra"].includes(caller.role)) return;
  const lastSweep = sweptAtByCaller.get(caller.id) ?? 0;
  if (Date.now() - lastSweep < 60 * 60 * 1000) return;
  sweptAtByCaller.set(caller.id, Date.now());
  try {
    const headers = serviceHeaders(env);
    const profilesResponse = await fetch(
      `${env.supabaseUrl}/rest/v1/profiles?select=id,role,is_active,created_at,parent_id,created_by,mitra_id`,
      { headers },
    );
    const profiles = await readJson(profilesResponse);
    if (!Array.isArray(profiles)) return;
    const parentById = new Map(profiles.map((profile) => [String(profile.id), clean(profile.parent_id) || null]));
    const users = await authUsers(env);
    const byId = new Map(users.map((user) => [user.id, user]));
    const ledgerMarks = await latestLedgerActivity(env, caller.id);
    const now = Date.now();
    for (const profile of profiles) {
      const role = normalizeRole(clean(profile.role));
      const profileId = String(profile.id);
      if (profileId === caller.id || !["mitra", "submitra", "loket"].includes(role) || profile.is_active === false) continue;
      const parentId = clean(profile.parent_id) || null;
      const parentOfParent = parentId ? parentById.get(parentId) ?? null : null;
      const inScope = canManage(
        caller,
        role,
        parentId,
        parentOfParent,
        clean(profile.mitra_id) || null,
        clean(profile.created_by) || null,
      );
      if (!inScope) continue;
      const user = byId.get(profileId);
      const marks = [profile.created_at, user?.last_sign_in_at, user?.user_metadata?.last_activity]
        .map((value) => Date.parse(String(value ?? "")))
        .filter((time) => Number.isFinite(time));
      const ledgerTime = ledgerMarks.get(profileId);
      if (ledgerTime) marks.push(ledgerTime);
      const last = marks.length ? Math.max(...marks) : 0;
      if (!last || now - last < IDLE_MS) continue;
      await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${profile.id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ is_active: false }),
      });
    }
  } catch {
    sweptAtByCaller.delete(caller.id);
  }
}

function canManage(caller: Caller, targetRole: string, parentId: string | null, parentOfParent: string | null, mitraId: string | null = null, createdBy: string | null = null) {
  const role = normalizeRole(targetRole);
  if (caller.role === "super_admin") return role === "mitra" || role === "submitra" || role === "loket";
  if (caller.role === "mitra" && (role === "submitra" || role === "loket")) {
    return parentId === caller.id || parentOfParent === caller.id || mitraId === caller.id || createdBy === caller.id;
  }
  if (caller.role === "submitra" && role === "loket") return parentId === caller.id || createdBy === caller.id;
  return false;
}

export async function listAccounts(authorization: string, env: Env) {
  const caller = await loadCaller(authorization, env);
  if (!caller || !["super_admin", "mitra", "submitra"].includes(caller.role)) {
    return { status: 403, body: { error: "Anda tidak dapat melihat daftar akun." } };
  }
  await sweepIdleAccounts(env, caller);
  const profilesResponse = await fetch(`${env.supabaseUrl}/rest/v1/profiles?select=*&limit=1000`, { headers: serviceHeaders(env) });
  const profiles = await readJson(profilesResponse);
  const users = await authUsers(env);
  const byId = new Map(users.map((user: { id: string }) => [user.id, user]));
  const profileRows = Array.isArray(profiles) ? profiles : [];
  const seen = new Set(profileRows.map((profile) => String(profile.id)));
  for (const user of users) {
    if (seen.has(user.id)) continue;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const role = accountRole(meta, "");
    if (!["mitra", "submitra", "loket"].includes(role)) continue;
    const username = clean(meta.username) || clean(user.email).split("@")[0] || "akun";
    const active = meta.status !== "suspended";
    await fetch(`${env.supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
      method: "POST",
      headers: { ...serviceHeaders(env), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: user.id, username, role, is_active: active }),
    });
    profileRows.push({
      id: user.id,
      username,
      role,
      is_active: active,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    seen.add(user.id);
  }
  const loketIds = profileRows.filter((profile) => normalizeRole(clean(profile.role)) === "loket").map((profile) => String(profile.id));
  const codes = await assignMissingLoketCodes(env, users, loketIds);
  const rows = [];
  for (const profile of profileRows) {
    const user = byId.get(profile.id) as { email?: string; user_metadata?: Record<string, string> } | undefined;
    const meta = user?.user_metadata ?? {};
    const parentId = meta.parent_id || clean(profile.parent_id) || null;
    const createdBy = meta.created_by || clean(profile.created_by) || null;
    const parent = parentId ? byId.get(parentId) as { user_metadata?: Record<string, string> } | undefined : null;
    const parentMeta = parent?.user_metadata ?? {};
    const parentRole = normalizeRole(clean(parentMeta.role));
    const role = accountRole(meta, normalizeRole(clean(profile.role))) || normalizeRole(clean(profile.role));
    const mitraId = meta.mitra_id || clean(profile.mitra_id) || (parentRole === "mitra" ? parentId : parentMeta.mitra_id || (parentRole === "submitra" ? parentMeta.parent_id : "")) || null;
    if (role === "loket" && mitraId && !meta.mitra_id && user) {
      meta.mitra_id = mitraId;
      await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${profile.id}`, {
        method: "PUT",
        headers: serviceHeaders(env),
        body: JSON.stringify({ user_metadata: meta }),
      });
    }
    rows.push({
      ...profile,
      role,
      email: meta.contact_email || user?.email || "",
      full_name: profile.username === "giganusantara" ? "Aris Purwanto" : (meta.full_name || profile.username || ""),
      phone: meta.phone || null,
      business_name: meta.business_name || null,
      address: meta.address || null,
      city: meta.city || null,
      parent_id: parentId,
      mitra_id: mitraId,
      created_by: createdBy,
      parent_of_parent: parentMeta.parent_id || null,
      loket_type: meta.loket_type || null,
      loket_code: codes.get(profile.id) || meta.loket_code || null,
      status: profile.is_active === false ? "suspended" : "active",
    });
  }
  const visible = rows.filter((row) => caller.role === "super_admin" || canManage(caller, row.role, row.parent_id, row.parent_of_parent, row.mitra_id, row.created_by) || row.id === caller.id);
  return { status: 200, body: { rows: visible } };
}

export async function networkLoketIds(authorization: string, env: Env) {
  const caller = await loadCaller(authorization, env);
  if (!caller) return [] as string[];
  if (caller.role === "super_admin") return null;
  const listed = await listAccounts(authorization, env);
  const rows = (listed.body.rows ?? []) as { id: string; role: string }[];
  return rows.filter((row) => normalizeRole(row.role) === "loket").map((row) => row.id);
}

export async function updateUserDetails(authorization: string, input: Record<string, unknown>, env: Env) {
  const caller = await loadCaller(authorization, env);
  if (!caller) return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };
  const userId = clean(input.userId);
  const listed = await listAccounts(authorization, env);
  const rows = listed.body.rows as { id: string; role: string; parent_id: string | null; parent_of_parent: string | null }[] | undefined;
  const target = rows?.find((row) => row.id === userId);
  if (!target || !canManage(caller, target.role, target.parent_id, target.parent_of_parent, (target as { mitra_id?: string | null }).mitra_id ?? null, (target as { created_by?: string | null }).created_by ?? null)) {
    return { status: 403, body: { error: "Anda tidak dapat mengubah akun ini." } };
  }
  const username = clean(input.username).toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(username)) return { status: 400, body: { error: "Username hanya huruf kecil, angka, titik, atau garis bawah." } };
  const headers = serviceHeaders(env);
  const clash = await fetch(`${env.supabaseUrl}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&id=neq.${userId}&select=id`, { headers });
  const clashRows = await readJson(clash);
  if (Array.isArray(clashRows) && clashRows.length > 0) return { status: 409, body: { error: "Username sudah dipakai." } };

  const profileUpdate = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ username, is_active: input.status !== "suspended" }),
  });
  if (!profileUpdate.ok) {
    const detail = await readJson(profileUpdate);
    return { status: 500, body: { error: detail?.message || "Profil gagal diperbarui." } };
  }

  const current = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers });
  const user = await readJson(current);
  const metadata = {
    ...(user?.user_metadata ?? {}),
    last_activity: input.status === "suspended" ? user?.user_metadata?.last_activity ?? null : new Date().toISOString(),
    full_name: clean(input.fullName),
    phone: clean(input.phone),
    business_name: clean(input.businessName),
    address: clean(input.address),
    city: clean(input.city),
    contact_email: clean(input.email),
    loket_type: clean(input.loketType) || null,
    parent_id: clean(input.parentId) || user?.user_metadata?.parent_id || null,
  };
  const saved = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ user_metadata: metadata }),
  });
  if (!saved.ok) {
    const detail = await readJson(saved);
    return { status: 500, body: { error: detail?.msg || detail?.message || "Detail akun gagal disimpan." } };
  }
  return { status: 200, body: { success: true } };
}

export async function getUserDetail(authorization: string, userId: string, env: Env) {
  const listed = await listAccounts(authorization, env);
  if (listed.status !== 200) return listed;
  const rows = listed.body.rows as Record<string, unknown>[];
  const profile = rows.find((row) => row.id === userId);
  if (!profile) return { status: 404, body: { error: "Data tidak ditemukan." } };
  const parent = rows.find((row) => row.id === profile.parent_id) ?? null;
  const grandparent = parent ? rows.find((row) => row.id === parent.parent_id) ?? null : null;
  const children = rows.filter((row) => row.parent_id === userId);
  const caller = await loadCaller(authorization, env);
  const balance = caller ? await walletBalance(env, caller.id, userId) : 0;
  return {
    status: 200,
    body: {
      profile: {
        ...profile,
        must_change_password: false,
        deleted_at: null,
        last_login_at: null,
        created_by: null,
      },
      parent,
      grandparent,
      wallet: { id: userId, balance, pending_balance: 0, status: "active" },
      total_deposit: balance,
      total_tx_count: 0,
      total_tx_volume: 0,
      total_cms: 0,
      total_os: 0,
      children,
      recent_transactions: [],
      recent_mutations: [],
      account_changes: [],
    },
  };
}

export async function allocateBalance(authorization: string, userId: string, amount: number, env: Env) {
  const caller = await loadCaller(authorization, env);
  if (!caller || caller.role !== "super_admin") return { status: 403, body: { error: "Hanya Super Admin yang dapat membagi saldo." } };
  const result = await creditWallet(env, caller.id, userId, amount);
  if (result.error || result.balance === undefined) return { status: result.status, body: { error: result.error } };
  return { status: 200, body: { success: true, balance: result.balance } };
}

export async function setManagedActive(authorization: string, userId: string, active: boolean, env: Env) {
  const caller = await loadCaller(authorization, env);
  if (!caller) return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };
  const listed = await listAccounts(authorization, env);
  const rows = (listed.body.rows ?? []) as { id: string; role: string; parent_id: string | null; parent_of_parent: string | null }[];
  const target = rows.find((row) => row.id === userId);
  const role = target ? normalizeRole(target.role) : "";
  if (!target || !canManage(caller, role, target.parent_id, target.parent_of_parent, (target as { mitra_id?: string | null }).mitra_id ?? null, (target as { created_by?: string | null }).created_by ?? null)) {
    return { status: 403, body: { error: "Anda tidak dapat mengubah status akun ini." } };
  }
  if (caller.role === "mitra" && role !== "submitra" && role !== "loket") {
    return { status: 403, body: { error: "Mitra hanya dapat mengubah status Sub Mitra dan Loket di jaringannya." } };
  }
  if (caller.role === "submitra" && role !== "loket") {
    return { status: 403, body: { error: "Sub Mitra hanya dapat mengubah status loket di bawahnya." } };
  }
  const headers = serviceHeaders(env);
  const updated = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ is_active: active }),
  });
  if (!updated.ok) return { status: 500, body: { error: "Status akun gagal diperbarui." } };
  if (active) await touchActivity(userId, env);
  return { status: 200, body: { success: true, is_active: active } };
}

function accountRole(metadata: Record<string, unknown> | undefined, storedRole: string) {
  if (storedRole) return storedRole;
  const explicit = normalizeRole(clean(metadata?.role));
  if (explicit) return explicit;
  const code = clean(metadata?.loket_code);
  const kind = clean(metadata?.loket_type);
  if (/^\d{7}$/.test(code) || kind) return "loket";
  return "";
}

async function syncRoleMetadata(
  userId: string,
  metadata: Record<string, unknown> | undefined,
  role: string,
  active: boolean,
  username: string,
  fullName: string,
  city: string,
  env: Env,
) {
  const nextName = clean(metadata?.full_name) || fullName;
  const nextCity = clean(metadata?.city) || city;
  const sameRole = normalizeRole(clean(metadata?.role)) === role;
  const sameName = clean(metadata?.full_name) === nextName;
  const sameCity = clean(metadata?.city) === nextCity;
  if (!role || (sameRole && sameName && sameCity)) return;
  await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: serviceHeaders(env),
    body: JSON.stringify({
      user_metadata: {
        ...(metadata ?? {}),
        role,
        status: active ? "active" : "suspended",
        username: clean(metadata?.username) || username,
        full_name: nextName,
        city: nextCity,
      },
    }),
  });
}

async function loadOwnProfile(userId: string, email: string, env: Env) {
  const headers = serviceHeaders(env);
  const byId = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=*`, { headers });
  const idRows = await readJson(byId);
  if (byId.ok && Array.isArray(idRows) && idRows[0]) return idRows[0] as Record<string, unknown>;
  if (!email) return null;
  const byEmail = await fetch(`${env.supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=*`, { headers });
  const emailRows = await readJson(byEmail);
  if (byEmail.ok && Array.isArray(emailRows) && emailRows[0]) return emailRows[0] as Record<string, unknown>;
  return null;
}
export async function sessionProfile(authorization: string, env: Env) {
  const token = authorization.replace(/^Bearer\s+/i, "");
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
  });
  const user = await readJson(response);
  if (!response.ok || !user?.id) return { status: 401, body: { error: "Sesi tidak valid. Silakan login ulang." } };
  const headers = serviceHeaders(env);
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const loaded = await loadOwnProfile(String(user.id), String(user.email ?? ""), env);
  let row = loaded;
  const storedRole = normalizeRole(clean(row?.role));
  const role = accountRole(metadata, storedRole);
  const username = clean(row?.username) || clean(metadata.username) || String(user.email ?? "").split("@")[0] || "akun";
  const fullName = clean(row?.full_name) || clean(metadata.full_name) || username;
  const city = clean(row?.city) || clean(metadata.city);
  const active = row ? row.is_active !== false && row.status !== "suspended" : true;
  if (!row && role) {
    await fetch(`${env.supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: user.id, username, role, is_active: true, full_name: fullName, city }),
    });
    row = { id: user.id, username, role, is_active: true, full_name: fullName, city };
  } else if (row && !storedRole && role) {
    await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ role, is_active: true, username }),
    });
    row = { ...row, role, is_active: true, username };
  } else if (row && storedRole) {
    row = { ...row, role: storedRole };
  }
  if (role) await syncRoleMetadata(user.id, metadata, role, active, username, fullName, city, env);
  if (!role) return { status: 200, body: { profile: null } };
  return {
    status: 200,
    body: {
      profile: {
        ...(row ?? {}),
        id: user.id,
        email: user.email ?? "",
        username,
        role,
        full_name: fullName,
        city,
        phone: clean(row?.phone) || clean(metadata.phone),
        business_name: clean(row?.business_name) || clean(metadata.business_name),
        address: clean(row?.address) || clean(metadata.address),
        is_active: active,
      },
    },
  };
}

export async function assignOwnRole(_authorization: string, _requested: string, _env: Env) {
  return { status: 403, body: { error: "Peran akun ditentukan oleh atasan, bukan dipilih sendiri saat login." } };
}
