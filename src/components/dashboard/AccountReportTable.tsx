import { formatRupiah } from "@/lib/format";
import type { AccountRow } from "@/lib/superadminDashboard";
import { Badge } from "@/components/ui/Badge";

export const ACCOUNT_ROLE_LABEL: Record<AccountRow["role"], string> = {
  mitra: "Mitra",
  submitra: "Sub Mitra",
  loket: "Loket",
};

export function AccountReportTable({ rows, loading }: { rows: AccountRow[]; loading: boolean }) {
  if (loading) return <p className="py-10 text-center text-sm text-slate-500">Memuat laporan...</p>;
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-slate-500">Belum ada akun pada cakupan ini.</p>;

  return (
    <div className="w-full max-w-full">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
            <th className="px-2.5 py-2 font-medium">Akun</th>
            <th className="px-3 py-3 font-medium">Induk</th>
            <th className="px-3 py-3 font-medium text-right">Transaksi</th>
            <th className="px-3 py-3 font-medium text-right">Nilai Berhasil</th>
            <th className="px-3 py-3 font-medium text-right">CMS</th>
            <th className="px-3 py-3 font-medium text-right">Deposit</th>
            <th className="px-2.5 py-2 font-medium text-right">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50/60">
              <td className="px-2.5 py-2">
                <div className="font-medium text-slate-800">{r.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge tone="blue">{ACCOUNT_ROLE_LABEL[r.role]}</Badge>
                  {r.status !== "active" && <Badge tone="danger">Nonaktif</Badge>}
                </div>
              </td>
              <td className="px-3 py-3 text-slate-600">{r.parent_name ?? "—"}</td>
              <td className="px-3 py-3 text-right text-slate-700">{r.tx_count}</td>
              <td className="px-3 py-3 text-right text-slate-700">{formatRupiah(r.volume)}</td>
              <td className="px-3 py-3 text-right text-emerald-700">{formatRupiah(r.cms)}</td>
              <td className="px-3 py-3 text-right text-slate-700">{formatRupiah(r.deposit)}</td>
              <td className="px-2.5 py-2 text-right text-slate-800 font-medium">{formatRupiah(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
