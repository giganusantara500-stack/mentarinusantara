import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { LOKET_VERSION_LABEL } from "@/lib/brand";
import { DepositModal } from "@/pages/DepositPage";
import { DeskHeader, useDeskStats } from "./DeskHeader";
import {
  Home, Receipt, Layers, Banknote, ClipboardList, FileBarChart, Settings,
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
  { path: "/meja", label: "Beranda", icon: Home },
  { path: "/meja/beli", label: "Transaksi", icon: Receipt },
  { path: "/meja/kolektif", label: "Kolektif", icon: Layers },
  { path: "/meja/transfer", label: "Transfer Uang", icon: Banknote },
  { path: "/meja/riwayat", label: "Status Transaksi", icon: ClipboardList },
  { path: "/meja/laporan", label: "Laporan", icon: FileBarChart },
  { path: "/meja/pengaturan", label: "Setting", icon: Settings },
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
  const [depositOpen, setDepositOpen] = useState(false);
  const stats = useDeskStats(tick);
  const loketCode = stats.loketCode;

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

  if (!profile) return null;
  const role = dbRoleToAppRole(profile.role);
  if (role === "pending") return null;
  return (
    <LoketRefreshContext.Provider value={{ tick, requestRefresh, loketCode, openDeposit: () => setDepositOpen(true) }}>
      <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-white">
        <DeskHeader brand={LOKET_BRAND} version={LOKET_VERSION_LABEL} stats={stats} onDeposit={() => setDepositOpen(true)} onRefresh={requestRefresh} onLogout={onLogout} allowFullscreen />
        {notice && <div className="bg-emerald-50 px-3 py-0.5 text-sm font-black text-emerald-800">{notice}</div>}
        <main className="loket-desk flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-3 pt-0">
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          <div className="h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0" />
        </main>
        <DepositModal open={depositOpen || current === "/meja/deposit"} tick={tick} requestRefresh={requestRefresh} onClose={() => { setDepositOpen(false); if (current === "/meja/deposit") onNavigate("/meja"); }} />
        <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
          <div className="flex w-full items-center justify-center gap-2 overflow-x-auto sm:gap-4">
            {MENU.map((item) => {
              const active = current === item.path || (item.path === "/meja/beli" && current.startsWith("/meja/beli"));
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  onClick={() => onNavigate(item.path)}
                  className={cn(
                    "relative flex w-16 shrink-0 flex-col items-center gap-0.5 px-0.5 pb-1 pt-1 text-xs font-black leading-none sm:w-[4.5rem]",
                    active ? "text-slate-950" : "text-slate-700",
                  )}
                >
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-md", active ? "bg-amber-400 text-neutral-950" : "bg-neutral-950 text-amber-400")}>
                    <Icon size={22} strokeWidth={2.6} />
                  </span>
                  <span className="max-w-full text-center">{item.label}</span>
                  {active && <span className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-amber-400" />}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </LoketRefreshContext.Provider>
  );
}

