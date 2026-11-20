import fs from "node:fs";
import path from "node:path";
import { listWalletBalances } from "./ledger";
import { setLoketActive } from "./createAccount";
import { listAccounts, networkLoketIds, setManagedActive } from "./accountAdmin";
import { ensureLoketCode, listAuthUsers } from "./loketCode";

interface Member { number: string; name: string; product?: string; createdAt?: string }
interface Bill { number: string; name: string; product?: string; period: string; total: number; status: "LUNAS" | "BL LNS" | "LAINNYA" }
interface Collective {
  id: string;
  ownerId: string;
  ownerName: string;
  loketCode: string;
  name: string;
  collector: string;
  members: Member[];
  bills: Bill[];
  history: { at: string; count: number; total: number }[];
  numbers: string[];
  status: "aktif" | "nonaktif";
  createdAt: string;
}

interface OpsFile {
  runText: string;
  runNotices: RunNotice[];
  collectives: Collective[];
}

interface RunNotice {
  id: string;
  text: string;
  authorId: string;
  authorRole: "super_admin" | "mitra";
  target: "all" | "mitra";
  mitraId: string | null;
  updatedAt: string;
  expiresAt: string;
}

const filePath = path.join(process.cwd(), "server", "data", "ops.json");

function normalizeCollective(row: Partial<Collective> & { numbers?: string[] }): Collective {
  const members = Array.isArray(row.members) && row.members.length > 0
    ? row.members
    : (row.numbers ?? []).map((number) => ({ number, name: "Pelanggan" }));
  return {
    id: row.id || crypto.randomUUID(),
    ownerId: row.ownerId || "",
    ownerName: row.ownerName || "Loket",
    loketCode: row.loketCode || "",
    name: row.name || "Kolektif",
    collector: row.collector || row.ownerName || "Loket",
    members,
    bills: Array.isArray(row.bills) ? row.bills : [],
    history: Array.isArray(row.history) ? row.history : [],
    numbers: members.map((member) => member.number),
    status: row.status === "nonaktif" ? "nonaktif" : "aktif",
    createdAt: row.createdAt || new Date().toISOString(),
  };
}

function readOps(): OpsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as OpsFile;
    return {
      runText: parsed.runText ?? "",
      runNotices: Array.isArray(parsed.runNotices) ? parsed.runNotices.filter((item) => item && typeof item.text === "string") : [],
      collectives: Array.isArray(parsed.collectives) ? parsed.collectives.map((row) => normalizeCollective(row)) : [],
    };
  } catch {
    return { runText: "", runNotices: [], collectives: [] };
  }
}

function writeOps(data: OpsFile) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch {
    // Hosting statis tidak bisa menulis file lokal. Salinan di akun tetap tersimpan.
  }
}

function serviceHeaders(env: { serviceRoleKey: string }) {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

function collectivesFromMeta(metadata: Record<string, unknown> | undefined, ownerId: string) {
  const raw = metadata?.collectives;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeCollective({ ...(item as Collective), ownerId: (item as Collective).ownerId || ownerId }));
}

