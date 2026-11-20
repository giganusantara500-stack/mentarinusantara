interface Env {
  supabaseUrl: string;
  serviceRoleKey: string;
}

interface AuthUser {
  id: string;
  user_metadata?: Record<string, unknown>;
}

function headers(env: Env) {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

export function codeFromMetadata(metadata: Record<string, unknown> | undefined) {
  const code = metadata?.loket_code;
  return typeof code === "string" && /^\d{7}$/.test(code) ? code : "";
}

export function makeLoketCode(taken: Set<string>) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(1000000 + Math.floor(Math.random() * 9000000));
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  let cursor = 1000000;
  while (taken.has(String(cursor))) cursor += 1;
  const code = String(cursor);
  taken.add(code);
  return code;
}

export function makeTransferCode(used: Set<string>) {
  const start = Math.floor(Math.random() * 999);
  for (let step = 0; step < 999; step += 1) {
    const code = String(((start + step) % 999) + 1).padStart(3, "0");
    if (!used.has(code)) return code;
  }
  let cursor = 1;
  while (used.has(String(cursor).padStart(3, "0")) && cursor < 1000) cursor += 1;
  return String(cursor === 1000 ? 1 : cursor).padStart(3, "0");
}

export async function listAuthUsers(env: Env): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: headers(env) });
    const body = await response.json().catch(() => null);
    const batch = Array.isArray(body?.users) ? body.users as AuthUser[] : [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function saveCode(env: Env, user: AuthUser, code: string) {
  await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: headers(env),
    body: JSON.stringify({ user_metadata: { ...(user.user_metadata ?? {}), loket_code: code } }),
  });
}

export async function assignMissingLoketCodes(env: Env, users: AuthUser[], loketIds: string[]) {
  const taken = new Set(users.map((user) => codeFromMetadata(user.user_metadata)).filter(Boolean));
  const codes = new Map<string, string>();
  users.forEach((user) => {
    const code = codeFromMetadata(user.user_metadata);
    if (code) codes.set(user.id, code);
  });
  for (const id of loketIds) {
    if (codes.has(id)) continue;
    const user = users.find((item) => item.id === id);
    const code = makeLoketCode(taken);
    codes.set(id, code);
    if (user) await saveCode(env, user, code);
  }
  return codes;
}

export async function loketCodeFor(env: Env, userId: string) {
  const response = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${userId}`, { headers: headers(env) });
  const payload = await response.json().catch(() => null) as { user?: AuthUser } & AuthUser | null;
  const user = payload?.user?.id ? payload.user : payload;
  const existing = codeFromMetadata(user?.user_metadata);
  if (existing) return existing;
  const code = makeLoketCode(new Set());
  if (user?.id) await saveCode(env, user, code);
  return code;
}

export async function ensureLoketCode(env: Env, userId: string) {
  const users = await listAuthUsers(env);
  const codes = await assignMissingLoketCodes(env, users, [userId]);
  return codes.get(userId) ?? "";
}
