import { useAuth, dbRoleToAppRole, roleUsesMfa } from "@/lib/auth";
import { ROLE_LABELS, NAV_CONFIG } from "@/lib/nav";
import { PLATFORM_NAME } from "@/lib/brand";
import { territoryMarker } from "@/lib/territory";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import { Bell, ShieldCheck } from "lucide-react";

interface Props {
  current: string;
  onNavigate: (path: string) => void;
}

export function Topbar({ current }: Props) {
  const { profile, user } = useAuth();
  const [mfaActive, setMfaActive] = useState(false);
  const [runText, setRunText] = useState("");
  if (!profile) return null;

  const role = dbRoleToAppRole(profile.role);
  if (role === "pending") return null;
  const sections = NAV_CONFIG[role];
  const active = sections.flatMap((s) => s.items).find((i) => i.path === current);
  const displayName = profile.full_name || profile.email;
  const marker = territoryMarker(role, profile.city);

  useEffect(() => {
    (async () => {
      if (!user) { setMfaActive(false); return; }
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = (data?.totp ?? []).some((f) => f.status === "verified");
      setMfaActive(verified);
    })();
    const session = supabase.auth.getSession();
    session.then(async ({ data }) => {
      const response = await fetch("/api/runtext", {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const body = response.ok ? await response.json() : null;
      setRunText(body?.text || "");
    });
  }, [user, current]);

  return (
    <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="flex h-16 w-full items-center justify-between gap-3 px-6 pl-16 md:px-10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="leading-tight min-w-0">
            <div className="text-xs font-bold text-slate-800 truncate">{PLATFORM_NAME}</div>
            <div className="text-[11px] font-medium text-purple-700 truncate">{marker}</div>
          </div>
          {active && (
            <div className="hidden md:flex items-center gap-2 pl-3 border-l border-slate-200 min-w-0">
              <active.icon size={16} className="text-purple-600 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-800 truncate">{active.label}</h2>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {mfaActive && roleUsesMfa(profile.role) && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
              <ShieldCheck size={12} /> 2FA Aktif
            </span>
          )}
          <button
            className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Pengumuman"
          >
            <Bell size={18} />
          </button>
          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-200">
            <div className="text-right leading-tight">
              <div className="text-xs font-medium text-slate-700">{displayName}</div>
              <div className="text-[10px] text-slate-400">{ROLE_LABELS[role]}</div>
            </div>
          </div>
        </div>
      </div>
      {runText && (
        <div className="overflow-hidden border-t border-sky-100 bg-sky-50 text-[11px] text-sky-900">
          <div className="animate-ticker whitespace-nowrap py-1">{runText}</div>
        </div>
      )}
    </header>
  );
}
