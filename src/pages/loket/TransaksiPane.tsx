import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useLoketRefresh } from "@/components/layout/LoketShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { finiteNumber, formatRupiah, formatWaktu } from "@/lib/format";
import { BILLER_CATEGORIES, faceValue, findCatalogItem, productsFor } from "@/lib/billerCatalog";
import { applyGroupAdmin, expandBillRows } from "@/lib/billQueue";
import { loadPrinterSettings, printReceipts, type ReceiptBill } from "@/lib/printer";
import { apiUrl } from "@/lib/apiBase";
import { PENDING_HOLD_MS } from "@/lib/pendingWindow";

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
  tagihan?: number;
  denda?: number;
  adminFee?: number;
  collfee?: number;
  period?: string;
  sn?: string;
  clientRef?: string;
  profit?: number;
  providerCost?: number;
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

async function postJson(path: string, payload: unknown, ms: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(apiUrl(path), {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
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

function entryNumber(entry: object) {
  const record = entry as Record<string, unknown>;
  return String(record.number || record.customerNumber || record.customer_number || record.customerId || record.custId || record.idpel || record.no || "");
}

function entryName(entry: object) {
  const record = entry as Record<string, unknown>;
  return String(record.name || record.customerName || record.customer_name || record.nama || "");
}

function namesFromGroups(customerId: string, groups: unknown) {
  if (!Array.isArray(groups)) return "";
  const found: string[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const record = group as { members?: object[]; bills?: object[] };
    for (const member of record.members ?? []) if (sameCustomer(entryNumber(member), customerId)) found.push(entryName(member));
    for (const bill of record.bills ?? []) if (sameCustomer(entryNumber(bill), customerId)) found.push(entryName(bill));
  }
  return firstPlain(found);
}

function kolektifName(userId: string, customerId: string) {
  if (!customerId) return "";
  const keys = userId ? [`mentari-kolektif:${userId}`] : [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || "";
    if (key.startsWith("mentari-kolektif:") && !keys.includes(key)) keys.push(key);
  }
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { rows?: unknown };
      const name = namesFromGroups(customerId, parsed.rows);
      if (name) return name;
    } catch {
      continue;
    }
  }
  return "";
}

async function savedCustomerName(customerId: string) {
  const session = await supabase.auth.getSession();
  return namesFromGroups(customerId, session.data.session?.user?.user_metadata?.collectives);
}

function customerLabel(customerId: string, digiName: string, history: Sale[], userId: string, saved = "") {
  const provider = shownName(digiName);
  if (provider) return provider;
  const past = history.find((sale) => sameCustomer(sale.customerNumber, customerId) && plainName(sale.customerName));
  return plainName(past?.customerName || "") || kolektifName(userId, customerId) || plainName(saved) || "—";
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

function periodLine(meter: string, period: string) {
  const months = period.split("·").map((item) => item.trim()).filter((item) => item && item !== meter && !/^\d+\s+lembar$/i.test(item));
  const month = months.join(", ");
  if (meter && month) return `${meter} - ${month}`;
  return meter || month || period;
}

const MONTH_INDEX: Record<string, string> = {
  januari: "01", februari: "02", maret: "03", april: "04", mei: "05", juni: "06",
  juli: "07", agustus: "08", september: "09", oktober: "10", november: "11", desember: "12",
};

function queueTokens(period: string): string[] {
  const tokens = canonicalPeriods(period);
  return tokens.length > 0 ? tokens : ["tanpa-periode"];
}

function paymentLabel(status: string) {
  if (status === "success" || status === "simulated") return "Sukses";
  if (status === "failed" || status === "refunded") return "Gagal";
  return "Pending";
}

function isSettled(status: string) {
  return status === "success" || status === "simulated" || status === "failed" || status === "refunded";
}

function isPaid(status: string) {
  return status === "success" || status === "simulated";
}

function groupMoney(group: { amount: number; denda: number; admin: number; collfee: number; total: number }[]) {
  return {
    amount: group.reduce((sum, row) => sum + finiteNumber(row.total), 0),
    tagihan: group.reduce((sum, row) => sum + finiteNumber(row.amount), 0),
    denda: group.reduce((sum, row) => sum + finiteNumber(row.denda), 0),
    admin: group.reduce((sum, row) => sum + finiteNumber(row.admin), 0),
    collfee: group.reduce((sum, row) => sum + finiteNumber(row.collfee), 0),
  };
}

function asSale(value: unknown, fallback: { category: string; product: string; customerId: string; name: string; period: string; amount: number; tagihan: number; denda: number; admin: number; collfee: number; payKey: string }, status: string): Sale | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Sale>;
  const id = String(row.id || row.clientRef || fallback.payKey || "");
  if (!id) return null;
  return {
    id,
    category: String(row.category || fallback.category),
    product: String(row.product || `${fallback.category} ${fallback.product}`),
    customerNumber: String(row.customerNumber || fallback.customerId),
    customerName: String(row.customerName || fallback.name || ""),
    amount: finiteNumber(row.amount, fallback.amount),
    tagihan: finiteNumber(row.tagihan, fallback.tagihan),
    denda: finiteNumber(row.denda, fallback.denda),
    adminFee: finiteNumber(row.adminFee, fallback.admin),
    collfee: finiteNumber(row.collfee, fallback.collfee),
    period: String(row.period || fallback.period || ""),
    sn: String(row.sn || ""),
    clientRef: String(row.clientRef || fallback.payKey),
    profit: finiteNumber(row.profit, 0),
    providerCost: finiteNumber(row.providerCost, 0),
    status: String(row.status || status),
    createdAt: String(row.createdAt || new Date().toISOString()),
  };
}

function receiptOf(sale: Sale, name: string): ReceiptBill {
  const admin = finiteNumber(sale.adminFee, 0);
  const denda = finiteNumber(sale.denda, 0);
  const amount = finiteNumber(sale.amount, 0);
  return {
    id: sale.customerNumber,
    name: name && name !== "—" ? name : (sale.customerName || "—"),
    product: sale.product,
    period: sale.period || "",
    tagihan: finiteNumber(sale.tagihan, Math.max(0, amount - admin - denda)),
    admin,
    total: amount,
    sn: sale.sn || "",
    at: formatWaktu(sale.createdAt),
  };
}

function canonicalPeriods(period: string): string[] {
  const packed = period.replace(/\D/g, "").match(/20\d{2}(?:0[1-9]|1[0-2])/g);
  if (packed && packed.length > 0) return packed;
  const found: string[] = [];
  const pattern = /(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(20\d{2})/gi;
  for (const match of period.matchAll(pattern)) {
    const month = MONTH_INDEX[match[1].toLowerCase()];
    if (month) found.push(`${match[2]}${month}`);
  }
  if (found.length > 0) return found;
  const raw = period.trim().toLowerCase();
  return raw ? [raw] : [];
}

function mergeInquiry(current: CartRow[], built: CartRow[], category: string, customer: string) {
  const same = (row: CartRow) => row.category === category && sameCustomer(row.customerId, customer);
  const existing = current.filter(same);
  if (built.length === 0) return { next: current, added: [] as CartRow[] };
  if (existing.length === 0) return { next: [...current, ...built], added: built };
  const incoming = [...new Set(built.flatMap((row) => queueTokens(row.period)))];
  const queued = [...new Set(existing.flatMap((row) => queueTokens(row.period)))];
  const missing = incoming.filter((token) => !queued.includes(token));
  const combined = existing.some((row) => queueTokens(row.period).length > 1);
  const incomingSplit = built.length > 1;
  if (missing.length === 0 && (!combined || !incomingSplit)) return { next: current, added: [] as CartRow[] };
  const covered = new Set(incoming);
  const kept = current.filter((row) => !same(row) || !queueTokens(row.period).some((token) => covered.has(token)));
  return { next: [...kept, ...built], added: built };
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
  if (head === "No") return "2.5rem";
  if (head === "Produk") return "13.5rem";
  if (head === "Cust.ID") return "9.75rem";
  if (head === "Nama") return "16%";
  if (head === "Periode") return "15.5rem";
  if (head === "Tagihan" || head === "Tot. Tagihan") return "8.5rem";
  if (head === "Denda") return "5.25rem";
  if (head === "Admin Bank") return "6rem";
  if (head === "Collfee") return "5rem";
  return undefined;
}

function headClass(head: string) {
  if (head === "No") return "px-1 text-center";
  if (head === "Tot. Tagihan" || head === "Tagihan" || head === "Denda" || head === "Admin Bank" || head === "Collfee") return "px-3 text-right";
  return "px-2";
}

function priceRows(rows: CartRow[], admin: number) {
  return applyGroupAdmin(rows, admin);
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
  const [storedGroups, setStoredGroups] = useState<unknown[]>([]);
  const [reprintId, setReprintId] = useState("");
  const [reprintDate, setReprintDate] = useState("");
  const [reprintHits, setReprintHits] = useState<Sale[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pendingRef, setPendingRef] = useState("");
  const draftRef = useRef(0);
  const inquiring = useRef(false);
  const paying = useRef(false);
  const salesRef = useRef<Sale[]>([]);
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
      const loaded = [...(body.simulations ?? []), ...(body.sales ?? [])] as Sale[];
      setSales(loaded);
      salesRef.current = loaded;
      if (loaded.some((sale) => sale.status === "pending" || sale.status === "failed")) void syncStatus(false);
      setPendingRef((current) => {
        const match = loaded.find((sale) => sale.clientRef === current);
        if (match) return match.status === "pending" ? current : "";
        const open = loaded.find((sale) => sale.status === "pending" && sale.clientRef);
        return open?.clientRef || "";
      });
    })();
    return () => { active = false; };
  }, [tick]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      const groups = data.session?.user?.user_metadata?.collectives;
      if (active) setStoredGroups(Array.isArray(groups) ? groups : []);
    });
    return () => { active = false; };
  }, [profile?.id, tick]);

  const rows = priceRows(cart.filter((row) => row.category === category), appliedAdmin);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const checkReprint = () => {
    if (!reprintId.trim() && !reprintDate) {
      setError("Isi Customer ID atau tanggal transaksi.");
      setReprintHits([]);
      return;
    }
    setError("");
    setReprintHits(sales.filter((sale) => {
      if (sale.status !== "success" && sale.status !== "simulated") return false;
      if (sale.category && sale.category.toLowerCase() !== category.toLowerCase()) return false;
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
      setError("Nomor pelanggan terlalu pendek.");
      return;
    }
    inquiring.current = true;
    setChecking(true);
    setError("");
    let response: Response;
    try {
      response = await fetch(apiUrl("/api/biller/inquiry"), {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({ mode: "digiflazz", category: activeCategory, product: activeProduct, customerNumber: customer, adminFee: appliedAdmin, months, taxYear }),
    });
    } catch {
      if (draftRef.current === generation) setError("Backend VPS tidak dapat dihubungi.");
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
      setError(body.message || "Tagihan sudah lunas.");
      inquiring.current = false;
      setChecking(false);
      return;
    }
    if (!response.ok || !bill) {
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
    const name = customerLabel(customer, String(bill.customerName || ""), sales, profile?.id || "", saved || namesFromGroups(customer, storedGroups));
    const refId = typeof body.providerRef === "string" && body.providerRef ? body.providerRef : crypto.randomUUID();
    const sku = typeof body.buyerSkuCode === "string" ? body.buyerSkuCode : "";
    const providerCost = Number((bill as { providerCost?: number }).providerCost) || 0;
    const monthLines = billMonths(bill.lines);
    const meter = meterOf(bill.period || "");
    const baseAmount = prepaidAmount(activeCategory, activeProduct, Number(bill.amount) || 0);
    const slices = expandBillRows({
      period: [bill.period || "", ...monthLines.map((line) => line.period)].filter(Boolean).join(" · "),
      lines: monthLines,
      amount: baseAmount,
      denda: Number(bill.denda) || 0,
      collfee: Number(bill.collfee) || 0,
    });
    const shared = { payKey: refId, providerRef: refId, sku, category: activeCategory, product: activeProduct, customerId: customer, name, meter, providerCost };
    const built: CartRow[] = slices.map((slice, index) => ({
      ...shared,
      key: `${refId}:${canonicalPeriods(slice.period).join("-") || index}`,
      period: slice.period,
      amount: slice.amount,
      denda: slice.denda,
      collfee: slice.collfee,
      providerCost: index === 0 ? providerCost : 0,
    }));
    const merged = mergeInquiry(cart, built, activeCategory, customer);
    const added = merged.added;
    if (added.length > 0) setCart(merged.next);
    if (draftRef.current !== generation) {
      inquiring.current = false;
      setChecking(false);
      return;
    }
    if (added.length === 0) {
      const periodLabel = built.map((row) => row.period).filter(Boolean).join(", ") || "ini";
      setError(`Tagihan ${customer} periode ${periodLabel} sudah ada di antrean ${activeCategory}.`);
    } else {
      setError("");
      setNumber("");
    }
    inquiring.current = false;
    setChecking(false);
  };

  salesRef.current = sales;

  const rememberSale = (sale: Sale) => {
    salesRef.current = [sale, ...salesRef.current.filter((row) => row.id !== sale.id && (!sale.clientRef || row.clientRef !== sale.clientRef))];
    setSales(salesRef.current);
  };

  const printPaid = (items: Sale[]) => {
    if (items.length === 0) return true;
    const slips = items.map((sale) => receiptOf(sale, customerLabel(sale.customerNumber, sale.customerName, salesRef.current, profile?.id || "", namesFromGroups(sale.customerNumber, storedGroups))));
    return printReceipts(loadPrinterSettings(loketCode), slips, `${loketCode} - ${loketName}`);
  };

  const syncStatus = async (announce: boolean) => {
    if (paying.current) return;
    if (announce) {
      setBusy(true);
      setError("");
    }
    try {
      const response = await postJson("/api/biller/sync", {}, 100_000);
      const body = await response.json().catch(() => ({})) as { error?: string; sales?: Sale[] };
      if (!response.ok) {
        if (announce) setError(body.error || "Status belum tersinkron.");
        return;
      }
      const incoming = Array.isArray(body.sales) ? body.sales : [];
      const before = new Map(salesRef.current.map((sale) => [sale.id, sale.status]));
      const next = [
        ...incoming,
        ...salesRef.current.filter((sale) => sale.status === "simulated" && !incoming.some((row) => row.id === sale.id)),
      ];
      salesRef.current = next;
      setSales(next);
      const fresh = next.filter((sale) => (sale.status === "success" || sale.status === "simulated") && (before.get(sale.id) === "pending" || before.get(sale.id) === "failed"));
      if (fresh.length > 0 && !printPaid(fresh)) setError("Struk belum terbuka. Gunakan Cetak Ulang.");
      else if (announce && fresh.length === 0) setError("");
      setPendingRef(next.find((sale) => sale.status === "pending" && sale.clientRef)?.clientRef || "");
      if (announce || fresh.length > 0) requestRefresh();
    } catch {
      if (announce) setError("Sinkronisasi status belum mendapat jawaban. Coba lagi.");
    } finally {
      if (announce) setBusy(false);
    }
  };

  const readStatus = async (clientRef: string) => {
    const response = await postJson("/api/biller/status", { clientRef }, 12_000);
    const body = await response.json().catch(() => ({})) as { error?: string; statusText?: string; sale?: Partial<Sale> };
    return { response, body };
  };

  const pay = async () => {
    const generation = draftRef.current;
    if (rows.length === 0 || busy || paying.current || inquiring.current) return;
    paying.current = true;
    setBusy(true);
    setError("");
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.payKey || row.providerRef || row.key;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const paid: Sale[] = [];
    const doneKeys = new Set<string>();
    let pendingKey = "";
    let stopped = "";
    const dropDone = () => {
      if (doneKeys.size === 0) return;
      setCart((current) => current.filter((row) => !doneKeys.has(row.payKey || row.providerRef || row.key)));
    };
    try {
    for (const [payKey, group] of groups) {
      const first = group[0];
      const money = groupMoney(group);
      const period = group.map((row) => row.period).filter(Boolean).join(", ");
      const shown = customerLabel(first.customerId, first.name, salesRef.current, profile?.id || "", namesFromGroups(first.customerId, storedGroups));
      const fallback = {
        category: first.category,
        product: first.product,
        customerId: first.customerId,
        name: shown === "—" ? first.name : shown,
        period,
        amount: money.amount,
        tagihan: money.tagihan,
        denda: money.denda,
        admin: money.admin,
        collfee: money.collfee,
        payKey,
      };
      let response: Response | null = null;
      let body: { error?: string; statusText?: string; sale?: Partial<Sale> } = {};
      try {
        response = await postJson("/api/loket-sales", {
          channel: "digiflazz",
          clientRef: payKey,
          providerRef: first.providerRef || payKey,
          buyerSkuCode: first.sku,
          kind: findCatalogItem(first.category, first.product)?.kind || "",
          category: first.category,
          product: `${first.category} ${first.product}`,
          customerNumber: first.customerId,
          customerName: shown === "—" ? "" : shown,
          amount: money.amount,
          tagihan: money.tagihan,
          denda: money.denda,
          adminFee: money.admin,
          collfee: money.collfee,
          providerCost: Math.max(...group.map((row) => finiteNumber(row.providerCost))),
          period,
          loketName,
        }, 50_000);
        body = await response.json().catch(() => ({}));
      } catch {
        response = null;
      }
      if (!response) {
        try {
          const checked = await readStatus(payKey);
          if (checked.response.ok || checked.body.sale) {
            response = checked.response;
            body = checked.body;
          }
        } catch {
          response = null;
        }
      }
      if (draftRef.current !== generation) return;
      if (!response) {
        stopped = "Pembayaran belum mendapat jawaban tepat waktu. Cek status sebelum mengulang. Saldo hanya terpotong bila status Sukses.";
        pendingKey = payKey;
        break;
      }
      let statusText = String(body.statusText || body.sale?.status || (response.ok ? "pending" : "failed"));
      if (!response.ok && !body.sale) {
        stopped = body.error || "Pembayaran berhenti karena saldo atau data tidak cukup.";
        if (response.status === 504 || statusText === "pending") pendingKey = payKey;
        break;
      }
      if (statusText === "pending") {
        const deadline = Date.now() + PENDING_HOLD_MS;
        while (Date.now() < deadline && statusText === "pending") {
          if (draftRef.current !== generation) return;
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
          if (draftRef.current !== generation) return;
          try {
            const checked = await readStatus(payKey);
            if (checked.body.sale) body.sale = { ...body.sale, ...checked.body.sale, sn: checked.body.sale.sn || body.sale?.sn || "" };
            statusText = String(checked.body.statusText || checked.body.sale?.status || statusText);
          } catch {
            /* jawaban provider berikutnya tetap ditunggu sampai batas waktu */
          }
        }
      }
      const sale = asSale(body.sale, fallback, statusText);
      if (isPaid(statusText) && sale) {
        paid.push({ ...sale, status: statusText });
        doneKeys.add(payKey);
        rememberSale({ ...sale, status: statusText });
        continue;
      }
      if (statusText === "failed" || statusText === "refunded") {
        doneKeys.add(payKey);
        if (sale) rememberSale({ ...sale, status: statusText });
        stopped = "Pembayaran gagal. Saldo tidak dipotong.";
        break;
      }
      pendingKey = payKey;
      doneKeys.add(payKey);
      if (sale) rememberSale({ ...sale, status: "pending" });
    }
    if (draftRef.current !== generation) return;
    dropDone();
    const printed = paid.length === 0 || printPaid(paid);
    setError(stopped || (printed ? "" : "Struk belum terbuka. Gunakan Cetak Ulang."));
    if (pendingKey) setPendingRef(pendingKey);
    requestRefresh();
    } finally {
      paying.current = false;
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    const generation = draftRef.current;
    if (!pendingRef || busy || paying.current) return;
    setBusy(true);
    try {
      const { response, body } = await readStatus(pendingRef);
      if (draftRef.current !== generation) return;
      const statusText = String(body.statusText || body.sale?.status || "pending");
      if (!response.ok && !body.sale) {
        setError(body.error || "Status pembayaran belum terbaca.");
        setBusy(false);
        return;
      }
      const known = salesRef.current.find((sale) => sale.clientRef === pendingRef);
      const sale = asSale(body.sale, {
        category: known?.category || "",
        product: known?.product || "",
        customerId: known?.customerNumber || "",
        name: known?.customerName || "",
        period: known?.period || "",
        amount: finiteNumber(known?.amount),
        tagihan: finiteNumber(known?.tagihan),
        denda: finiteNumber(known?.denda),
        admin: finiteNumber(known?.adminFee),
        collfee: finiteNumber(known?.collfee),
        payKey: pendingRef,
      }, statusText);
      if (isPaid(statusText)) {
        if (sale) rememberSale({ ...sale, status: statusText });
        const printed = sale ? printPaid([{ ...sale, status: statusText }]) : true;
        setPendingRef("");
        setError(printed ? "" : "Struk belum terbuka. Gunakan Cetak Ulang.");
      } else if (statusText === "failed" || statusText === "refunded") {
        if (sale) rememberSale({ ...sale, status: statusText });
        setPendingRef("");
        setError("Pembayaran gagal. Saldo tidak dipotong.");
      }
      requestRefresh();
    } catch {
      if (draftRef.current === generation) setError("Backend VPS tidak dapat dihubungi.");
    }
    if (draftRef.current === generation) setBusy(false);
  };

  useEffect(() => {
    if (!pendingRef) return;
    let stopped = false;
    const release = () => {
      if (stopped) return;
      stopped = true;
      setPendingRef((current) => current === pendingRef ? "" : current);
      requestRefresh();
    };
    const probe = async () => {
      if (stopped || paying.current) return;
      try {
        const response = await postJson("/api/biller/status", { clientRef: pendingRef }, 12_000);
        const body = await response.json().catch(() => ({})) as { statusText?: string; sale?: Partial<Sale> };
        if (stopped || (!response.ok && !body.sale)) return;
        const statusText = String(body.statusText || body.sale?.status || "pending");
        if (!isSettled(statusText)) return;
        stopped = true;
        setPendingRef("");
        const current = salesRef.current.find((sale) => sale.clientRef === pendingRef);
        const sale = asSale(body.sale, {
          category: current?.category || "",
          product: current?.product || "",
          customerId: current?.customerNumber || "",
          name: current?.customerName || "",
          period: current?.period || "",
          amount: finiteNumber(current?.amount),
          tagihan: finiteNumber(current?.tagihan),
          denda: finiteNumber(current?.denda),
          admin: finiteNumber(current?.adminFee),
          collfee: finiteNumber(current?.collfee),
          payKey: pendingRef,
        }, statusText);
        if (sale) rememberSale({ ...sale, status: statusText });
        if (isPaid(statusText) && sale && !printPaid([{ ...sale, status: statusText }])) setError("Struk belum terbuka. Gunakan Cetak Ulang.");
        if (statusText === "failed" || statusText === "refunded") setError("Pembayaran gagal. Saldo tidak dipotong.");
        requestRefresh();
      } catch {
        /* cek berikutnya tetap berjalan sampai batas 1 menit */
      }
    };
    const pulse = window.setInterval(() => { void probe(); }, 5000);
    const end = window.setTimeout(release, 120_000);
    return () => {
      stopped = true;
      window.clearInterval(pulse);
      window.clearTimeout(end);
    };
  }, [pendingRef]);

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
        <div className="h-6 shrink-0 truncate px-4 text-sm text-rose-600">{error}</div>
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
                {rows.map((row, index) => {
                  const name = customerLabel(row.customerId, row.name, sales, profile?.id || "", namesFromGroups(row.customerId, storedGroups));
                  return (
                  <tr key={row.key} className="border-t border-slate-100 text-slate-700">
                    <td className="px-1 py-2 text-center tabular-nums">{index + 1}</td>
                    <td className="whitespace-nowrap px-2 py-2">{row.category} {row.product}</td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono tracking-tight">{row.customerId}</td>
                    <td className={`whitespace-normal break-words px-3 py-2 leading-5 ${name.includes("*") ? "text-sm font-semibold tracking-wide text-slate-900" : ""}`} title={name}>{name}</td>
                    <td className="whitespace-nowrap px-2 py-2" title={periodLine(row.meter, row.period)}>{periodLine(row.meter, row.period)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatRupiah(row.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(row.amount)}</td>
                    <td className="px-1.5 py-2 text-right tabular-nums">{formatRupiah(row.denda)}</td>
                    <td className="px-1.5 py-2 text-right tabular-nums">{formatRupiah(row.admin)}</td>
                    <td className="px-1.5 py-2 text-right tabular-nums">{formatRupiah(row.collfee)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full table-fixed text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                <tr>{["No", "Produk", "Cust.ID", "Nama", "Tanggal", "Total", "Status", "SN/Ref", "Aksi"].map((head) => <th key={head} className="px-3 py-2 font-semibold">{head}</th>)}</tr>
              </thead>
              <tbody>
                {reprintHits.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Belum ada transaksi sukses. Isi Customer ID atau tanggal, lalu tekan CEK.</td></tr>}
                {reprintHits.map((sale, index) => (
                  <tr key={sale.id} className="border-t border-slate-100 text-slate-700">
                    <td className="px-3 py-2">{index + 1}</td>
                    <td className="px-3 py-2">{sale.product}</td>
                    <td className="px-3 py-2 font-mono">{sale.customerNumber}</td>
                    <td className="whitespace-normal break-words px-3 py-2 leading-4">{customerLabel(sale.customerNumber, sale.customerName, sales, profile?.id || "", namesFromGroups(sale.customerNumber, storedGroups))}</td>
                    <td className="px-3 py-2">{formatWaktu(sale.createdAt)}</td>
                    <td className="px-3 py-2 font-semibold">{formatRupiah(sale.amount)}</td>
                    <td className="px-3 py-2">{paymentLabel(sale.status)}</td>
                    <td className="break-all px-3 py-2 font-mono text-[11px]">{sale.sn || "—"}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => printReceipts(loadPrinterSettings(loketCode), [{
                        id: sale.customerNumber,
                        name: customerLabel(sale.customerNumber, sale.customerName, sales, profile?.id || "", namesFromGroups(sale.customerNumber, storedGroups)),
                        product: sale.product,
                        period: sale.period || formatWaktu(sale.createdAt),
                        tagihan: Number(sale.tagihan) || Math.max(0, Number(sale.amount) - Number(sale.adminFee ?? 0) - Number(sale.denda ?? 0)),
                        admin: Number(sale.adminFee ?? 0),
                        total: Number(sale.amount),
                        sn: sale.sn || "",
                        at: formatWaktu(sale.createdAt),
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
              <Button variant="outline" size="sm" className="h-10 shrink-0 whitespace-nowrap px-4 font-black" onClick={() => { setCart([]); setNumber(""); setError(""); }}>Hapus</Button>
              <button type="button" onClick={() => void syncStatus(true)} disabled={busy} className="h-10 shrink-0 whitespace-nowrap rounded-md border border-white/40 px-3 text-sm font-black text-white">Sinkronkan</button>
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
