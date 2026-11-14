import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { territoryMarker } from "@/lib/territory";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DepositModal } from "@/pages/DepositPage";
import {
  Home, Receipt, Layers, Banknote, ClipboardList, FileBarChart, Settings, Landmark, RefreshCw, RotateCw, LogOut, SunMedium,
} from "lucide-react";

interface RefreshValue {
  tick: number;
  requestRefresh: () => void;
  loketCode: string;
  openDeposit: () => void;
}

const LoketRefreshContext = createContext<RefreshValue>({ tick: 0, requestRefresh: () => {}, loketCode: "", openDeposit: () => {} });

export function useLoketRefresh() {
  return useContext(LoketRefreshContext);
}

const MENU = [
  { path: "/dashboard", label: "Beranda", icon: Home },
  { path: "/beli", label: "Transaksi", icon: Receipt },
  { path: "/kolektif", label: "Kolektif", icon: Layers },
  { path: "/transfer", label: "Transfer Uang", icon: Banknote },
  { path: "/riwayat", label: "Status Transaksi", icon: ClipboardList },
  { path: "/laporan", label: "Laporan", icon: FileBarChart },
  { path: "/pengaturan", label: "Setting", icon: Settings },
];

export const LOKET_BRAND = "Mentari Nusantara";

interface Props {
  current: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

export function LoketShell({ current, onNavigate, onLogout, children }: Props) {
  const { profile } = useAuth();
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState("");
  const [balance, setBalance] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [todayAmount, setTodayAmount] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [loketCode, setLoketCode] = useState("");
  const [depositOpen, setDepositOpen] = useState(false);
  const [runText, setRunText] = useState("");

  const requestRefresh = () => {
    setTick((value) => value + 1);
    setNotice("Data loket diperbarui.");
    window.setTimeout(() => setNotice(""), 4000);
  };

  useEffect(() => {
    const previous = document.title;
    document.title = LOKET_BRAND;
    return () => { document.title = previous; };
  }, []);

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
      setLoketCode(String(wallet?.loketCode || salesBody.loketCode || ""));
      const runBody = runRes.ok ? await runRes.json() : null;
      setRunText(String(runBody?.text ?? ""));
    })();
    return () => { active = false; };
  }, [profile, tick]);

  if (!profile) return null;
  const role = dbRoleToAppRole(profile.role);
  if (role === "pending") return null;
  const marker = territoryMarker(role, profile.city);
  const name = profile.full_name || profile.username || "Loket";

  return (
    <LoketRefreshContext.Provider value={{ tick, requestRefresh, loketCode, openDeposit: () => setDepositOpen(true) }}>
      <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
        <header className="bg-gradient-to-r from-sky-950 via-sky-800 to-cyan-700 text-white">
          <div className="w-full px-4 pt-3 pb-4 sm:px-6 lg:px-8">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-800 shadow">
                  <SunMedium size={26} />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-bold tracking-tight">{LOKET_BRAND}</div>
                  <div className="text-xs font-medium text-amber-200">{marker}</div>
                  <div className="mt-1 text-sm font-semibold break-words">{name}</div>
                  <div className="text-[11px] text-sky-100 break-all">{loketCode ? `Kode ${loketCode}` : ""}{profile.username ? ` · @${profile.username}` : ""}{profile.city ? ` · ${profile.city}` : ""}</div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 shrink-0">
                <button onClick={() => setDepositOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-2 text-xs font-bold text-slate-900">
                  <Landmark size={16} /> Deposit
                </button>
                <button onClick={requestRefresh} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-semibold">
                  <RefreshCw size={16} /> Update
                </button>
                <button onClick={requestRefresh} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-semibold">
                  <RotateCw size={16} /> Refresh
                </button>
                <button onClick={onLogout} className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3 py-2 text-xs font-semibold" aria-label="Logout">
                  <LogOut size={16} /> Logout
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Stat label="Saldo" value={formatRupiah(balance)} />
              <Stat label="OS" value={formatRupiah(outstanding)} />
              <Stat label="Trx Hari Ini" value={`${todayCount} · ${formatRupiah(todayAmount)}`} />
            </div>
            {notice && <div className="mt-2 text-xs text-emerald-200">{notice}</div>}
          </div>
        </header>
        {runText && <div className="overflow-hidden bg-amber-100 text-[11px] text-amber-950"><div className="animate-ticker whitespace-nowrap py-1">{runText}</div></div>}
        <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-4 pt-3 sm:px-6 lg:px-8">
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          <div className="h-[4.75rem] shrink-0" />
        </main>
        <DepositModal open={depositOpen || current === "/deposit"} tick={tick} requestRefresh={requestRefresh} onClose={() => { setDepositOpen(false); if (current === "/deposit") onNavigate("/dashboard"); }} />
        <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white">
          <div className="flex w-full min-w-0">
            {MENU.map((item) => {
              const active = current === item.path || (item.path === "/beli" && current.startsWith("/beli"));
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  onClick={() => onNavigate(item.path)}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-3 text-[10px] font-semibold sm:text-xs",
                    active ? "text-sky-700" : "text-slate-500",
                  )}
                >
                  <Icon size={28} strokeWidth={2.25} />
                  <span className="max-w-full text-center leading-tight">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </LoketRefreshContext.Provider>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-sky-100">{label}</div>
      <div className="text-sm font-bold leading-tight">{value}</div>
    </div>
  );
}
