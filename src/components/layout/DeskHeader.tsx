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
      const pending = remote.filter((row) => row.status === "pending").reduce((sum, row) => sum + Number(row.amount), 0);
      if (!active) return;
      setBalance(Number(wallet?.balance ?? salesBody.balance ?? 0));
      setTodayCount(todaySales.length);
      setTodayAmount(todaySales.reduce((sum, sale) => sum + Number(sale.amount), 0));
      setOutstanding(pending);
      setLoketCode(String(wallet?.loketCode || salesBody.loketCode || profile.loket_code || ""));
      const runBody = runRes.ok ? await runRes.json() : null;
      setRunText(String(runBody?.text ?? ""));
    })();
    return () => { active = false; };
  }, [profile, tick]);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const session = await supabase.auth.getSession();
        const headers = { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` };
        const [walletRes, salesRes] = await Promise.all([
          fetch("/api/wallet", { headers }),
          fetch("/api/loket-sales", { headers }),
        ]);
        if (walletRes.ok) {
          const wallet = await walletRes.json();
          setBalance(Number(wallet.balance ?? 0));
          if (wallet.loketCode) setLoketCode(String(wallet.loketCode));
        }
        if (salesRes.ok) {
          const body = await salesRes.json();
          const sales = (body.sales ?? []) as { amount: number; createdAt: string }[];
          const today = new Date().toDateString();
          const todaySales = sales.filter((sale) => new Date(sale.createdAt).toDateString() === today);
          setTodayCount(todaySales.length);
          setTodayAmount(todaySales.reduce((sum, sale) => sum + Number(sale.amount), 0));
        }
      })();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [profile]);

  return { balance, todayCount, todayAmount, outstanding, loketCode, runText };
}

interface HeaderProps {
  brand: string;
  stats: ReturnType<typeof useDeskStats>;
  onDeposit: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  showStats?: boolean;
}

export function DeskHeader({ brand, stats, onDeposit, onRefresh, onLogout, showStats = true }: HeaderProps) {
  const { profile } = useAuth();
  if (!profile) return null;
  const code = stats.loketCode || profile.loket_code || "";
  const deskName = profile.business_name || profile.full_name || profile.username || "Loket";
  const identity = code ? `${code} - ${deskName}` : deskName;

  return (
    <header className="shrink-0">
      <div className="flex h-12 items-center justify-between gap-2 bg-neutral-950 px-3 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-neutral-950">
            <SunMedium size={22} strokeWidth={2.6} />
          </span>
          <span className="truncate text-base font-black tracking-tight">{brand}</span>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <button onClick={onDeposit} className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-2.5 py-1 text-sm font-black text-slate-900">
            <Landmark size={18} strokeWidth={2.6} /> Deposit
          </button>
          <button onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-sm font-black">
            <RefreshCw size={18} strokeWidth={2.6} /> Update
          </button>
          <button onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-sm font-black">
            <RotateCw size={18} strokeWidth={2.6} /> Refresh
          </button>
          <button onClick={onLogout} className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-2.5 py-1 text-sm font-black" aria-label="Logout">
            <LogOut size={18} strokeWidth={2.6} /> Logout
          </button>
        </div>
      </div>
      {showStats && (
        <div className="flex w-full items-stretch justify-start gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 text-slate-900">
          <Stat icon={Wallet} tone="bg-cyan-400 text-sky-950" label="Saldo" value={formatRupiah(stats.balance)} className="w-[190px]" />
          <Stat icon={BadgeAlert} tone="bg-yellow-300 text-amber-950" label="OS" value={formatRupiah(stats.outstanding)} className="w-[190px]" />
          <Stat icon={Receipt} tone="bg-lime-400 text-green-950" label="Trx Hari Ini" value={`${stats.todayCount} · ${formatRupiah(stats.todayAmount)}`} className="w-[190px]" />
          <Stat icon={Store} tone="bg-sky-950 text-white" label="Loket" value={identity} hint={profile.username || deskName} wrap className="min-w-[300px] max-w-[380px]" />
        </div>
      )}
      <div className="h-7 overflow-hidden bg-orange-500 text-sm font-black text-white">
        <div className={cn("flex h-full items-center whitespace-nowrap px-4", stats.runText && "animate-ticker")}>
          {stats.runText || "Tidak ada pengumuman saat ini."}
        </div>
      </div>
    </header>
  );
}

function Stat({ icon: Icon, tone, label, value, hint, wrap, className }: { icon: typeof Wallet; tone: string; label: string; value: string; hint?: string; wrap?: boolean; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5", className)}>
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", tone)}>
        <Icon size={18} strokeWidth={2.6} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-black uppercase tracking-wide text-slate-600">{label}</span>
        <span className={cn("block text-sm font-black leading-tight tabular-nums", wrap ? "whitespace-normal break-words" : "truncate")}>{value}</span>
        {hint && <span className={cn("mt-0.5 block text-xs font-bold text-slate-600", wrap ? "whitespace-normal break-words" : "truncate")}>{hint}</span>}
      </span>
    </div>
  );
}
