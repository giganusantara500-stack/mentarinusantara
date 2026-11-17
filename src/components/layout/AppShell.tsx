import { useState, type ReactNode } from "react";
import { PLATFORM_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { DeskHeader, useDeskStats } from "./DeskHeader";

interface Props {
  current: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  onSecurity: () => void;
  children: ReactNode;
}

export function AppShell({ current, onNavigate, onLogout, onSecurity, children }: Props) {
  const [tick, setTick] = useState(0);
  const stats = useDeskStats(tick);
  const fitDashboard = current === "/dashboard";
  return (
    <div className="flex h-dvh overflow-hidden bg-white">
      <Sidebar current={current} onNavigate={onNavigate} onLogout={onLogout} onSecurity={onSecurity} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <DeskHeader
          brand={PLATFORM_NAME}
          stats={stats}
          showStats={false}
          onDeposit={() => onNavigate("/setoran")}
          onRefresh={() => setTick((value) => value + 1)}
          onLogout={onLogout}
        />
        <main className={cn(
          "w-full min-w-0 flex-1",
          fitDashboard ? "flex min-h-0 flex-col overflow-hidden px-5 py-3 md:px-8" : "overflow-y-auto px-6 py-6 md:px-10",
        )}>{children}</main>
        <footer className="w-full border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-400 md:px-10">
          {PLATFORM_NAME} — Platform PPOB (autentikasi Supabase).
        </footer>
      </div>
    </div>
  );
}
