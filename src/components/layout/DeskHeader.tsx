import { useEffect, useState, type CSSProperties } from "react";
import { BadgeAlert, Landmark, LogOut, Receipt, RefreshCw, RotateCw, Store, SunMedium, Wallet } from "lucide-react";
import { WindowCaptionButtons } from "@/components/layout/WindowCaption";
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
  const [ticketHint, setTicketHint] = useState("");

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
      if (profile.role === "loket") {
        const depositRes = await fetch("/api/deposits", { headers });
        const depositBody = depositRes.ok ? await depositRes.json() : null;
        const ticket = (depositBody?.tickets ?? [])[0] as { status?: string; uniqueCode?: string } | undefined;
        setTicketHint(ticket?.status === "pending" ? `Menunggu Transfer · kode ${ticket.uniqueCode || ""}` : ticket?.status === "approved" ? "Deposit Berhasil" : "");
      }
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
          fetch("/api/wallet", { headers }),
          fetch("/api/loket-sales", { headers }),
          fetch("/api/runtext", { headers }),
        ]);
        if (walletRes.ok) {
          const wallet = await walletRes.json();
          setBalance(Number(wallet.balance ?? 0));
          if (wallet.loketCode) setLoketCode(String(wallet.loketCode));
        }
        if (runRes.ok) {
          const runBody = await runRes.json();
          setRunText(String(runBody?.text ?? ""));
        }
        if (profile.role === "loket") {
          const depositRes = await fetch("/api/deposits", { headers });
          const depositBody = depositRes.ok ? await depositRes.json() : null;
          const ticket = (depositBody?.tickets ?? [])[0] as { status?: string; uniqueCode?: string } | undefined;
          setTicketHint(ticket?.status === "pending" ? `Menunggu Transfer · kode ${ticket.uniqueCode || ""}` : ticket?.status === "approved" ? "Deposit Berhasil" : "");
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
    }, 5000);
    return () => window.clearInterval(timer);
  }, [profile]);

  return { balance, todayCount, todayAmount, outstanding, loketCode, runText, ticketHint };
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
      <div className="flex h-12 items-stretch bg-neutral-950 text-white">
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
          <Stat icon={Wallet} tone="bg-cyan-400 text-sky-950" label="Saldo" value={formatRupiah(stats.balance)} hint={stats.ticketHint || undefined} className="w-[220px]" />
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