async function loadOwnedCollectives(env: { supabaseUrl: string; serviceRoleKey: string }, ownerId: string) {
  const headers = serviceHeaders(env);
  const response = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${ownerId}`, { headers });
  const user = await response.json().catch(() => null);
  const users = user?.id ? [user] : [];
  let rows = user?.id ? collectivesFromMeta(user.user_metadata, user.id) : [];
  if (user?.id && rows.length === 0) {
    const filed = readOps().collectives.filter((row) => row.ownerId === user.id).map((row) => normalizeCollective(row));
    if (filed.length > 0) {
      rows = filed;
      await saveCollectives(env, users, rows);
    }
  }
  return { users, rows };
}

async function loadCollectiveUsers(env: { supabaseUrl: string; serviceRoleKey: string }) {
  const users = await listAuthUsers(env);
  let rows = users.flatMap((user) => collectivesFromMeta(user.user_metadata, user.id));
  if (rows.length === 0) {
    const filed = readOps().collectives;
    if (filed.length > 0) {
      rows = filed.map((row) => normalizeCollective(row));
      await saveCollectives(env, users, rows);
    }
  }
  return { users, rows };
}

async function saveCollectives(
  env: { supabaseUrl: string; serviceRoleKey: string },
  users: Awaited<ReturnType<typeof listAuthUsers>>,
  rows: Collective[],
) {
  const headers = serviceHeaders(env);
  const owners = new Set<string>([
    ...rows.map((row) => row.ownerId),
    ...users.filter((user) => collectivesFromMeta(user.user_metadata, user.id).length > 0).map((user) => user.id),
  ]);
  for (const ownerId of owners) {
    const user = users.find((item) => item.id === ownerId);
    if (!user) continue;
    const owned = rows.filter((row) => row.ownerId === ownerId);
    const metadata = { ...(user.user_metadata ?? {}), collectives: owned };
    const saved = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${ownerId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ user_metadata: metadata }),
    });
    if (!saved.ok) throw new Error("Grup kolektif gagal disimpan.");
    user.user_metadata = metadata;
  }
  const file = readOps();
  file.collectives = rows;
  writeOps(file);
}

function management(role: string) {
  return role === "super_admin" || role === "mitra" || role === "submitra";
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function activeNotices(notices: RunNotice[]) {
  const now = Date.now();
  return notices.filter((item) => item.text.trim() && Date.parse(item.expiresAt) > now);
}

async function mitraScope(caller: { id: string; role: string }, env: { supabaseUrl: string; serviceRoleKey: string }) {
  if (caller.role === "super_admin") return null;
  if (caller.role === "mitra") return caller.id;
  const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}` };
  const own = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${caller.id}`, { headers });
  const ownBody = await own.json().catch(() => null);
  const parentId = typeof ownBody?.user_metadata?.parent_id === "string" ? ownBody.user_metadata.parent_id : "";
  if (!parentId) return "";
  if (caller.role === "submitra") return parentId;
  const parentProfile = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${parentId}&select=role`, { headers });
  const parentRows = await parentProfile.json().catch(() => null);
  const parentRole = Array.isArray(parentRows) ? parentRows[0]?.role : "";
  if (parentRole === "mitra") return parentId;
  const parentUser = await fetch(`${env.supabaseUrl}/auth/v1/admin/users/${parentId}`, { headers });
  const parentBody = await parentUser.json().catch(() => null);
  return typeof parentBody?.user_metadata?.parent_id === "string" ? parentBody.user_metadata.parent_id : "";
}

function noticeVisible(item: RunNotice, callerRole: string, mitraId: string | null, callerId: string) {
  if (item.authorRole === "super_admin") {
    if (callerRole !== "mitra") return false;
    if (item.target === "all") return true;
    return item.mitraId === callerId;
  }
  if (item.authorRole === "mitra") {
    if (callerRole !== "submitra" && callerRole !== "loket") return false;
    return item.authorId === mitraId || item.mitraId === mitraId;
  }
  return false;
}

function mapMembers(body: Record<string, unknown>, previous: Member[] = []) {
  const source = Array.isArray(body.members)
    ? body.members
    : (Array.isArray(body.numbers) ? body.numbers.map((item) => ({ number: item, name: "Pelanggan", product: "" })) : null);
  if (!source) return null;
  return source.map((item) => {
    const number = String((item as Member)?.number ?? "").trim();
    const current = previous.find((member) => member.number === number);
    return {
      number,
      name: String((item as Member)?.name ?? "").trim() || "Pelanggan",
      product: String((item as Member)?.product ?? "").trim(),
      createdAt: current?.createdAt || new Date().toISOString(),
    };
  }).filter((item) => item.number);
}

async function ownedLoket(authorization: string, env: { supabaseUrl: string; anonKey: string; serviceRoleKey: string }, ownerId: string) {
  const listed = await listAccounts(authorization, env);
  const rows = (listed.body.rows ?? []) as { id: string; role: string; username?: string; full_name?: string; loket_code?: string | null }[];
  return rows.find((row) => row.id === ownerId && row.role === "loket") ?? null;
}

