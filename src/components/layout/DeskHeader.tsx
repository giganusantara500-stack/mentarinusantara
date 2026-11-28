import { useEffect, useState, type CSSProperties } from "react";
import { BadgeAlert, Landmark, LogOut, Receipt, RefreshCw, RotateCw, Store, SunMedium, Wallet } from "lucide-react";
import { WindowCaptionButtons } from "@/components/layout/WindowCaption";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { finiteNumber, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/apiBase";

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
      const [walletRes, salesRes, runRes] = await Promise.all([
        fetch(apiUrl("/api/wallet"), { headers }),
        fetch(apiUrl("/api/loket-sales"), { headers }),
        fetch("/api/runtext", { headers }),
      ]);
      const wallet = walletRes.ok ? await walletRes.json() : null;
      const salesBody = salesRes.ok ? await salesRes.json() : { sales: [] };
      const sales = (salesBody.sales ?? []) as { amount: number; createdAt: string; status: string }[];
      const today = new Date().toDateString();
      const settled = (sale: { status: string }) => sale.status === "success" || sale.status === "simulated";
      const todaySales = sales.filter((sale) => settled(sale) && new Date(sale.createdAt).toDateString() === today);
      const pending = sales.filter((sale) => sale.status === "pending").reduce((sum, sale) => sum + finiteNumber(sale.amount), 0);
      if (!active) return;
      setBalance(finiteNumber(wallet?.balance ?? salesBody.balance));
      setTodayCount(todaySales.length);
      setTodayAmount(todaySales.reduce((sum, sale) => sum + finiteNumber(sale.amount), 0));
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
        const [walletRes, salesRes, runRes] = await Promise.all([
          fetch(apiUrl("/api/wallet"), { headers }),
          fetch(apiUrl("/api/loket-sales"), { headers }),
          fetch("/api/runtext", { headers }),
        ]);
        if (walletRes.ok) {
          const wallet = await walletRes.json();
          setBalance(finiteNumber(wallet.balance));
          if (wallet.loketCode) setLoketCode(String(wallet.loketCode));
        }
        if (runRes.ok) {
          const runBody = await runRes.json();
          setRunText(String(runBody?.text ?? ""));
        }
        if (salesRes.ok) {
          const body = await salesRes.json();
          const sales = (body.sales ?? []) as { amount: number; createdAt: string; status?: string }[];
          const today = new Date().toDateString();
          const settled = (sale: { status?: string }) => sale.status === "success" || sale.status === "simulated";
          const todaySales = sales.filter((sale) => settled(sale) && new Date(sale.createdAt).toDateString() === today);
          setTodayCount(todaySales.length);
          setTodayAmount(todaySales.reduce((sum, sale) => sum + finiteNumber(sale.amount), 0));
          setOutstanding(sales.filter((sale) => sale.status === "pending").reduce((sum, sale) => sum + finiteNumber(sale.amount), 0));
        }
      })();
    }, 5000);
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
  version?: string;
}

export function DeskHeader({ brand, stats, onDeposit, onRefresh, onLogout, showStats = true, version }: HeaderProps) {
  const { profile, user } = useAuth();
  if (!profile) return null;
  const mfaOn = profile.role === "mitra" || user?.user_metadata?.mfa_enabled === true || user?.user_metadata?.mfa_status === true || user?.user_metadata?.mfa_status === "active";
  const code = stats.loketCode || profile.loket_code || "";
  const deskName = profile.business_name || profile.full_name || profile.username || "Loket";
  const identity = code ? `${code} - ${deskName}` : deskName;

  return (
    <header className="shrink-0">
      <div className="flex h-12 items-stretch bg-neutral-950 text-white" data-loket-caption="desk">
        <div className="flex min-w-0 items-center gap-2 px-3" style={{ WebkitAppRegion: "drag" } as CSSProperties} onDoubleClick={() => window.loketDesktop?.maximizeToggle()}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-neutral-950">
            <SunMedium size={22} strokeWidth={2.6} />
          </span>
          <span className="truncate text-base font-black tracking-tight">{brand}</span>
          {version && <span className="shrink-0 text-[11px] font-semibold text-amber-200">{version}</span>}
        </div>
        <div className="ml-auto flex min-w-0 items-center">
          <div className="flex items-center gap-1.5 overflow-x-auto px-2" style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
            <button onClick={onDeposit} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-2.5 py-1 text-sm font-black text-slate-900">
              <Landmark size={18} strokeWidth={2.6} /> Deposit
            </button>
            <button onClick={onRefresh} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-sm font-black">
              <RefreshCw size={18} strokeWidth={2.6} /> Update
            </button>
            <button onClick={onRefresh} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-sm font-black">
              <RotateCw size={18} strokeWidth={2.6} /> Refresh
            </button>
            {mfaOn && profile.role === "mitra" && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-400 px-2.5 py-1 text-sm font-black text-slate-950">2FA Aktif</span>
            )}
            <button onClick={onLogout} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/30 px-2.5 py-1 text-sm font-black" aria-label="Logout">
              <LogOut size={18} strokeWidth={2.6} /> Logout
            </button>
          </div>
          <WindowCaptionButtons />
        </div>
      </div>
      {showStats && (
        <div className="flex w-full items-stretch justify-start gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 text-slate-900">
          <Stat icon={Wallet} tone="bg-cyan-400 text-sky-950" label="Saldo" value={formatRupiah(stats.balance)} className="w-[220px]" />
          <Stat icon={BadgeAlert} tone="bg-yellow-300 text-amber-950" label="OS" value={formatRupiah(stats.outstanding)} className="w-[190px]" />
          <Stat icon={Receipt} tone="bg-lime-400 text-green-950" label="Trx Hari Ini" value={`${stats.todayCount} · ${formatRupiah(stats.todayAmount)}`} className="w-[190px]" />
          <Stat icon={Store} tone="bg-sky-950 text-white" label="Loket" value={identity} hint={profile.username || deskName} wrap className="min-w-[300px] max-w-[380px]" />
        </div>
      )}
      {stats.runText && (
        <div className="h-7 overflow-hidden bg-orange-500 text-sm font-black text-white">
          <div className="animate-ticker flex h-full items-center whitespace-nowrap px-4">
            {stats.runText}
          </div>
        </div>
      )}
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
