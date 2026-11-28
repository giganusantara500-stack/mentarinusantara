import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { apiUrl } from "@/lib/apiBase";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card } from "@/components/ui/Card";
import { formatRupiah } from "@/lib/format";

interface FeeDay {
  date: string;
  month: string;
  h2h: number;
  mentari: number;
  total: number;
  count: number;
  h2hAccum: number;
  mentariAccum: number;
  totalAccum: number;
}

interface FeeMonth {
  month: string;
  h2h: number;
  mentari: number;
  total: number;
  count: number;
}

interface FeeLoket {
  id: string;
  name: string;
  code: string;
  h2h: number;
  mentari: number;
  total: number;
  count: number;
  months: Record<string, { h2h: number; mentari: number; count: number }>;
}

interface FeeReport {
  months: string[];
  days: FeeDay[];
  monthsSummary: FeeMonth[];
  lokets: FeeLoket[];
  totals: { h2h: number; mentari: number; total: number; count: number };
}

function monthLabel(month: string) {
  const [year, part] = month.split("-").map(Number);
  if (!year || !part) return month;
  return new Date(Date.UTC(year, part - 1, 1)).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("id-ID", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function FeeReportPage() {
  const { isSuperAdmin } = useAuth();
  const [report, setReport] = useState<FeeReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let stop = false;
    (async () => {
      setLoading(true);
      setError("");
      const session = await supabase.auth.getSession();
      const response = await fetch(apiUrl("/api/fee-report"), {
        headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      });
      const body = await response.json().catch(() => null);
      if (stop) return;
      setLoading(false);
      if (!response.ok) {
        setError(String(body?.error || "Laporan fee belum dapat dibaca."));
        return;
      }
      setReport(body as FeeReport);
    })();
    return () => { stop = true; };
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;
  const totals = report?.totals ?? { h2h: 0, mentari: 0, total: 0, count: 0 };
  const cards = [
    ["Fee DigiFlazz", formatRupiah(totals.h2h)],
    ["Fee Mentari", formatRupiah(totals.mentari)],
    ["Jumlah fee", formatRupiah(totals.total)],
    ["Transaksi sukses", String(totals.count)],
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Laporan Fee"
        description="Khusus Super Admin. Jendela 3 bulan berjalan dihitung dari tanggal Jakarta: bulan terlama keluar dan bulan baru masuk saat pergantian bulan. Angka hanya dari transaksi Sukses."
      />
      {error && <div className="mb-3 text-sm text-rose-600">{error}</div>}
      {loading && <div className="mb-3 text-sm text-slate-500">Membaca laporan fee...</div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-black text-slate-900">{value}</div>
          </Card>
        ))}
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {(report?.monthsSummary ?? []).map((month) => (
          <Card key={month.month} className="p-4">
            <div className="text-sm font-bold text-slate-900">{monthLabel(month.month)}</div>
            <div className="mt-2 text-xs leading-5 text-slate-600">Fee DigiFlazz {formatRupiah(month.h2h)}</div>
            <div className="text-xs leading-5 text-slate-600">Fee Mentari {formatRupiah(month.mentari)}</div>
            <div className="text-xs font-semibold leading-5 text-slate-800">Jumlah {formatRupiah(month.total)} · {month.count} transaksi</div>
          </Card>
        ))}
      </div>
      <Card className="mb-4 overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Rincian harian</div>
          <div className="text-xs text-slate-500">Akumulasi dihitung ulang dari tanggal 1 setiap bulan.</div>
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Tanggal</th>
                <th className="px-3 py-2">Fee DigiFlazz</th>
                <th className="px-3 py-2">Akumulasi</th>
                <th className="px-3 py-2">Fee Mentari</th>
                <th className="px-3 py-2">Akumulasi</th>
                <th className="px-3 py-2">Jumlah</th>
                <th className="px-3 py-2">Akumulasi</th>
              </tr>
            </thead>
            <tbody>
              {(report?.days ?? []).map((day) => (
                <tr key={day.date} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-semibold text-slate-800">{dayLabel(day.date)}</td>
                  <td className="px-3 py-1.5">{formatRupiah(day.h2h)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{formatRupiah(day.h2hAccum)}</td>
                  <td className="px-3 py-1.5">{formatRupiah(day.mentari)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{formatRupiah(day.mentariAccum)}</td>
                  <td className="px-3 py-1.5 font-semibold">{formatRupiah(day.total)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{formatRupiah(day.totalAccum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">Rincian per loket</div>
          <div className="text-xs text-slate-500">Pakai fee Mentari sebagai dasar sharing ke Mitra dan loket.</div>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Loket</th>
                <th className="px-3 py-2">Transaksi</th>
                <th className="px-3 py-2">Fee DigiFlazz</th>
                <th className="px-3 py-2">Fee Mentari</th>
                <th className="px-3 py-2">Jumlah</th>
                {(report?.months ?? []).map((month) => (
                  <th key={month} className="px-3 py-2">{monthLabel(month)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(report?.lokets ?? []).map((loket) => (
                <tr key={loket.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-semibold text-slate-800">{loket.code ? `${loket.code} · ` : ""}{loket.name}</td>
                  <td className="px-3 py-1.5">{loket.count}</td>
                  <td className="px-3 py-1.5">{formatRupiah(loket.h2h)}</td>
                  <td className="px-3 py-1.5">{formatRupiah(loket.mentari)}</td>
                  <td className="px-3 py-1.5 font-semibold">{formatRupiah(loket.total)}</td>
                  {(report?.months ?? []).map((month) => {
                    const part = loket.months?.[month];
                    return <td key={month} className="px-3 py-1.5 text-slate-600">{part ? formatRupiah(part.mentari) : formatRupiah(0)}</td>;
                  })}
                </tr>
              ))}
              {(report?.lokets ?? []).length === 0 && (
                <tr><td className="px-3 py-4 text-slate-500" colSpan={5 + (report?.months.length ?? 0)}>Belum ada transaksi sukses pada jendela 3 bulan ini.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}