export async function handleOpsRequest(
  method: string,
  pathname: string,
  body: Record<string, unknown>,
  caller: { id: string; role: string; username: string | null },
  authorization: string,
  env: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
) {
  if (pathname === "/api/kolektif" || pathname === "/api/kolektif/bills") {
    const scope = caller.role === "loket" ? [caller.id] : await networkLoketIds(authorization, env);
    const visible = (row: Collective) => scope === null || scope.includes(row.ownerId) || row.ownerId === caller.id;
    const stored = caller.role === "loket" ? await loadOwnedCollectives(env, caller.id) : await loadCollectiveUsers(env);
    if (pathname === "/api/kolektif" && method === "GET") {
      return { status: 200, body: { rows: stored.rows.filter(visible) } };
    }
    if (pathname === "/api/kolektif" && method === "POST") {
      if (caller.role !== "loket" && !management(caller.role)) return { status: 403, body: { error: "Anda tidak dapat menyimpan kolektif." } };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const existingId = typeof body.id === "string" ? body.id : "";
      const rows = stored.rows;
      if (existingId) {
        const row = rows.find((item) => item.id === existingId && (item.ownerId === caller.id || management(caller.role)));
        if (!row || (caller.role === "loket" && row.ownerId !== caller.id)) return { status: 404, body: { error: "Kelompok kolektif tidak ditemukan." } };
        if (!visible(row)) return { status: 404, body: { error: "Kelompok kolektif tidak ditemukan." } };
        if (body.action === "delete") {
          const next = rows.filter((item) => item.id !== existingId);
          await saveCollectives(env, stored.users, next);
          return { status: 200, body: { row } };
        }
        if (name) row.name = name;
        if (typeof body.collector === "string" && body.collector.trim()) row.collector = body.collector.trim();
        if (body.status === "aktif" || body.status === "nonaktif") row.status = body.status;
        const members = mapMembers(body, row.members);
        if (members) {
          row.members = members;
          row.numbers = members.map((item) => item.number);
        }
        if (management(caller.role) && typeof body.ownerId === "string" && body.ownerId && body.ownerId !== row.ownerId) {
          const loket = await ownedLoket(authorization, env, body.ownerId);
          if (!loket) return { status: 403, body: { error: "Loket tujuan tidak ada di jaringan Anda." } };
          row.ownerId = loket.id;
          row.ownerName = loket.full_name || loket.username || "Loket";
          row.loketCode = loket.loket_code || "";
        }
        await saveCollectives(env, stored.users, rows);
        return { status: 200, body: { row } };
      }
      if (!name) return { status: 400, body: { error: "Nama kolektif wajib diisi." } };
      let ownerId = caller.id;
      let ownerName = caller.username || "Akun";
      let loketCode = caller.role === "loket" ? await ensureLoketCode(env, caller.id) : "";
      if (management(caller.role)) {
        const requested = typeof body.ownerId === "string" ? body.ownerId : "";
        if (!requested) return { status: 400, body: { error: "Pilih loket pemilik grup." } };
        const loket = await ownedLoket(authorization, env, requested);
        if (!loket) return { status: 403, body: { error: "Loket tujuan tidak ada di jaringan Anda." } };
        ownerId = loket.id;
        ownerName = loket.full_name || loket.username || "Loket";
        loketCode = loket.loket_code || "";
      }
      const row = normalizeCollective({
        id: crypto.randomUUID(),
        ownerId,
        ownerName,
        loketCode,
        name,
        collector: typeof body.collector === "string" && body.collector.trim() ? body.collector.trim() : name,
        members: mapMembers(body) ?? [],
        status: body.status === "nonaktif" ? "nonaktif" : "aktif",
        createdAt: new Date().toISOString(),
      });
      rows.unshift(row);
      await saveCollectives(env, stored.users, rows);
      return { status: 200, body: { row } };
    }
    if (pathname === "/api/kolektif/bills" && method === "POST") {
      if (caller.role !== "loket") return { status: 403, body: { error: "Hanya Loket yang dapat memperbarui daftar tagihan." } };
      const row = stored.rows.find((item) => item.id === String(body.id ?? "") && item.ownerId === caller.id);
      if (!row) return { status: 404, body: { error: "Kelompok kolektif tidak ditemukan." } };
      const bills = Array.isArray(body.bills) ? body.bills as Bill[] : [];
      row.bills = bills.map((bill) => ({
        number: String(bill.number ?? ""),
        name: String(bill.name ?? "Pelanggan"),
        product: String(bill.product ?? ""),
        period: String(bill.period ?? ""),
        total: Number(bill.total) || 0,
        status: bill.status === "LUNAS" || bill.status === "LAINNYA" ? bill.status : "BL LNS",
      }));
      if (body.paid === true) {
        const paid = row.bills.filter((bill) => bill.status === "LUNAS");
        const count = Number(body.paidCount);
        const total = Number(body.paidTotal);
        row.history.unshift({
          at: new Date().toISOString(),
          count: Number.isFinite(count) && count > 0 ? count : paid.length,
          total: Number.isFinite(total) && total > 0 ? total : paid.reduce((sum, bill) => sum + bill.total, 0),
        });
      }
      await saveCollectives(env, stored.users, stored.rows);
      return { status: 200, body: { row } };
    }
  }

  if (!management(caller.role) && pathname !== "/api/runtext") return null;

  if (pathname === "/api/runtext" && method === "GET") {
    const data = readOps();
    const mitraId = await mitraScope(caller, env);
    const visible = activeNotices(data.runNotices)
      .filter((item) => noticeVisible(item, caller.role, mitraId, caller.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const editable = caller.role === "super_admin"
      ? activeNotices(data.runNotices).filter((item) => item.authorRole === "super_admin")
      : caller.role === "mitra"
        ? activeNotices(data.runNotices).filter((item) => item.authorId === caller.id)
        : [];
    return { status: 200, body: { text: visible[0]?.text ?? "", notices: editable } };
  }
  if (pathname === "/api/runtext" && method === "POST") {
    if (caller.role !== "super_admin" && caller.role !== "mitra") {
      return { status: 403, body: { error: "Hanya Super Admin dan Mitra yang dapat menulis running text." } };
    }
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 240) : "";
    const data = readOps();
    data.runText = "";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + WEEK_MS).toISOString();
    if (caller.role === "mitra") {
      data.runNotices = data.runNotices.filter((item) => item.authorId !== caller.id);
      if (text) {
        data.runNotices.unshift({
          id: crypto.randomUUID(),
          text,
          authorId: caller.id,
          authorRole: "mitra",
          target: "mitra",
          mitraId: caller.id,
          updatedAt: now.toISOString(),
          expiresAt,
        });
      }
    } else {
      const target = body.target === "mitra" ? "mitra" : "all";
      const mitraId = target === "mitra" && typeof body.mitraId === "string" ? body.mitraId : null;
      if (target === "mitra" && !mitraId) return { status: 400, body: { error: "Pilih mitra tujuan." } };
      data.runNotices = data.runNotices.filter((item) => !(item.authorRole === "super_admin" && item.target === target && item.mitraId === mitraId));
      if (text) {
        data.runNotices.unshift({
          id: crypto.randomUUID(),
          text,
          authorId: caller.id,
          authorRole: "super_admin",
          target,
          mitraId,
          updatedAt: now.toISOString(),
          expiresAt,
        });
      }
    }
    writeOps(data);
    return { status: 200, body: { text } };
  }
  if (pathname === "/api/account-status" && method === "POST") {
    return setManagedActive(authorization, String(body.userId ?? ""), body.active !== false, env);
  }
  if (pathname === "/api/balances" && method === "GET") {
    const wallets = await listWalletBalances(env, caller.id);
    if (caller.role === "super_admin") return { status: 200, body: { wallets } };
    const scope = await networkLoketIds(authorization, env);
    const allowed = new Set([caller.id, ...(scope ?? [])]);
    const visible = Object.fromEntries(Object.entries(wallets).filter(([id]) => allowed.has(id)));
    return { status: 200, body: { wallets: visible } };
  }
  if (pathname === "/api/block-loket" && method === "POST") {
    const result = await setLoketActive(authorization, String(body.userId ?? ""), body.active !== false, env);
    return result;
  }
  return null;
}
