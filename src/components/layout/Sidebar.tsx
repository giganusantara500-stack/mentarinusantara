import { useEffect, useState } from "react";
import { useAuth, dbRoleToAppRole, roleUsesMfa } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/brand";
import { territoryMarker } from "@/lib/territory";
import { NAV_CONFIG, ROLE_LABELS } from "@/lib/nav";
import { pathAllowed } from "@/lib/access";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LogOut, Menu, X, Zap, ChevronRight, ChevronDown, ShieldCheck } from "lucide-react";

interface Props {
  current: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  onSecurity: () => void;
}

export function Sidebar({ current, onNavigate, onLogout, onSecurity }: Props) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);

  if (!profile) return null;
  const role = dbRoleToAppRole(profile.role);
  if (role === "pending" || role === "loket") return null;
  const items = NAV_CONFIG[role]
    .map((section) => ({ ...section, items: section.items.filter((item) => pathAllowed(profile.role, item.path)) }))
    .filter((section) => section.items.length > 0);
  const displayName = profile.full_name || profile.email;
  const marker = territoryMarker(role, profile.city);

  useEffect(() => {
    const active = items.find((section) => section.items.length > 1 && section.items.some((item) => item.path === current));
    if (active) setExpanded((rows) => rows.includes(active.category) ? rows : [...rows, active.category]);
  }, [current, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const content = (
    <div className="flex flex-col h-full bg-purple-950 text-purple-200">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-purple-900/60">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-900/40 shrink-0">
          <Zap size={20} className="text-white" fill="white" />
        </div>
        <div className="leading-tight min-w-0">
          <div className="text-white font-bold text-[11px] leading-snug tracking-tight">{PLATFORM_NAME}</div>
          <div className="text-[11px] text-amber-200 font-medium truncate">{marker}</div>
        </div>
      </div>

      {/* User card */}
      <div className="px-4 py-4 border-b border-purple-900/60">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
            style={{ backgroundColor: "#6d28d9" }}
          >
            {initials(displayName)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{displayName}</div>
            <div className="text-xs text-purple-400 truncate">{ROLE_LABELS[role]}</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {items.map((section) => {
          const direct = section.items.length === 1;
          const shown = direct || expanded.includes(section.category);
          const sectionActive = section.items.some((item) => item.path === current);
          const SectionIcon = section.icon ?? section.items[0]?.icon;
          return (
            <div key={section.category}>
              <button
                onClick={() => {
                  if (direct) {
                    onNavigate(section.items[0].path);
                    setOpen(false);
                    return;
                  }
                  setExpanded((rows) => rows.includes(section.category) ? rows.filter((item) => item !== section.category) : [...rows, section.category]);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition",
                  sectionActive && direct ? "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-sm" : "text-purple-100 hover:bg-purple-900/60"
                )}
              >
                {SectionIcon && <SectionIcon size={18} />}
                <span className="flex-1 text-left">{section.category}</span>
                {direct ? sectionActive && <ChevronRight size={16} /> : <ChevronDown size={16} className={cn("transition", shown ? "rotate-180" : "")} />}
              </button>
              {shown && !direct && (
                <div className="mt-0.5 space-y-0.5 pl-3">
                  {section.items.map((item) => {
                    const active = current === item.path;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        onClick={() => { onNavigate(item.path); setOpen(false); }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                          active ? "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-sm" : "text-purple-300 hover:bg-purple-900/60 hover:text-white"
                        )}
                      >
                        <Icon size={16} />
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.path === "/keamanan" && role === "mitra" && <span className="rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">Aktif</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-purple-900/60 space-y-0.5">
        {(role === "superadmin" || role === "mitra" || role === "submitra" || roleUsesMfa(profile.role)) && (
          <button
            onClick={() => { onSecurity(); setOpen(false); }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition",
              current === "/keamanan" ? "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-sm" : "text-purple-300 hover:bg-purple-900/60 hover:text-white",
            )}
          >
            <ShieldCheck size={18} />
            <span className="flex-1 text-left">Keamanan (2FA)</span>
            {role === "mitra" && <span className="rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">Aktif</span>}
          </button>
        )}
        <button
          onClick={() => { onLogout(); setOpen(false); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-purple-300 hover:bg-rose-600/10 hover:text-rose-400 transition"
        >
          <LogOut size={18} />
          <span>Keluar</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-3 left-3 z-30 p-2 rounded-lg bg-white border border-slate-200 shadow-sm text-slate-700"
        aria-label="Buka menu"
      >
        <Menu size={20} />
      </button>

      {/* Desktop */}
      <aside className="hidden h-full w-64 shrink-0 md:block">
        {content}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-purple-950/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 shadow-2xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute -right-11 top-3 p-2 rounded-lg bg-white text-slate-700 shadow"
              aria-label="Tutup menu"
            >
              <X size={20} />
            </button>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
