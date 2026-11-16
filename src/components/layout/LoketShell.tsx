import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
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
  { path: "/dashboard", label: "Beranda", icon: Home, tone: "bg-sky-500" },
  { path: "/beli", label: "Transaksi", icon: Receipt, tone: "bg-amber-500" },
  { path: "/kolektif", label: "Kolektif", icon: Layers, tone: "bg-violet-500" },
  { path: "/transfer", label: "Transfer Uang", icon: Banknote, tone: "bg-emerald-500" },
  { path: "/riwayat", label: "Status Transaksi", icon: ClipboardList, tone: "bg-cyan-600" },
  { path: "/laporan", label: "Laporan", icon: FileBarChart, tone: "bg-rose-500" },
  { path: "/pengaturan", label: "Setting", icon: Settings, tone: "bg-indigo-600" },
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

  useEffect(() => {
    const desktop = window.matchMedia("(display-mode: standalone)").matches;
    if (desktop || window.name === "mentari-loket") return;
    const root = document.documentElement;
    const fill = () => {
      if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => undefined);
    };
    fill();
    if (!sessionStorage.getItem("mentari-desk")) {
      const features = `menubar=no,toolbar=no,location=no,status=no,width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`;
      const opened = window.open(window.location.href, "mentari-loket", features);
      if (opened) sessionStorage.setItem("mentari-desk", "1");
    }
    window.addEventListener("pointerdown", fill, { once: true });
    return () => window.removeEventListener("pointerdown", fill);
  }, []);

  if (!profile) return null;
  const role = dbRoleToAppRole(profile.role);
  if (role === "pending") return null;
  return (
    <LoketRefreshContext.Provider value={{ tick, requestRefresh, loketCode, openDeposit: () => setDepositOpen(true) }}>
      <div className="flex h-dvh w-screen flex-col overflow-hidden bg-white">
        <DeskHeader brand={LOKET_BRAND} stats={stats} onDeposit={() => setDepositOpen(true)} onRefresh={requestRefresh} onLogout={onLogout} />
        {notice && <div className="bg-emerald-50 px-4 py-1 text-xs font-semibold text-emerald-700">{notice}</div>}
        <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-6 pt-3 md:px-10">
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          <div className="h-20 shrink-0" />
        </main>
        <DepositModal open={depositOpen || current === "/deposit"} tick={tick} requestRefresh={requestRefresh} onClose={() => { setDepositOpen(false); if (current === "/deposit") onNavigate("/dashboard"); }} />
        <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white">
          <div className="flex w-full items-center justify-center gap-6 overflow-x-auto md:gap-10">
            {MENU.map((item) => {
              const active = current === item.path || (item.path === "/beli" && current.startsWith("/beli"));
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  onClick={() => onNavigate(item.path)}
                  className={cn(
                    "relative flex w-[4.5rem] shrink-0 flex-col items-center gap-1 px-1 pb-2 pt-2 text-[11px] font-bold leading-tight sm:w-20 sm:text-xs",
                    active ? "text-slate-900" : "text-slate-600",
                  )}
                >
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm", item.tone)}>
                    <Icon size={18} strokeWidth={2.4} />
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

