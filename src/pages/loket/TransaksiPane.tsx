import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useLoketRefresh } from "@/components/layout/LoketShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { BILLER_CATEGORIES, faceValue, findCatalogItem, productsFor } from "@/lib/billerCatalog";
import { loadPrinterSettings, printReceipts, type ReceiptBill } from "@/lib/printer";
import { apiUrl } from "@/lib/apiBase";

const CATEGORIES = BILLER_CATEGORIES;
const ADMIN_FEES = [4800, 4900, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 10000, 11000, 12000, 13000, 14000, 15000];
const BPJS_MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const TAX_YEARS = Array.from({ length: new Date().getFullYear() - 2017 }, (_, index) => String(2019 + index));
const BILLER_ADMIN: Record<string, number> = {
  Pulsa: 1500,
  "Paket Data": 1500,
  Games: 1500,
  "E-Money": 1500,
  "SMS & Telpon": 1500,
  Voucher: 1500,
  TV: 1500,
  "Masa Aktif": 1500,
  Gas: 2500,
  PDAM: 2500,
  "HP Postpaid": 2500,
  Internet: 2500,
  BPJS: 2500,
  "by.U": 2500,
  "TV Postpaid": 3000,
  Lainnya: 2500,
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

interface BillMonth {
  period: string;
  amount: number | null;
  denda: number | null;
}

interface CartRow {
  key: string;
  payKey: string;
  category: string;
  product: string;
  customerId: string;
  name: string;
  period: string;
  meter: string;
  amount: number;
  denda: number;
  collfee: number;
  providerCost: number;
  providerRef?: string;
  sku?: string;
}

async function authHeader() {
  const session = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session.data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

function shownName(value: unknown) {
  const name = String(value ?? "").trim();
  if (!name || /^pelanggan(\s+\d+)?$/i.test(name)) return "";
  return name;
}

function plainName(value: string) {
  const name = shownName(value);
  return name && !name.includes("*") ? name : "";
}

function idKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sameCustomer(left: string, right: string) {
  const a = idKey(left);
  const b = idKey(right);
  return a.length >= 4 && a === b;
}

function firstPlain(names: string[]) {
  return names.map(plainName).find(Boolean) || "";
}

function namesFromGroups(customerId: string, groups: unknown) {
  if (!Array.isArray(groups)) return "";
  const found: string[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const record = group as { members?: { number?: string; name?: string }[]; bills?: { number?: string; name?: string }[] };
    for (const member of record.members ?? []) if (sameCustomer(String(member.number || ""), customerId)) found.push(String(member.name || ""));
    for (const bill of record.bills ?? []) if (sameCustomer(String(bill.number || ""), customerId)) found.push(String(bill.name || ""));
  }
  return firstPlain(found);
}

function kolektifName(userId: string, customerId: string) {
  if (!customerId) return "";
  try {
    const keys = userId ? [`mentari-kolektif:${userId}`] : [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || "";
      if (key.startsWith("mentari-kolektif:") && !keys.includes(key)) keys.push(key);
    }
    for (const key of keys) {
      const parsed = JSON.parse(localStorage.getItem(key) || "") as { rows?: unknown };
      const name = namesFromGroups(customerId, parsed.rows);
      if (name) return name;
    }
  } catch {
    return "";
  }
  return "";
}

async function savedCustomerName(customerId: string) {
  const session = await supabase.auth.getSession();
  return namesFromGroups(customerId, session.data.session?.user?.user_metadata?.collectives);
}

function customerLabel(customerId: string, digiName: string, history: Sale[], userId: string, saved = "") {
  const direct = plainName(digiName);
  if (direct) return direct;
  const past = history.find((sale) => sameCustomer(sale.customerNumber, customerId) && plainName(sale.customerName));
  return plainName(past?.customerName || "") || kolektifName(userId, customerId) || plainName(saved) || shownName(digiName) || "—";
}

function prepaidAmount(category: string, product: string, quoted: number) {
  const listed = findCatalogItem(category, product);
  if (listed?.kind !== "prepaid") return quoted;
  const face = faceValue(listed.label) || faceValue(product);
  return face > 0 ? face : quoted;
}

function meterOf(period: string) {
  const part = period.split("·").map((item) => item.trim()).find((item) => /VA\b|\//.test(item)) || "";
  return part;
}

function billMonths(value: unknown): BillMonth[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const period = String(record.period ?? "").trim();
    const amount = record.amount === null || record.amount === undefined || record.amount === "" ? null : Number(record.amount);
    const denda = record.denda === null || record.denda === undefined || record.denda === "" ? null : Number(record.denda);
    if (!period && amount === null && denda === null) return [];
    return [{ period, amount: typeof amount === "number" && Number.isFinite(amount) ? amount : null, denda: typeof denda === "number" && Number.isFinite(denda) ? denda : null }];
  });
}

function columnWidth(head: string) {
  if (head === "No") return "2.75rem";
  if (head === "Nama") return "26%";
  if (head === "Tot. Tagihan" || head === "Tagihan" || head === "Denda" || head === "Admin Bank" || head === "Collfee") return "11%";
  return undefined;
}

function headClass(head: string) {
  if (head === "No") return "px-1 text-center";
  if (head === "Tot. Tagihan" || head === "Tagihan" || head === "Denda" || head === "Admin Bank" || head === "Collfee") return "px-3 text-right";
  return "px-2";
}

function priceRow(row: CartRow, admin: number) {
  const total = row.amount + row.denda + admin;
  return { ...row, admin, total };
}

function AreaPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
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
  const matches = showAll ? options : options.filter((area) => area.toLowerCase().includes(needle));
  return (
    <div ref={box} className="relative">
      <Input
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          const exact = options.find((area) => area.toLowerCase() === next.trim().toLowerCase());
          if (exact) onChange(exact);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          const exact = options.find((area) => area.toLowerCase() === query.trim().toLowerCase());
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
  const [product, setProduct] = useState(productsFor(CATEGORIES[0])[0]);
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
  const [checking, setChecking] = useState(false);
  const [pendingRef, setPendingRef] = useState("");
  const draftRef = useRef(0);
  const inquiring = useRef(false);
  const paying = useRef(false);
  const loketName = profile?.full_name || profile?.username || "Loket";
  const productLabel = category === "PDAM" || category === "Pajak PBB" ? "Wilayah" : "Produk";
  const idLabel = category === "BPJS" ? "Nomor VA" : category === "Pulsa" || category === "Paket Data" || category === "SMS & Telpon" || category === "Masa Aktif" || category === "by.U" ? "Nomor HP" : category === "Games" ? "User ID" : category === "E-Money" ? "Nomor Akun" : "Customer ID";
  const choices = productsFor(category);
  const choiceKey = choices.join("|");
  useEffect(() => {
    if (choices.length > 0 && !choices.includes(product)) setProduct(choices[0]);
  }, [choiceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const appliedAdmin = category === "PLN" ? adminFee : (BILLER_ADMIN[category] ?? 0);
  const columns = ["No", "Produk", "Cust.ID", "Nama", "Periode", "Tot. Tagihan", "Tagihan", "Denda", "Admin Bank", "Collfee"];

  const clearDraft = () => {
    draftRef.current += 1;
    setCart([]);
    setNumber("");
    setMessage("");
    setError("");
    setReprintId("");
    setReprintDate("");
    setReprintHits([]);
    setAdminFee(4800);
    setMonths("01");
    setTaxYear(String(new Date().getFullYear()));
    setPendingRef("");
    setBusy(false);
  };

  const openCategory = (item: string) => {
    if (item === category) return;
    clearDraft();
    setCategory(item);
    setProduct(productsFor(item)[0] ?? "");
    setMode("bayar");
  };

  const changeProduct = (next: string) => {
    if (next === product) return;
    clearDraft();
    setProduct(next);
  };

  const openMode = (next: "bayar" | "cetak") => {
    if (next === mode) return;
    clearDraft();
    setMode(next);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const response = await fetch(apiUrl("/api/loket-sales"), { headers: await authHeader() });
      const body = response.ok ? await response.json() : { sales: [], simulations: [] };
      if (!active) return;
      setSales([...(body.simulations ?? []), ...(body.sales ?? [])]);
    })();
    return () => { active = false; };
  }, [tick]);

  const rows = cart.filter((row) => row.category === category).map((row) => priceRow(row, appliedAdmin));
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

  const lookup = async () => {
    if (inquiring.current || paying.current) return;
    const generation = draftRef.current;
    const activeCategory = category;
    const activeProduct = product;
    const customer = number.trim();
    if (customer.length < 4) {
      setMessage("");
      setError("Nomor pelanggan terlalu pendek.");
      return;
    }
    if (cart.some((row) => row.category === activeCategory && row.customerId === customer)) {
      setMessage("");
      setError(`ID ${customer} sudah ada di antrean ${activeCategory}. Tidak ditambahkan lagi.`);
      return;
    }
    inquiring.current = true;
    setChecking(true);
    setError("");
    setMessage("Mengecek tagihan...");
    let response: Response;
    try {
      response = await fetch(apiUrl("/api/biller/inquiry"), {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({ mode: "digiflazz", category: activeCategory, product: activeProduct, customerNumber: customer, adminFee: appliedAdmin, months, taxYear }),
    });
    } catch {
      if (draftRef.current === generation) setError("Backend VPS tidak dapat dihubungi.");
      if (draftRef.current === generation) setMessage("");
      inquiring.current = false;
      setChecking(false);
      return;
    }
    if (draftRef.current !== generation) {
      inquiring.current = false;
      setChecking(false);
      return;
    }
    const body = await response.json().catch(() => ({}));
    const bill = body.bill as { customerName?: string; period?: string; amount?: number; denda?: number; adminFee?: number; collfee?: number; total?: number; lines?: unknown } | undefined;
    if (body.statusText === "paid") {
      setMessage("");
      setError(body.message || "Tagihan sudah lunas.");
      inquiring.current = false;
      setChecking(false);
      return;
    }
    if (!response.ok || !bill) {
      setMessage("");
      setError(body.error || body.message || "Tagihan tidak ditemukan.");
      inquiring.current = false;
      setChecking(false);
      return;
    }
    const saved = await savedCustomerName(customer);
    if (draftRef.current !== generation) {
      inquiring.current = false;
      setChecking(false);
      return;
    }
    const name = customerLabel(customer, String(bill.customerName || ""), sales, profile?.id || "", saved);
    const refId = typeof body.providerRef === "string" && body.providerRef ? body.providerRef : crypto.randomUUID();
    const sku = typeof body.buyerSkuCode === "string" ? body.buyerSkuCode : "";
    const providerCost = Number((bill as { providerCost?: number }).providerCost) || 0;
    const monthLines = billMonths(bill.lines).filter((line) => line.amount != null);
    const meter = meterOf(bill.period || "");
    const baseAmount = prepaidAmount(activeCategory, activeProduct, Number(bill.amount) || 0);
    const shared = { payKey: refId, providerRef: refId, sku, category: activeCategory, product: activeProduct, customerId: customer, name, meter, collfee: Number(bill.collfee) || 0, providerCost };
    const built: CartRow[] = monthLines.length > 1
      ? monthLines.map((line, index) => ({ ...shared, key: `${refId}:${index}`, period: line.period || `Lembar ${index + 1}`, amount: line.amount ?? 0, denda: line.denda ?? 0 }))
      : [{ ...shared, key: refId, period: bill.period || monthLines[0]?.period || "", amount: baseAmount, denda: Number(bill.denda) || monthLines[0]?.denda || 0 }];
    let added = false;
    setCart((current) => {
      if (current.some((row) => row.category === activeCategory && row.customerId === customer)) return current;
      added = true;
      return [...current, ...built];
    });
    if (draftRef.current !== generation) {
      inquiring.current = false;
      setChecking(false);
      return;
    }
    if (!added) {
      setMessage("");
      setError(`ID ${customer} sudah ada di antrean ${activeCategory}. Tidak ditambahkan lagi.`);
    } else {
      const priced = built.map((row) => priceRow(row, activeCategory === "PLN" ? adminFee : (BILLER_ADMIN[activeCategory] ?? 0)));
      const billTotal = priced.reduce((sum, row) => sum + row.total, 0);
      setError("");
      setMessage(priced.length > 1
        ? `${priced.length} lembar ${activeProduct} untuk ${priced[0].name}. Tiap lembar memakai admin ${formatRupiah(priced[0].admin)}. Total ${formatRupiah(billTotal)}.`
        : `${activeCategory} ${activeProduct}: ${priced[0].name} · ${priced[0].period || "periode belum tersedia"} · tagihan ${formatRupiah(priced[0].amount)} · denda ${formatRupiah(priced[0].denda)} · admin ${formatRupiah(priced[0].admin)} · total ${formatRupiah(priced[0].total)}.`);
      setNumber("");
    }
    inquiring.current = false;
    setChecking(false);
  };

  const pay = async () => {
    const generation = draftRef.current;
    if (rows.length === 0 || busy || paying.current || inquiring.current) return;
    paying.current = true;
    setBusy(true);
    setError("");
    let balance = 0;
    let lastStatus = "";
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.payKey || row.providerRef || row.key;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [payKey, group] of groups) {
      const first = group[0];
      let response: Response;
      try {
      response = await fetch(apiUrl("/api/loket-sales"), {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({
          channel: "digiflazz",
          clientRef: payKey,
          providerRef: first.providerRef || payKey,
          buyerSkuCode: first.sku,
          category: first.category,
          product: `${first.category} ${first.product}`,
          customerNumber: first.customerId,
          customerName: first.name === "—" ? "" : first.name,
          amount: group.reduce((sum, row) => sum + row.total, 0),
          tagihan: group.reduce((sum, row) => sum + row.amount, 0),
          denda: group.reduce((sum, row) => sum + row.denda, 0),
          adminFee: group.reduce((sum, row) => sum + row.admin, 0),
          collfee: group.reduce((sum, row) => sum + row.collfee, 0),
          providerCost: Math.max(...group.map((row) => row.providerCost || 0)),
          period: group.map((row) => row.period).filter(Boolean).join(", "),
          loketName,
        }),
      });
      } catch {
        paying.current = false;
        if (draftRef.current !== generation) return;
        setBusy(false);
        setError("Backend VPS tidak dapat dihubungi. Ulangi cek status sebelum membayar lagi.");
        requestRefresh();
        return;
      }
      if (draftRef.current !== generation) {
        paying.current = false;
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        paying.current = false;
        setBusy(false);
        setError(body.error || "Pembayaran berhenti karena saldo atau data tidak cukup.");
        requestRefresh();
        return;
      }
      balance = Number(body.balance);
      lastStatus = String(body.statusText || "");
      if (lastStatus === "pending") setPendingRef(payKey);
    }
    paying.current = false;
    if (draftRef.current !== generation) return;
    setBusy(false);
    setCart([]);
    setMessage(lastStatus === "success"
      ? `Pembayaran berhasil. Saldo ${formatRupiah(balance)}.`
      : lastStatus === "failed"
        ? `Pembayaran gagal. Saldo ${formatRupiah(balance)}.`
        : `Pembayaran diproses. Saldo ${formatRupiah(balance)}.`);
    requestRefresh();
  };

  const checkStatus = async () => {
    const generation = draftRef.current;
    if (!pendingRef || busy) return;
    setBusy(true);
    let response: Response;
    try {
    response = await fetch(apiUrl("/api/biller/status"), {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({ clientRef: pendingRef }),
    });
    } catch {
      if (draftRef.current !== generation) return;
      setBusy(false);
      setError("Backend VPS tidak dapat dihubungi.");
      return;
    }
    if (draftRef.current !== generation) return;
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setError(body.error || "Status pembayaran belum terbaca."); return; }
    setError("");
    setMessage(`Status pembayaran: ${body.statusText || "pending"}. ${body.message || ""} Saldo ${formatRupiah(Number(body.balance) || 0)}.`);
    if (body.statusText === "success" || body.statusText === "failed") setPendingRef("");
    requestRefresh();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden pb-6">
      <div className="flex gap-1 overflow-x-auto rounded-md border border-slate-300 bg-white p-0.5">
        {CATEGORIES.map((item) => (
          <button
            key={item}
            onClick={() => openCategory(item)}
            className={`shrink-0 rounded px-2.5 py-1 text-sm font-black uppercase ${category === item ? "bg-amber-500 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => openMode("bayar")} className={`px-3 py-1.5 text-sm font-black ${mode === "bayar" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500"}`}>TRANSAKSI</button>
        <button onClick={() => openMode("cetak")} className={`px-3 py-1.5 text-sm font-black ${mode === "cetak" ? "border-b-2 border-amber-500 text-amber-700" : "text-slate-500"}`}>CETAK ULANG</button>
      </div>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-300 bg-white">
        {mode === "bayar" ? (
          <div className="grid h-[78px] shrink-0 grid-cols-4 items-end gap-2 overflow-visible px-2 py-1.5">
            <Field label={productLabel}>
              {category === "PDAM" ? (
                <AreaPicker value={product} options={choices} onChange={changeProduct} />
              ) : (
                <Select value={product} onChange={(event) => changeProduct(event.target.value)}>
                  {choices.map((item) => <option key={item}>{item}</option>)}
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
              <Input value={number} disabled={checking} onChange={(event) => setNumber(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void lookup(); } }} placeholder={idLabel} />
            </Field>
            <button type="button" onClick={() => void lookup()} disabled={checking} className="h-9 rounded-md bg-amber-500 px-3 text-sm font-black text-slate-950 disabled:opacity-50">{checking ? "Mengecek..." : "Inquiry"}</button>
          </div>
        ) : (
          <div className="grid h-[78px] shrink-0 grid-cols-4 items-end gap-2 overflow-hidden px-2 py-1.5">
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
              <colgroup>
                {columns.map((head) => <col key={head} style={{ width: columnWidth(head) }} />)}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                <tr>{columns.map((head) => <th key={head} className={`py-2 font-semibold ${headClass(head)}`}>{head}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">Belum ada tagihan. Lakukan Inquiry.</td></tr>}
                {rows.map((row, index) => (
                  <tr key={row.key} className="border-t border-slate-100 text-slate-700">
                    <td className="px-1 py-2 text-center tabular-nums">{index + 1}</td>
                    <td className="px-2 py-2">{row.category} {row.product}</td>
                    <td className="break-all px-2 py-2 font-mono">{row.customerId}</td>
                    <td className={`whitespace-normal break-words px-3 py-2 leading-5 ${row.name.includes("*") ? "text-sm font-semibold tracking-wide text-slate-900" : ""}`} title={row.name}>{row.name}</td>
                    <td className="whitespace-normal break-words px-2 py-2 leading-5">
                      {row.meter && <div className="font-medium text-slate-800">{row.meter}</div>}
                      {row.period.split("·").map((part) => part.trim()).filter((part) => part && part !== row.meter).map((part) => <div key={part}>{part}</div>)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatRupiah(row.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(row.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(row.denda)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(row.admin)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(row.collfee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                <tr>{["No", "Produk", "Cust.ID", "Nama", "Tanggal", "Total", "Status", "Aksi"].map((head) => <th key={head} className="px-3 py-2 font-semibold">{head}</th>)}</tr>
              </thead>
              <tbody>
                {reprintHits.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">Belum ada list. Isi Customer ID atau tanggal, lalu tekan CEK.</td></tr>}
                {reprintHits.map((sale, index) => (
                  <tr key={sale.id} className="border-t border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{index + 1}</td>
                    <td className="px-3 py-2">{sale.product}</td>
                    <td className="px-3 py-2 font-mono">{sale.customerNumber}</td>
                    <td className="whitespace-normal break-words px-3 py-2 leading-4">{customerLabel(sale.customerNumber, sale.customerName, sales, profile?.id || "")}</td>
                    <td className="px-3 py-2">{formatWaktu(sale.createdAt)}</td>
                    <td className="px-3 py-2 font-semibold">{formatRupiah(sale.amount)}</td>
                    <td className="px-3 py-2">{sale.status}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => printReceipts(loadPrinterSettings(loketCode), [{
                        id: sale.customerNumber,
                        name: customerLabel(sale.customerNumber, sale.customerName, sales, profile?.id || ""),
                        product: sale.product,
                        period: sale.period || formatWaktu(sale.createdAt),
                        tagihan: Math.max(0, Number(sale.amount) - Number(sale.adminFee ?? 0)),
                        admin: Number(sale.adminFee ?? 0),
                        total: Number(sale.amount),
                      }], `${loketCode} - ${loketName}`)} className="rounded-md bg-sky-700 px-2 py-1 text-[11px] font-bold text-white">Cetak Ulang</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 bg-slate-800 px-4 py-2.5 text-white">
          <div className="shrink-0 text-sm font-black">{mode === "bayar" ? `${rows.length} tagihan` : `${reprintHits.length} list`}</div>
          {mode === "bayar" ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" className="h-10 shrink-0 whitespace-nowrap px-3 font-black" disabled={rows.length === 0} onClick={() => printReceipts(loadPrinterSettings(loketCode), rows.map((row): ReceiptBill => ({ id: row.customerId, name: row.name, product: `${row.category} ${row.product}`, period: row.period, tagihan: row.amount + row.denda, admin: row.admin, total: row.total })), `${loketCode} - ${loketName}`)}>Cetak Info Tagihan</Button>
              <Button variant="outline" size="sm" className="h-10 shrink-0 whitespace-nowrap px-4 font-black" onClick={() => { setCart([]); setNumber(""); setError(""); setMessage(""); }}>Hapus</Button>
              {pendingRef && <button type="button" onClick={checkStatus} disabled={busy} className="h-10 shrink-0 whitespace-nowrap rounded-md border border-white/40 px-3 text-sm font-black text-white">Cek status</button>}
              <button onClick={() => void pay()} disabled={busy || checking || rows.length === 0} className="h-10 shrink-0 whitespace-nowrap rounded-md bg-amber-500 px-4 text-sm font-black text-slate-950 disabled:opacity-50">
                {busy ? "Memproses..." : `BAYAR ${formatRupiah(total)}`}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setReprintHits([])} className="h-10 shrink-0 whitespace-nowrap rounded-md border border-white/30 px-4 text-sm font-black text-white">Hapus Semua List</button>
          )}
        </div>
      </section>
    </div>
  );
}
