import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { accountInNetwork, networkAccountIds } from "./network";
import type { Profile, AppRole } from "./supabase";

export interface ProductRow {
  id: string;
  category_id: string;
  category_slug: string;
  category_name: string;
  sku: string;
  name: string;
  provider: string;
  base_price: number;
  default_sell_price: number;
  editable_by_mitra: boolean;
  status: string;
  description: string | null;
}

export interface WalletRow {
  id: string;
  user_id: string;
  balance: number;
  pending_balance: number;
  status: string;
}

export interface LedgerRow {
  id: string;
  wallet_id: string;
  user_id: string;
  entry_type: "credit" | "debit";
  amount: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  invoice_code: string;
  user_id: string;
  product_id: string;
  product_name_snapshot: string;
  category_slug_snapshot: string;
  customer_number: string;
  amount: number;
  cost_price: number;
  sell_price: number;
  profit: number;
  status: "pending" | "success" | "failed" | "refunded";
  provider_reference: string | null;
  note: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: string;
  pinned: boolean;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

// Helper untuk dapatkan scope user IDs yang terlihat oleh current user
export function useVisibleScope() {
  const { profile, isSuperAdmin } = useAuth();
  const [descendantIds, setDescendantIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!profile) { setDescendantIds([]); setLoading(false); return; }
      if (isSuperAdmin) {
        // super admin lihat semua (kecuali diri sendiri untuk list jaringan)
        setDescendantIds([]);
        setLoading(false);
        return;
      }
      const loaded = await loadProfiles();
      const ids = loaded.scoped ? networkAccountIds(profile, loaded.rows).filter((id) => id !== profile.id) : [];
      if (active) {
        setDescendantIds(ids);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [profile, isSuperAdmin]);

  return { descendantIds, loading, isSuperAdmin };
}

function canonicalRole(role: unknown) {
  const value = String(role ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (value === "superadmin" || value === "super_admin") return "super_admin";
  if (value === "sub_mitra" || value === "submitra") return "submitra";
  if (value === "mitra" || value === "loket") return value;
  return value;
}

function mapProfileRow(row: Record<string, unknown>): Profile {
  const username = (row.username as string | null) ?? null;
  const active = row.is_active !== false && row.status !== "suspended";
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    full_name: username === "giganusantara" ? "Aris Purwanto" : String(row.full_name || username || ""),
    username,
    phone: (row.phone as string | null) ?? null,
    business_name: (row.business_name as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    role: canonicalRole(row.role) as AppRole,
    parent_id: (row.parent_id as string | null) ?? null,
    mitra_id: (row.mitra_id as string | null) ?? null,
    status: active ? "active" : "suspended",
    must_change_password: Boolean(row.must_change_password),
    loket_type: (row.loket_type as Profile["loket_type"]) ?? null,
    loket_code: (row.loket_code as string | null) ?? null,
    deleted_at: (row.deleted_at as string | null) ?? null,
    last_login_at: (row.last_login_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

async function profileTableRows() {
  const narrow = await supabase.from("profiles").select("id, username, role, is_active, created_at, updated_at");
  if (!narrow.error) return { rows: (narrow.data ?? []).map((row) => mapProfileRow(row as Record<string, unknown>)), error: null as string | null };
  const wide = await supabase.from("profiles").select("*");
  if (wide.error) return { rows: [] as Profile[], error: wide.error.message };
  return { rows: (wide.data ?? []).map((row) => mapProfileRow(row as Record<string, unknown>)), error: null };
}

async function loadProfiles() {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  const table = await profileTableRows();
  if (token) {
    const response = await fetch("/api/accounts", { headers: { Authorization: `Bearer ${token}` } });
    const text = await response.text();
    let body: { rows?: unknown; error?: string } | null = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (response.ok && Array.isArray(body?.rows)) {
      const apiRows = (body.rows as Record<string, unknown>[]).map((row) => mapProfileRow(row));
      return { rows: apiRows, scoped: true, error: null as string | null };
    }
    if (table.rows.length > 0) return { rows: table.rows, scoped: false, error: null };
    return { rows: [] as Profile[], scoped: true, error: body?.error || table.error || "Daftar akun gagal dimuat dari server." };
  }
  if (table.error) return { rows: [] as Profile[], scoped: false, error: table.error };
  return { rows: table.rows, scoped: false, error: null };
}
export function useProfiles() {
  const { profile, isSuperAdmin } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const loaded = await loadProfiles();
    if (loaded.error) {
      setError(loaded.error);
      setProfiles([]);
      setLoading(false);
      return;
    }
    const rows = loaded.rows.filter((row) => !row.deleted_at && row.id !== profile.id);
    if (!isSuperAdmin && !loaded.scoped) {
      setProfiles([]);
      setError(loaded.error);
      setLoading(false);
      return;
    }
    const visible = isSuperAdmin ? rows : rows.filter((row) => accountInNetwork(profile, row, [profile, ...rows]));
    setProfiles(visible);
    setError(null);
    setLoading(false);
  }, [profile, isSuperAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { profiles, loading, error, refresh };
}

// Hook: semua profiles (untuk dropdown parent)
export function useAllProfiles() {
  const { isSuperAdmin, profile } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!profile) return;
      const loaded = await loadProfiles();
      if (!isSuperAdmin && !loaded.scoped) {
        setProfiles(loaded.rows.filter((row) => row.id === profile.id));
      } else if (isSuperAdmin) {
        setProfiles(loaded.rows);
      } else {
        setProfiles(loaded.rows.filter((row) => row.id === profile.id || accountInNetwork(profile, row, loaded.rows)));
      }
      setLoading(false);
    })();
  }, [isSuperAdmin, profile]);

