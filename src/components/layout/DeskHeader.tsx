import { useEffect, useState } from "react";
import { BadgeAlert, Landmark, LogOut, Receipt, RefreshCw, RotateCw, Store, SunMedium, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";

export function useDeskStats(tick: number) {
  const { profile } = useAuth();
  const [balance, setBalance] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [todayAmount, setTodayAmount] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [loketCode, setLoketCode] = useState("");
  const [runText, setRunText] = useState("");

  useEffect(() => {
    if (!profile) return;
    let active = true;
    (async () => {
      const session = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
      const [walletRes, salesRes, txRes, runRes] = await Promise.all([
        fetch("/api/wallet", { headers }),
        fetch("/api/loket-sales", { headers }),
        supabase.from("transactions").select("amount,status,created_at").eq("user_id", profile.id),
        fetch("/api/runtext", { headers }),
      ]);
      const wallet = walletRes.ok ? await walletRes.json() : null;
      const salesBody = salesRes.ok ? await salesRes.json() : { sales: [] };
      const sales = (salesBody.sales ?? []) as { amount: number; createdAt: string; status: string }[];
      const remote = (txRes.data ?? []) as { amount: number; status: string; created_at: string }[];
      const today = new Date().toDateString();
      const todaySales = sales.filter((sale) => new Date(sale.createdAt).toDateString() === today);
      const todayRemote = remote.filter((row) => new Date(row.created_at).toDateString() === today);
      const pending = remote.filter((row) => row.status === "pending").reduce((sum, row) => sum + Number(row.amount), 0);
      if (!active) return;
      setBalance(Number(wallet?.balance ?? salesBody.balance ?? 0));
      setTodayCount(todaySales.length + todayRemote.length);
      setTodayAmount(todaySales.reduce((sum, sale) => sum + Number(sale.amount), 0) + todayRemote.reduce((sum, row) => sum + Number(row.amount), 0));
      setOutstanding(pending);
      setLoketCode(String(wallet?.loketCode || salesBody.loketCode || profile.loket_code || ""));
      const runBody = runRes.ok ? await runRes.json() : null;
      setRunText(String(runBody?.text ?? ""));
    })();
    return () => { active = false; };
  }, [profile, tick]);

  return { balance, todayCount, todayAmount, outstanding, loketCode, runText };
}

interface HeaderProps {
  brand: string;
  stats: ReturnType<typeof useDeskStats>;
  onDeposit: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}

export function DeskHeader({ brand, stats, onDeposit, onRefresh, onLogout }: HeaderProps) {
  const { profile } = useAuth();
  if (!profile) return null;
  const code = stats.loketCode || profile.loket_code || "";
  const deskName = profile.business_name || profile.full_name || profile.username || "Loket";
  const identity = code ? `${code} - ${deskName}` : deskName;

  return (
    <header className="shrink-0">
      <div className="flex h-14 items-center justify-between gap-3 bg-neutral-950 px-4 text-white md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-950">
            <SunMedium size={20} />
          </span>
          <span className="truncate text-sm font-bold tracking-tight">{brand}</span>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button onClick={onDeposit} className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-900">
            <Landmark size={15} /> Deposit
          </button>
          <button onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold">
            <RefreshCw size={15} /> Update
          </button>
          <button onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold">
            <RotateCw size={15} /> Refresh
          </button>
          <button onClick={onLogout} className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 py-1.5 text-xs font-bold" aria-label="Logout">
            <LogOut size={15} /> Logout
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-stretch justify-start border-b border-slate-200 bg-white text-slate-900">
        <Stat icon={Wallet} tone="bg-cyan-400 text-sky-950" label="Saldo" value={formatRupiah(stats.balance)} />
        <Stat icon={BadgeAlert} tone="bg-yellow-300 text-amber-950" label="OS" value={formatRupiah(stats.outstanding)} />
        <Stat icon={Receipt} tone="bg-lime-400 text-green-950" label="Trx Hari Ini" value={`${stats.todayCount} · ${formatRupiah(stats.todayAmount)}`} />
        <Stat icon={Store} tone="bg-sky-950 text-white" label="Loket" value={identity} hint={profile.username || deskName} />
      </div>
      <div className="h-7 overflow-hidden bg-orange-500 text-xs font-bold text-white">
        <div className={cn("flex h-full items-center whitespace-nowrap px-4", stats.runText && "animate-ticker")}>
          {stats.runText || "Tidak ada pengumuman saat ini."}
        </div>
      </div>
    </header>
  );
}

function Stat({ icon: Icon, tone, label, value, hint }: { icon: typeof Wallet; tone: string; label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-r border-slate-200 px-4 py-2 last:border-r-0">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", tone)}>
        <Icon size={16} strokeWidth={2.4} />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="block truncate text-sm font-bold leading-tight">{value}</span>
        {hint && <span className="block truncate text-[11px] font-medium text-slate-500">{hint}</span>}
      </span>
    </div>
  );
}
