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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const code = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    if (code !== "000" && !used.has(code)) return code;
  }
  return String((Date.now() % 999) + 1).padStart(3, "0");
}

export async function listAuthUsers(env: Env): Promise<AuthUser[]> {
  const response = await fetch(`${env.supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers: headers(env) });
  const body = await response.json().catch(() => null);
  return Array.isArray(body?.users) ? body.users : [];
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

export async function ensureLoketCode(env: Env, userId: string) {
  const users = await listAuthUsers(env);
  const codes = await assignMissingLoketCodes(env, users, [userId]);
  return codes.get(userId) ?? "";
}