  return { profiles, loading };
}

// Hook: products + categories
export function useProducts() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("products")
      .select(`
        id, sku, name, provider, base_price, default_sell_price,
        editable_by_mitra, status, description, category_id,
        product_categories(slug, name)
      `)
      .order("name");
    if (err) { setError(err.message); setProducts([]); }
    else {
      const rows = (data ?? []).map((p: any) => ({
        id: p.id,
        category_id: p.category_id,
        category_slug: p.product_categories?.slug ?? "",
        category_name: p.product_categories?.name ?? "",
        sku: p.sku,
        name: p.name,
        provider: p.provider,
        base_price: p.base_price,
        default_sell_price: p.default_sell_price,
        editable_by_mitra: p.editable_by_mitra,
        status: p.status,
        description: p.description,
      }));
      setProducts(rows);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { products, loading, error, refresh };
}

// Hook: product categories
export function useProductCategories() {
  const [cats, setCats] = useState<{ id: string; slug: string; name: string }[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("product_categories").select("id, slug, name").order("display_order");
      setCats((data as any[]) ?? []);
    })();
  }, []);
  return cats;
}

// Hook: wallets dalam scope
export function useWallets() {
  const { profile, isSuperAdmin } = useAuth();
  const { descendantIds, loading: scopeLoading } = useVisibleScope();
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    let query = supabase.from("wallets").select("*");
    if (isSuperAdmin) {
      // semua wallet
    } else {
      const ids = [profile.id, ...descendantIds];
      if (ids.length === 0) { setWallets([]); setLoading(false); return; }
      query = query.in("user_id", ids);
    }
    const { data } = await query;
    const rows = (data as WalletRow[]) ?? [];
    setWallets(isSuperAdmin ? rows : rows.filter((row) => row.user_id === profile.id || descendantIds.includes(row.user_id)));
    setLoading(false);
  }, [profile, isSuperAdmin, descendantIds]);

  useEffect(() => { if (!scopeLoading) refresh(); }, [scopeLoading, refresh]);
  return { wallets, loading: loading || scopeLoading, refresh };
}

// Hook: wallet milik current user saja
export function useMyWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.from("wallets").select("*").eq("user_id", user.id).maybeSingle();
    if (!error && data) {
      setWallet(data as WalletRow);
      setLoading(false);
      return;
    }
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/wallet", {
      headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
    });
    const body = response.ok ? await response.json() : null;
    setWallet(body ? {
      id: user.id,
      user_id: user.id,
      balance: Number(body.balance ?? 0),
      pending_balance: 0,
      status: "active",
    } : null);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);
  return { wallet, loading, refresh };
}

