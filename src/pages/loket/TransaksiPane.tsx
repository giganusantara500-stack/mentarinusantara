import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useLoketRefresh } from "@/components/layout/LoketShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { PDAM_AREAS } from "@/lib/pdam";
import { loadPrinterSettings, printReceipts, type ReceiptBill } from "@/lib/printer";

const CATEGORIES = ["PLN", "Telkom", "PDAM", "BPJS", "Finance", "Gas", "Pajak PBB", "Internet & TV", "Topup", "Telco"];
const PRODUCTS: Record<string, string[]> = {
  PLN: ["Postpaid", "Nontaglis", "Prepaid 20", "Prepaid 50", "Prepaid 100", "Prepaid 200", "Prepaid 500", "Prepaid 1000", "Prepaid 2000", "Prepaid 3000", "Prepaid 5000"],
  Telkom: ["Telkom PSTN", "Speedy/Indihome", "IndiHome", "Telepon"],
  PDAM: PDAM_AREAS,
  BPJS: ["BPJS Kesehatan", "BPJS Tenaga Kerja"],
  Finance: ["BAF Finance", "WOM Finance", "BCA Multifinance Mobil", "BCA Multifinance Motor", "Adira", "Mandiri Utama Finance", "Mega Finance", "Clipan Finance"],
  Gas: ["PGN", "Pertagas", "PGN 3000"],
  "Pajak PBB": ["Pajak Daerah DKI Jakarta", "PBB Depok", "PBB Aceh Utara", "PBB Banyuwangi", "PBB Bandung", "PBB Surabaya"],
  "Internet & TV": ["Indihome", "Firstmedia", "Indovision", "MyRepublic", "CBN", "Transvision", "Biznet Home", "Iconnet"],
  Topup: ["Pulsa HP", "Data/Internet", "E-Money", "E-Wallet"],
  Telco: ["Tagihan Halo", "XL Pascabayar", "Indosat Pascabayar", "Three Pascabayar", "Smartfren Pascabayar"],
};
const ADMIN_FEES = [4800, 4900, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 10000, 11000, 12000, 13000, 14000, 15000];
const BPJS_MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const TAX_YEARS = Array.from({ length: new Date().getFullYear() - 2017 }, (_, index) => String(2019 + index));
const BILLER_ADMIN: Record<string, number> = {
  Telkom: 2500,
  PDAM: 2500,
  BPJS: 2500,
  Finance: 6500,
  Gas: 2500,
  "Pajak PBB": 2500,
  "Internet & TV": 3000,
  Topup: 1500,
  Telco: 2500,
};

interface Sale {
  id: string;
  category: string;
  product: string;
  customerNumber: string;
  customerName: string;
  amount: number;
  adminFee?: number;
  period?: string;
  loketCode?: string;
  loketName?: string;
  status: string;
  createdAt: string;
}

interface CartRow {
  key: string;
  category: string;
  product: string;
  customerId: string;
  name: string;
  period: string;
  amount: number;
  denda: number;
  admin: number;
  collfee: number;
  total: number;
}

async function authHeader() {
  const session = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session.data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

function inquire(number: string, product: string, adminFee: number): Omit<CartRow, "key" | "category" | "product" | "customerId"> | null {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 5) return null;
  const prepaid = product.match(/Prepaid\s+(\d+)/i);
  const fixed = prepaid ? Number(prepaid[1]) * 1000 : product === "Prepaid" ? 0 : null;
  if (product === "Prepaid" && fixed === 0) return null;
  const tail = Number(digits.slice(-5)) || 10000;
  const amount = fixed ?? (15000 + (tail % 250000));
  const denda = fixed ? 0 : (tail % 9 === 0 ? 2000 : 0);
  const period = new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return { name: `Pelanggan ${digits.slice(-4)}`, period, amount, denda, admin: adminFee, collfee: 0, total: amount + denda + adminFee };
}

function AreaPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0, width: 280 });
  useEffect(() => setQuery(value), [value]);
  useEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 280);
      const left = Math.min(rect.left, window.innerWidth - width - 12);
      setPlace({ top: rect.bottom + 4, left: Math.max(8, left), width });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);
  const needle = query.trim().toLowerCase();
  const showAll = needle.length === 0 || query === value;
  const matches = showAll ? PDAM_AREAS : PDAM_AREAS.filter((area) => area.toLowerCase().includes(needle));
  return (
    <div ref={box} className="relative">
      <Input
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          const exact = PDAM_AREAS.find((area) => area.toLowerCase() === next.trim().toLowerCase());
          if (exact) onChange(exact);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          const exact = PDAM_AREAS.find((area) => area.toLowerCase() === query.trim().toLowerCase());
          if (exact) onChange(exact);
          else setQuery(value);
          window.setTimeout(() => setOpen(false), 160);
        }}
        placeholder="Ketik kota, contoh Sragen"
        aria-expanded={open}
      />
      {open && createPortal(
        <ul
          className="fixed z-50 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          style={{ top: place.top, left: place.left, width: place.width }}
        >
          {matches.map((area) => (
            <li key={area}>
              <button type="button" className="block w-full whitespace-normal break-words px-3 py-2 text-left text-sm leading-5 text-slate-800 hover:bg-amber-50" onMouseDown={(event) => { event.preventDefault(); onChange(area); setQuery(area); setOpen(false); }}>{area}</button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Wilayah tidak ditemukan.</li>}
        </ul>,
        document.body,
      )}
    </div>
  );
}

