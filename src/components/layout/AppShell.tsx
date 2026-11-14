import type { ReactNode } from "react";
import { PLATFORM_NAME } from "@/lib/brand";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface Props {
  current: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  onSecurity: () => void;
  children: ReactNode;
}

export function AppShell({ current, onNavigate, onLogout, onSecurity, children }: Props) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar current={current} onNavigate={onNavigate} onLogout={onLogout} onSecurity={onSecurity} />
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <Topbar current={current} onNavigate={onNavigate} />
        <main className="mx-auto w-full min-w-0 max-w-[1360px] flex-1 px-8 py-6 lg:px-16">{children}</main>
        <footer className="mx-auto w-full max-w-[1360px] px-8 py-4 text-center text-xs text-slate-400 border-t border-slate-200 lg:px-16">
          {PLATFORM_NAME} — Platform PPOB (autentikasi Supabase).
        </footer>
      </div>
    </div>
  );
}