// Hook: ledger dalam scope
export function useLedger() {
  const { profile, isSuperAdmin } = useAuth();
  const { descendantIds, loading: scopeLoading } = useVisibleScope();
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    let query = supabase.from("wallet_ledger").select("*").order("created_at", { ascending: false }).limit(200);
    if (!isSuperAdmin) {
      const ids = [profile.id, ...descendantIds];
      if (ids.length === 0) { setLedger([]); setLoading(false); return; }
      query = query.in("user_id", ids);
    }
    const { data } = await query;
    const rows = (data as LedgerRow[]) ?? [];
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/deposits", { headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` } });
    const body = response.ok ? await response.json() : null;
    const fromDeposits: LedgerRow[] = Array.isArray(body?.mutations) ? body.mutations.map((row: { id: string; accountId: string; direction: "credit" | "debit"; amount: number; balanceAfter: number; route: string; kind?: string; ticketId: string; note: string; actorId: string; at: string }) => ({
      id: row.id,
      wallet_id: row.accountId,
      user_id: row.accountId,
      entry_type: row.direction,
      amount: row.amount,
      balance_after: row.balanceAfter,
      reference_type: row.kind === "distribusi" ? "distribusi" : row.route === "jaringan" ? "deposit_jaringan" : "deposit_pusat",
      reference_id: row.ticketId,
      description: row.note,
      created_by: row.actorId,
      created_at: row.at,
    })) : [];
    const scoped = isSuperAdmin ? rows : rows.filter((row) => row.user_id === profile.id || descendantIds.includes(row.user_id));
    const merged = new Map<string, LedgerRow>();
    for (const row of [...fromDeposits, ...scoped]) merged.set(row.id, row);
    setLedger([...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setLoading(false);
  }, [profile, isSuperAdmin, descendantIds]);

  useEffect(() => { if (!scopeLoading) refresh(); }, [scopeLoading, refresh]);
  return { ledger, loading: loading || scopeLoading, refresh };
}

// Hook: transactions dalam scope
export function useTransactions() {
  const { profile, isSuperAdmin } = useAuth();
  const { descendantIds, loading: scopeLoading } = useVisibleScope();
  const [tx, setTx] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    let query = supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(200);
    if (!isSuperAdmin) {
      const ids = [profile.id, ...descendantIds];
      if (ids.length === 0) { setTx([]); setLoading(false); return; }
      query = query.in("user_id", ids);
    }
    const { data } = await query;
    const rows = (data as TransactionRow[]) ?? [];
    setTx(isSuperAdmin ? rows : rows.filter((row) => row.user_id === profile.id || descendantIds.includes(row.user_id)));
    setLoading(false);
  }, [profile, isSuperAdmin, descendantIds]);

  useEffect(() => { if (!scopeLoading) refresh(); }, [scopeLoading, refresh]);
  return { transactions: tx, loading: loading || scopeLoading, refresh };
}

// Hook: announcements
export function useAnnouncements() {
  const { profile } = useAuth();
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("announcements")
      .select("*")
      .eq("status", "published")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false });
    setAnnouncements((data as AnnouncementRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { announcements, loading, refresh };
}

// Hook: audit logs (super admin only)
export function useAuditLogs() {
  const { isSuperAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSuperAdmin) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setLogs((data as AuditLogRow[]) ?? []);
    setLoading(false);
  }, [isSuperAdmin]);

  useEffect(() => { refresh(); }, [refresh]);
  return { logs, loading, refresh };
}

// Hook: network summary via RPC
export function useNetworkSummary() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.rpc("get_network_summary");
    setSummary((data as Record<string, number | string>) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);
  return { summary, loading, refresh };
}

export function useNetworkLoketSales() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<TransactionRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    let stop = false;
    const load = async () => {
      const session = await supabase.auth.getSession();
      const response = await fetch("/api/loket-sales", {
        headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      });
      const body = response.ok ? await response.json() : { sales: [] };
      if (stop) return;
      setRows((body.sales ?? []).filter((sale: { channel?: string; status?: string }) => sale.channel !== "simulation" && sale.status !== "simulated").map((sale: { id: string; loketId: string; loketCode?: string; loketName?: string; category?: string; product: string; customerNumber: string; customerName?: string; amount: number; createdAt: string; status?: string }) => ({
        id: sale.id,
        invoice_code: sale.loketCode || sale.id.slice(0, 8),
        user_id: sale.loketId,
        product_id: "",
        product_name_snapshot: sale.product,
        category_slug_snapshot: (sale.category || "kolektif").toLowerCase(),
        customer_number: sale.customerNumber,
        amount: Number(sale.amount),
        cost_price: Number(sale.amount),
        sell_price: Number(sale.amount),
        profit: 0,
        status: (sale.status === "pending" || sale.status === "failed" || sale.status === "refunded" || sale.status === "success" ? sale.status : "success"),
        provider_reference: sale.loketName ?? null,
        note: sale.customerName ?? null,
        created_at: sale.createdAt,
        completed_at: sale.createdAt,
      })));
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [profile]);

  return rows;
}

// Mapping AppRole DB -> role UI lama
export function roleToUi(role: AppRole): "superadmin" | "mitra" | "submitra" | "loket" {
  if (role === "super_admin") return "superadmin";
  if (role === "mitra") return "mitra";
  if (role === "submitra") return "submitra";
  return "loket";
}
