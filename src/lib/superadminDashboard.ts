import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import type { TransactionRow } from "./hooks";

export type AccountRole = "mitra" | "submitra" | "loket";

export interface AccountRow {
  id: string;
  role: AccountRole;
  name: string;
  parent_name: string | null;
  status: string;
  tx_count: number;
  volume: number;
  cms: number;
  deposit: number;
  balance: number;
}

export interface SuperAdminDashboardData {
  summary: {
    total_tx: number;
    success_tx: number;
    failed_tx: number;
    pending_tx: number;
    volume: number;
    profit: number;
    deposit_total: number;
    total_balance: number;
    active_accounts: number;
    total_mitra: number;
    total_submitra: number;
    total_loket: number;
    today_tx: number;
    today_volume: number;
    today_cms: number;
  };
  daily: { date: string; count: number; volume: number; profit: number }[];
  monthly: { month: string; count: number; volume: number; profit: number }[];
  network_growth: { month: string; mitra: number; submitra: number; loket: number }[];
  recent: {
    id: string;
    invoice: string;
    product: string;
    customer: string;
    amount: number;
    profit: number;
    status: TransactionRow["status"];
    created_at: string;
    user_name: string;
  }[];
  accounts: AccountRow[];
}

// Hook: data dashboard Super Admin dari tabel profiles, transaksi bila ada, dan tiket deposit.
export function useSuperAdminDashboard(start: string, end: string, root: string | null) {
  const { isSuperAdmin } = useAuth();
  const [data, setData] = useState<SuperAdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("*");
      if (!active) return;
      if (profileError || !profileRows) {
        setError(profileError?.message ?? "Data profil tidak dapat dimuat");
        setData(null);
        setLoading(false);
        return;
      }

      const profiles = (profileRows as { id: string; username: string | null; role: string; is_active?: boolean | null; status?: string | null; created_at: string }[])
        .map((row) => ({
          ...row,
          role: row.role === "sub_mitra" ? "submitra" : row.role,
          name: row.username === "giganusantara" ? "Aris Purwanto" : (row.username || "Tanpa nama"),
          active: row.is_active !== false && row.status !== "suspended",
        }));
      const accounts = profiles.filter((row) => row.role === "mitra" || row.role === "submitra" || row.role === "loket");
      const visible = root ? accounts.filter((row) => row.id === root) : accounts;

      const txQuery = await supabase
        .from("transactions")
        .select("id, invoice_code, product_name_snapshot, customer_number, amount, profit, status, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(500);
      const transactions = txQuery.error ? [] : (txQuery.data ?? []);
      const scopedTx = transactions.filter((tx) => !root || tx.user_id === root);
      const inRange = scopedTx.filter((tx) => {
        const day = String(tx.created_at).slice(0, 10);
        return day >= start && day <= end;
      });
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      const todayTx = scopedTx.filter((tx) => String(tx.created_at).slice(0, 10) === today && tx.status === "success");

      const session = await supabase.auth.getSession();
      const depositResponse = await fetch("/api/deposits", {
        headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      });
      const depositBody = depositResponse.ok ? await depositResponse.json() : { tickets: [] };
      const tickets = (depositBody.tickets ?? []) as { loketId: string; amount: number; status: string; decidedAt: string | null; transferAt: string }[];
      const approved = tickets.filter((ticket) => ticket.status === "approved" && (!root || ticket.loketId === root));
      const depositByLoket = new Map<string, number>();
      approved.forEach((ticket) => depositByLoket.set(ticket.loketId, (depositByLoket.get(ticket.loketId) ?? 0) + Number(ticket.amount)));

      const sum = (rows: typeof inRange, field: "amount" | "profit") =>
        rows.filter((tx) => tx.status === "success").reduce((total, tx) => total + Number(tx[field] ?? 0), 0);

      const dailyMap = new Map<string, { count: number; volume: number; profit: number }>();
      inRange.forEach((tx) => {
        const date = String(tx.created_at).slice(0, 10);
        const current = dailyMap.get(date) ?? { count: 0, volume: 0, profit: 0 };
        current.count += 1;
        if (tx.status === "success") {
          current.volume += Number(tx.amount ?? 0);
          current.profit += Number(tx.profit ?? 0);
        }
        dailyMap.set(date, current);
      });

      const monthKey = (value: string) => value.slice(0, 7);
      const monthlyMap = new Map<string, { count: number; volume: number; profit: number }>();
      scopedTx.forEach((tx) => {
        const month = monthKey(String(tx.created_at));
        const current = monthlyMap.get(month) ?? { count: 0, volume: 0, profit: 0 };
        current.count += 1;
        if (tx.status === "success") {
          current.volume += Number(tx.amount ?? 0);
          current.profit += Number(tx.profit ?? 0);
        }
        monthlyMap.set(month, current);
      });
      const growthMap = new Map<string, { mitra: number; submitra: number; loket: number }>();
      accounts.forEach((account) => {
        const month = monthKey(account.created_at || today);
        const current = growthMap.get(month) ?? { mitra: 0, submitra: 0, loket: 0 };
        if (account.role === "mitra" || account.role === "submitra" || account.role === "loket") current[account.role] += 1;
        growthMap.set(month, current);
      });

      const result: SuperAdminDashboardData = {
        summary: {
          total_tx: inRange.length,
          success_tx: inRange.filter((tx) => tx.status === "success").length,
          failed_tx: inRange.filter((tx) => tx.status === "failed").length,
          pending_tx: inRange.filter((tx) => tx.status === "pending").length,
          volume: sum(inRange, "amount"),
          profit: sum(inRange, "profit"),
          deposit_total: approved.reduce((total, ticket) => total + Number(ticket.amount), 0),
          total_balance: [...depositByLoket.values()].reduce((total, value) => total + value, 0),
          active_accounts: visible.filter((account) => account.active).length,
          total_mitra: accounts.filter((account) => account.role === "mitra").length,
          total_submitra: accounts.filter((account) => account.role === "submitra").length,
          total_loket: accounts.filter((account) => account.role === "loket").length,
          today_tx: todayTx.length,
          today_volume: todayTx.reduce((total, tx) => total + Number(tx.amount ?? 0), 0),
          today_cms: todayTx.reduce((total, tx) => total + Number(tx.profit ?? 0), 0),
        },
        daily: [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value })),
        monthly: [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, value]) => ({ month, ...value })),
        network_growth: [...growthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, ...value })),
        recent: inRange.slice(0, 10).map((tx) => ({
          id: tx.id,
          invoice: tx.invoice_code,
          product: tx.product_name_snapshot,
          customer: tx.customer_number,
          amount: Number(tx.amount ?? 0),
          profit: Number(tx.profit ?? 0),
          status: tx.status,
          created_at: tx.created_at,
          user_name: profiles.find((profile) => profile.id === tx.user_id)?.name ?? "—",
        })),
        accounts: visible.map((account) => ({
          id: account.id,
          role: account.role as AccountRole,
          name: account.name,
          parent_name: null,
          status: account.active ? "active" : "suspended",
          tx_count: scopedTx.filter((tx) => tx.user_id === account.id).length,
          volume: scopedTx.filter((tx) => tx.user_id === account.id && tx.status === "success").reduce((total, tx) => total + Number(tx.amount ?? 0), 0),
          cms: scopedTx.filter((tx) => tx.user_id === account.id && tx.status === "success").reduce((total, tx) => total + Number(tx.profit ?? 0), 0),
          deposit: depositByLoket.get(account.id) ?? 0,
          balance: depositByLoket.get(account.id) ?? 0,
        })),
      };
      if (!active) return;
      setData(result);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [isSuperAdmin, start, end, root]);

  return { data, loading, error };
}