export function LoketTransaksiPage() {
  const { profile } = useAuth();
  const { tick, requestRefresh, loketCode } = useLoketRefresh();
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [mode, setMode] = useState<"bayar" | "cetak">("bayar");
  const [product, setProduct] = useState(PRODUCTS.PLN[0]);
  const [adminFee, setAdminFee] = useState(4800);
  const [months, setMonths] = useState("01");
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [number, setNumber] = useState("");
  const [cart, setCart] = useState<CartRow[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [reprintId, setReprintId] = useState("");
  const [reprintDate, setReprintDate] = useState("");
  const [reprintHits, setReprintHits] = useState<Sale[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loketName = profile?.full_name || profile?.username || "Loket";
  const productLabel = category === "PDAM" || category === "Pajak PBB" ? "Wilayah" : "Produk";
  const idLabel = category === "BPJS" ? "Nomor VA" : category === "Pajak PBB" ? "NOP" : "Customer ID";
  const appliedAdmin = category === "PLN" ? adminFee : (BILLER_ADMIN[category] ?? 0);
  const showAdmin = category === "PLN";
  const columns = showAdmin
    ? ["No", "Produk", "Cust.ID", "Nama", "Periode", "Tot. Tagihan", "Tagihan", "Denda", "Admin Bank", "Collfee"]
    : ["No", "Produk", "Cust.ID", "Nama", "Periode", "Tot. Tagihan", "Tagihan", "Denda", "Collfee"];

  const openCategory = (item: string) => {
    setCategory(item);
    setProduct(item === "PDAM" ? "Kab. Sragen" : PRODUCTS[item][0]);
    setNumber("");
    setCart([]);
    setMessage("");
    setError("");
    setReprintId("");
    setReprintDate("");
    setReprintHits([]);
    setMonths("01");
    setTaxYear(String(new Date().getFullYear()));
    setMode("bayar");
  };

  useEffect(() => {
    (async () => {
      const response = await fetch("/api/loket-sales", { headers: await authHeader() });
      const body = response.ok ? await response.json() : { sales: [] };
      setSales(body.sales ?? []);
    })();
  }, [tick]);

  const rows = cart.filter((row) => row.category === category);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const checkReprint = () => {
    if (!reprintId.trim() && !reprintDate) {
      setError("Isi Customer ID atau tanggal transaksi.");
      setReprintHits([]);
      return;
    }
    setError("");
    setReprintHits(sales.filter((sale) => {
      if (sale.category !== category) return false;
      if (reprintId.trim() && !sale.customerNumber.includes(reprintId.trim())) return false;
      if (reprintDate && !sale.createdAt.slice(0, 10).startsWith(reprintDate)) return false;
      return true;
    }));
  };

  const lookup = () => {
    const found = inquire(number, product, appliedAdmin);
    if (!found) { setError("Nomor minimal 5 digit."); return; }
    if (category === "BPJS") {
      const count = Number(months);
      found.amount *= count;
      found.denda *= count;
      found.total = found.amount + found.denda + found.admin + found.collfee;
      found.period = `${months} Bulan`;
    }
    if (category === "Pajak PBB") found.period = taxYear;
    setCart((rows) => [...rows, { ...found, key: crypto.randomUUID(), category, product, customerId: number.trim() }]);
    setError("");
    setMessage("");
    setNumber("");
  };

  const pay = async () => {
    if (rows.length === 0) return;
    setBusy(true);
    setError("");
    let balance = 0;
    for (const row of rows) {
      const response = await fetch("/api/loket-sales", {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({
          category: row.category,
          product: `${row.category} ${row.product}`,
          customerNumber: row.customerId,
          customerName: row.name,
          amount: row.total,
          tagihan: row.amount,
          denda: row.denda,
          adminFee: row.admin,
          collfee: row.collfee,
          period: row.period,
          loketName,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setBusy(false);
        setError(body.error || "Pembayaran berhenti karena saldo atau data tidak cukup.");
        requestRefresh();
        return;
      }
      balance = Number(body.balance);
    }
    setBusy(false);
    setCart([]);
    setMessage(`Pembayaran ${rows.length} tagihan tercatat. Saldo ${formatRupiah(balance)}.`);
    requestRefresh();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {CATEGORIES.map((item) => (
          <button
            key={item}
            onClick={() => openCategory(item)}
            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold uppercase ${category === item ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => setMode("bayar")} className={`px-3 py-2 text-xs font-bold ${mode === "bayar" ? "border-b-2 border-amber-500 text-amber-600" : "text-slate-400"}`}>TRANSAKSI</button>
        <button onClick={() => setMode("cetak")} className={`px-3 py-2 text-xs font-bold ${mode === "cetak" ? "border-b-2 border-amber-500 text-amber-600" : "text-slate-400"}`}>CETAK ULANG</button>
      </div>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {mode === "bayar" ? (
          <div className="grid h-[92px] shrink-0 grid-cols-4 items-end gap-3 overflow-visible p-4">
            <Field label={productLabel}>
              {category === "PDAM" ? (
                <AreaPicker value={product} onChange={setProduct} />
              ) : (
                <Select value={product} onChange={(event) => setProduct(event.target.value)}>
                  {PRODUCTS[category].map((item) => <option key={item}>{item}</option>)}
                </Select>
              )}
            </Field>
            {category === "PLN" ? (
              <Field label="Pilihan Admin Bank">
                <Select value={String(adminFee)} onChange={(event) => setAdminFee(Number(event.target.value))}>
                  {ADMIN_FEES.map((fee) => <option key={fee} value={fee}>{formatRupiah(fee)}</option>)}
                </Select>
              </Field>
            ) : category === "BPJS" ? (
              <Field label="Jumlah Bulan">
                <Select value={months} onChange={(event) => setMonths(event.target.value)}>
                  {BPJS_MONTHS.map((item) => <option key={item} value={item}>{item} Bulan</option>)}
                </Select>
              </Field>
            ) : category === "Pajak PBB" ? (
              <Field label="Tahun Pajak">
                <Select value={taxYear} onChange={(event) => setTaxYear(event.target.value)}>
                  {TAX_YEARS.map((item) => <option key={item}>{item}</option>)}
                </Select>
              </Field>
            ) : <div />}
            <Field label={idLabel}>
              <Input value={number} onChange={(event) => setNumber(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); lookup(); } }} placeholder={idLabel} />
            </Field>
            <button type="button" onClick={lookup} className="h-10 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-white">Inquiry</button>
          </div>
        ) : (
          <div className="grid h-[92px] shrink-0 grid-cols-4 items-end gap-3 overflow-hidden p-4">
            <Field label="Customer ID"><Input value={reprintId} onChange={(event) => setReprintId(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); checkReprint(); } }} /></Field>
            <Field label="Tanggal Transaksi"><Input type="date" value={reprintDate} onChange={(event) => setReprintDate(event.target.value)} /></Field>
            <div />
            <button type="button" onClick={checkReprint} className="h-10 rounded-lg bg-amber-500 px-4 text-sm font-bold text-white">CEK</button>
          </div>
        )}
        <div className={`h-6 shrink-0 truncate px-4 text-sm ${error ? "text-rose-600" : "text-emerald-700"}`}>{error || message}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          {mode === "bayar" ? (
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                <tr>{columns.map((head) => <th key={head} className="px-3 py-2 font-semibold">{head}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">Belum ada tagihan. Lakukan Inquiry.</td></tr>}
                {rows.map((row, index) => (
                  <tr key={row.key} className="border-t border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{index + 1}</td>
                    <td className="px-3 py-2">{row.category} {row.product}</td>
                    <td className="px-3 py-2 font-mono">{row.customerId}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.period}</td>
                    <td className="px-3 py-2 font-semibold">{formatRupiah(row.total)}</td>
                    <td className="px-3 py-2">{formatRupiah(row.amount)}</td>
                    <td className="px-3 py-2">{formatRupiah(row.denda)}</td>
                    {showAdmin && <td className="px-3 py-2">{formatRupiah(row.admin)}</td>}
                    <td className="px-3 py-2">{formatRupiah(row.collfee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                <tr>{["No", "Produk", "Cust.ID", "Nama", "Tanggal", "Total", "Status"].map((head) => <th key={head} className="px-3 py-2 font-semibold">{head}</th>)}</tr>
              </thead>
              <tbody>
                {reprintHits.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Belum ada list. Isi Customer ID atau tanggal, lalu tekan CEK.</td></tr>}
                {reprintHits.map((sale, index) => (
                  <tr key={sale.id} className="border-t border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{index + 1}</td>
                    <td className="px-3 py-2">{sale.product}</td>
                    <td className="px-3 py-2 font-mono">{sale.customerNumber}</td>
                    <td className="px-3 py-2">{sale.customerName}</td>
                    <td className="px-3 py-2">{formatWaktu(sale.createdAt)}</td>
                    <td className="px-3 py-2 font-semibold">{formatRupiah(sale.amount)}</td>
                    <td className="px-3 py-2">{sale.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 bg-slate-800 px-4 text-white">
          <div className="text-sm text-slate-200">{mode === "bayar" ? `${rows.length} tagihan` : `${reprintHits.length} list`}</div>
          {mode === "bayar" ? (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" disabled={rows.length === 0} onClick={() => printReceipts(loadPrinterSettings(loketCode), rows.map((row): ReceiptBill => ({ id: row.customerId, name: row.name, product: `${row.category} ${row.product}`, period: row.period, tagihan: row.amount + row.denda, admin: row.admin, total: row.total })), `${loketCode} - ${loketName}`)}>Cetak Info Tagihan</Button>
              <Button variant="outline" onClick={() => { setCart([]); setNumber(""); setError(""); setMessage(""); }}>Hapus</Button>
              <button onClick={pay} disabled={busy || rows.length === 0} className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
                {busy ? "Memproses..." : `BAYAR ${formatRupiah(total)}`}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setReprintHits([])} className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white">Hapus Semua List</button>
          )}
        </div>
      </section>
    </div>
  );
}
