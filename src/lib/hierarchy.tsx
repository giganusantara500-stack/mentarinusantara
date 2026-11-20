import { useMemo, useState } from "react";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import type { Profile } from "@/lib/supabase";
import { profileLabel } from "@/lib/network";
import { ROLE_LABELS } from "@/lib/nav";
import { formatRupiah } from "@/lib/format";

export interface DrillNode {
  id: string;
  label: string;
  role: "mitra" | "submitra" | "loket";
  username: string;
  loketIds: string[];
}

function asRole(role: string) {
  return role === "sub_mitra" ? "submitra" : role;
}

export function loketsUnder(id: string, profiles: Profile[]) {
  const self = profiles.find((profile) => profile.id === id);
  if (self && asRole(self.role) === "loket") return [self];
  const submitraIds = new Set(profiles.filter((profile) => asRole(profile.role) === "submitra" && (profile.parent_id === id || profile.created_by === id || profile.mitra_id === id)).map((profile) => profile.id));
  return profiles.filter((profile) => asRole(profile.role) === "loket" && (profile.parent_id === id || profile.created_by === id || profile.mitra_id === id || (profile.parent_id ? submitraIds.has(profile.parent_id) : false)));
}

function childrenOf(parentId: string, profiles: Profile[]) {
  return profiles.filter((profile) => ["submitra", "loket"].includes(asRole(profile.role)) && (profile.parent_id === parentId || (profile.created_by === parentId && !profile.parent_id)));
}

function toNode(profile: Profile, profiles: Profile[]): DrillNode {
  const role = asRole(profile.role) as DrillNode["role"];
  const loketIds = role === "loket" ? [profile.id] : loketsUnder(profile.id, profiles).map((item) => item.id);
  const label = profileLabel(profile);
  return { id: profile.id, label, role, username: profile.username || "—", loketIds };
}

export function useDrill(profiles: Profile[]) {
  const { profile } = useAuth();
  const [stack, setStack] = useState<string[]>([]);
  const [leaf, setLeaf] = useState<string | null>(null);
  const role = profile ? dbRoleToAppRole(profile.role) : "pending";
  const selfId = profile?.id ?? "";

  const nodes = useMemo(() => {
    if (!profile || role === "pending" || role === "loket") return [] as DrillNode[];
    const parentId = stack[stack.length - 1];
    const rows = parentId
      ? childrenOf(parentId, profiles)
      : role === "superadmin"
        ? profiles.filter((item) => asRole(item.role) === "mitra")
        : role === "mitra"
          ? profiles.filter((item) => ["submitra", "loket"].includes(asRole(item.role)) && (item.parent_id === selfId || (item.created_by === selfId && !item.parent_id) || (asRole(item.role) === "loket" && item.mitra_id === selfId && !item.parent_id)))
          : profiles.filter((item) => asRole(item.role) === "loket" && (item.parent_id === selfId || item.created_by === selfId));
    return rows.map((item) => toNode(item, profiles));
  }, [profile, profiles, role, selfId, stack]);

  const loketIds = useMemo(() => {
    if (leaf) return [leaf];
    const focus = stack[stack.length - 1];
    if (!focus) return profiles.filter((item) => asRole(item.role) === "loket" && (role === "superadmin" || item.parent_id === selfId || item.created_by === selfId || item.mitra_id === selfId || profiles.some((parent) => parent.id === item.parent_id && (parent.parent_id === selfId || parent.created_by === selfId)))).map((item) => item.id);
    return loketsUnder(focus, profiles).map((item) => item.id);
  }, [leaf, stack, profiles, role, selfId]);

  const crumb = useMemo(() => {
    const root = role === "superadmin" ? "Daftar Mitra" : role === "mitra" ? "Jaringan Saya" : "Loket Saya";
    const trail = stack.map((id) => {
      const found = profiles.find((item) => item.id === id);
      return { id, label: found ? profileLabel(found) : "Jaringan" };
    });
    if (leaf) {
      const found = profiles.find((item) => item.id === leaf);
      trail.push({ id: leaf, label: found ? profileLabel(found) : "Loket" });
    }
    return [{ id: "", label: root }, ...trail];
  }, [leaf, profiles, role, stack]);

  const open = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!node || node.role === "loket") {
      setLeaf(id);
      return;
    }
    setLeaf(null);
    setStack((rows) => [...rows, id]);
  };

  const back = () => {
    if (leaf) {
      setLeaf(null);
      return;
    }
    setStack((rows) => rows.slice(0, -1));
  };

  const jump = (index: number) => {
    setLeaf(null);
    setStack((rows) => rows.slice(0, index));
  };

  const management = role === "superadmin" || role === "mitra" || role === "submitra";
  return { nodes, loketIds, leaf, showNodes: management && !leaf, crumb, open, back, jump, canBack: stack.length > 0 || leaf !== null };
}

export function HierarchyPanel({ drill, rows, search, onSearch }: {
  drill: ReturnType<typeof useDrill>;
  rows: Array<DrillNode & { count: number; amount: number }>;
  search: string;
  onSearch: (value: string) => void;
}) {
  const visible = rows.filter((row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${row.label} ${row.username}`.toLowerCase().includes(q);
  });
  const total = visible.reduce((sum, row) => sum + row.amount, 0);
  if (!drill.showNodes && !drill.canBack) return null;
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm">
        {drill.crumb.map((item, index) => (
          <span key={`${item.id}-${index}`} className="inline-flex items-center gap-2">
            {index > 0 && <span className="text-slate-300">/</span>}
            <button type="button" onClick={() => drill.jump(index)} className={index === drill.crumb.length - 1 ? "font-semibold text-slate-900" : "text-sky-700"}>{item.label}</button>
          </span>
        ))}
        {drill.canBack && <button type="button" onClick={drill.back} className="ml-auto rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">Kembali</button>}
      </div>
      {drill.showNodes && (
        <>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Cari nama atau username" className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <div className="text-sm font-semibold text-slate-700">Total {formatRupiah(total)}</div>
          </div>
          <div className="w-full max-w-full">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{["Nama", "Peran", "Username", "Loket", "Jumlah", "Nominal"].map((head) => <th key={head} className="px-2.5 py-2 break-words">{head}</th>)}</tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={6} className="px-2.5 py-8 text-center text-slate-500">Tidak ada akun pada level ini.</td></tr>}
                {visible.map((row) => (
                  <tr key={row.id} className="cursor-pointer border-t border-slate-100 hover:bg-amber-50" onClick={() => drill.open(row.id)}>
                    <td className="px-2.5 py-2 break-words font-medium text-sky-800">{row.label}</td>
                    <td className="px-2.5 py-2 break-words">{ROLE_LABELS[row.role]}</td>
                    <td className="px-2.5 py-2 break-all font-mono text-xs">{row.username}</td>
                    <td className="px-2.5 py-2">{row.loketIds.length}</td>
                    <td className="px-2.5 py-2">{row.count}</td>
                    <td className="px-2.5 py-2 font-semibold">{formatRupiah(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
