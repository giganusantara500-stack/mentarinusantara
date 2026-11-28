import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useLoketRefresh } from "@/components/layout/LoketShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Form";
import { formatRupiah, formatWaktu } from "@/lib/format";
import { ADMIN_BANK_EVENT, ADMIN_FEES, adminForProduct, loadPlnAdmin, savePlnAdmin } from "@/lib/adminBank";
import { BILLER_CATEGORIES, BILLER_CATALOG, collectiveProductChoices, collectiveTab, productsFor, resolveCollectiveProduct } from "@/lib/billerCatalog";
import { PDAM_AREAS } from "@/lib/pdam";
import { depositRequest } from "@/lib/depositApi";
import { apiUrl } from "@/lib/apiBase";
import { isLivePending, isProductionSuccess } from "@/lib/saleWindow";
import { setoranDays, setoranLines } from "@/lib/setoranReport";
import { PRINT_FORMATS, PRINT_KINDS, PRINTER_PRESETS, loadPrinterSettings, printReceipts, renderReceipts, sampleBill, savePrinterSettings, type PrinterSettings } from "@/lib/printer";
export { LoketTransaksiPage } from "./TransaksiPane";

const CATEGORIES = ["PLN", "Telkom", "PDAM", "BPJS", "Finance", "Gas", "Pajak PBB", "Internet & TV", "Topup", "Telco"];
const KOLEKTIF_CATEGORIES = ["PLN", "PDAM", "GAS", "TELKOM", "BPJS", "TELCO", "FINANCE", "INTERNET & TV", "PAJAK PBB", "CUSTID"] as const;
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
  Telco: ["Tagihan Halo", "XL Postpaid", "Indosat Postpaid", "Three Postpaid", "Smartfren Postpaid"],
};
const BANKS = ["BCA", "Mandiri", "BRI", "BNI", "BSI"];

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
  loketCode?: string;
  loketName?: string;
  status: string;
  sn?: string;
  createdAt: string;
}

interface Bill {
  name: string;
  period: string;
  amount: number;
  denda: number;
  admin: number;
  collfee: number;
  total: number;
}

interface Member { number: string; name: string; product?: string }
interface GroupBill { number: string; name: string; product?: string; period: string; total: number; status: "LUNAS" | "BL LNS" | "LAINNYA"; note?: string; sku?: string; providerRef?: string; menuCategory?: string; menuProduct?: string; tagihan?: number; denda?: number; adminFee?: number; providerCost?: number; stand?: string }
interface Group {
  id: string;
  name: string;
  collector: string;
  category: string;
  loketCode?: string;
  ownerName?: string;
  members: Member[];
  bills: GroupBill[];
  history: { at: string; count: number; total: number }[];
}

async function authHeader() {
  const session = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session.data.session?.access_token ?? ""}`, "Content-Type": "application/json" };
}

async function apiFetch(path: string, init: RequestInit = {}, ms = 20_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(apiUrl(path), { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

const HOSTING_KOLEKTIF = "Layanan kolektif di hosting tidak menjawab JSON. Pastikan fungsi API dan kunci Supabase aktif.";

interface KolektifApiBody {
  error?: string;
  rows?: Group[];
  row?: Partial<Group> & { id?: string };
}

async function readApi(response: Response): Promise<{ ok: boolean; json: boolean; body: KolektifApiBody }> {
  const text = await response.text();
  if (!text) return { ok: response.ok, json: true, body: {} };
  try {
    const body = JSON.parse(text) as KolektifApiBody;
    return { ok: response.ok && !body.error, json: true, body };
  } catch {
    return { ok: false, json: false, body: { error: HOSTING_KOLEKTIF } };
  }
}

function prepaidAmount(product: string) {
  const match = product.match(/Prepaid\s+(\d+)/i);
  return match ? Number(match[1]) * 1000 : null;
}

function inquire(category: string, number: string, product: string, adminFee: number): Bill | null {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 5) return null;
  const fixed = prepaidAmount(product);
  const tail = Number(digits.slice(-5)) || 10000;
  const amount = fixed ?? (15000 + (tail % 250000));
  const denda = fixed ? 0 : (tail % 9 === 0 ? 2000 : 0);
  const collfee = 0;
  const period = new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return { name: `Pelanggan ${digits.slice(-4)}`, period, amount, denda, admin: adminFee, collfee, total: amount + denda + adminFee + collfee };
}

function printBill(title: string, lines: string[]) {
  const popup = window.open("", "struk", "width=460,height=720");
  if (!popup) return;
  const body = `${title}\n${lines.join("\n")}`.replace(/</g, "&lt;");
  popup.document.write(`<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre">${body}</pre>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

function printSheet(text: string) {
  const popup = window.open("", "kolektif-cetak", "width=980,height=760");
  if (!popup) return;
  const body = text.replace(/</g, "&lt;");
  const closeScript = "</" + "script>";
  popup.document.write(`<!doctype html><html><head><title>Daftar Tagihan Kolektif</title><style>@page{size:A4 landscape;margin:10mm}body{margin:0}pre{font-family:"Courier New",Consolas,monospace;font-size:10px;line-height:1.35;white-space:pre;color:#0f172a}</style></head><body><pre>${body}</pre><script>window.onload=function(){window.print()}${closeScript}</body></html>`);
  popup.document.close();
  popup.focus();
}

function identityLine(code: string, name: string) {
  return code ? `${code} - ${name}` : name;
}

function clip(value: string, width: number) {
  return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

function paidNotice(message: string) {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned || (/belum tersedia/i.test(cleaned) && !/terbayar|dibayar/i.test(cleaned))) return "";
  if (/\[0*88\]|sudah\s+(di|ter)?bayar|tagihan\s+sudah/i.test(cleaned)) return cleaned;
  return "";
}

function monthOf(period: string) {
  const parts = period.split("·").map((item) => item.trim()).filter((item) => item && !/VA\b/i.test(item) && !/^\d+\s+lembar$/i.test(item));
  return parts.join(", ") || period;
}

function shortPeriod(period: string) {
  const full = monthOf(period);
  if (!full || full === "Memuat" || full === "-" || full === "Tagihan") return full;
  const month = full.match(/[A-Za-zÀ-ÿ]+/)?.[0] || full;
  return month.slice(0, 10);
}

function billStatusLabel(row: GroupBill) {
  if (row.period === "Memuat") return "Memuat";
  const paid = paidNotice(row.note || "");
  if (row.status === "LUNAS") return paid || "LUNAS";
  if (row.status === "LAINNYA") return row.note || "Perlu Diperiksa";
  return "BL LUNAS";
}

function applyDeskAdmin(row: GroupBill, plnChoice: number): GroupBill {
  if (row.period === "Memuat" || row.status === "LUNAS" || row.status === "LAINNYA") return row;
  const admin = adminForProduct(row.menuCategory || row.product || "", row.menuProduct || row.product || "", plnChoice);
  const denda = row.denda || 0;
  const tagihan = row.tagihan && row.tagihan > 0 ? row.tagihan : Math.max(0, (row.total || 0) - (row.adminFee || 0) - denda);
  if (tagihan < 1000 && row.total < 1000) return row;
  return { ...row, tagihan, adminFee: admin, total: tagihan + denda + admin };
}

function rupiahCol(value: number, width: number) {
  const text = formatRupiah(value);
  return text.length > width ? text.slice(0, width) : text.padStart(width);
}

function sheetText(group: Group, code: string, loketName: string) {
  const period = group.bills.map((bill) => monthOf(bill.period)).find((item) => item && item !== "Memuat" && item !== "-" && item !== "Tagihan") || new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const rule = "=".repeat(132);
  const line = "-".repeat(132);
  const header = `${clip("NO", 4)} ${clip("ID PELANGGAN", 14)} ${clip("NAMA PELANGGAN", 16)} ${clip("PERIODE", 14)} ${clip("STAND METER", 16)} ${"TAGIHAN".padStart(12)} ${"ADMIN BANK".padStart(12)} ${"RP.TOTAL".padStart(14)} STATUS`;
  const lines = [
    rule,
    "MENTARI NUSANTARA",
    "DAFTAR TAGIHAN PELANGGAN",
    rule,
    `Bulan Tagihan : ${period}`,
    `IDPP          : ${identityLine(group.loketCode || code, loketName)}`,
    `Nama Daftar   : ${group.collector || group.name}`,
    `Tanggal Cetak : ${new Date().toLocaleString("id-ID")}`,
    line,
    header,
    line,
  ];
  const rowLine = (index: number, bill: GroupBill) => `${clip(String(index), 4)} ${clip(bill.number, 14)} ${clip(bill.name || "—", 16)} ${clip(monthOf(bill.period), 14)} ${clip(bill.stand || "-", 16)} ${rupiahCol(bill.tagihan || 0, 12)} ${rupiahCol(bill.adminFee || 0, 12)} ${rupiahCol(bill.total, 14)} ${billStatusLabel(bill)}`;
  group.bills.forEach((bill, index) => lines.push(rowLine(index + 1, bill)));
  const money = (rows: GroupBill[]) => rows.reduce((total, bill) => total + bill.total, 0);
  const belum = group.bills.filter((bill) => bill.status === "BL LNS");
  const lunas = group.bills.filter((bill) => bill.status === "LUNAS");
  const gagal = group.bills.filter((bill) => bill.status === "LAINNYA");
  const summary = (label: string, rows: GroupBill[]) => `SUBTOTAL ${label.padEnd(12)}: ${String(rows.length).padStart(4)} lembar    ${formatRupiah(money(rows))}`;
  lines.push(line);
  lines.push(summary("BL LUNAS", belum));
  lines.push(summary("LUNAS", lunas));
  lines.push(summary("GAGAL", gagal));
  lines.push(line);
  lines.push(`RP.TOTAL ${formatRupiah(money(group.bills))}    ${group.bills.length} pelanggan`);
  lines.push(rule);
  return lines.join("\n");
}

function cacheKey(userId: string) {
  return `mentari-kolektif:${userId}`;
}

function storedName(name: string) {
  const value = name.trim();
  return /^pelanggan(\s+\d+)?$/i.test(value) ? "" : value;
}

function preferShownName(incoming: string, stored: string) {
  return storedName(incoming) || storedName(stored);
}

function shownCustomer(name: string) {
  return storedName(name) || "—";
}

function normalizeBill(bill: Partial<GroupBill>): GroupBill {
  const status = bill.status === "LUNAS" || bill.status === "LAINNYA" || bill.status === "BL LNS" ? bill.status : "BL LNS";
  return {
    number: String(bill.number ?? "").trim(),
    name: storedName(String(bill.name ?? "")),
    product: bill.product ? String(bill.product) : "",
    period: String(bill.period ?? ""),
    total: Number(bill.total) || 0,
    status,
    note: bill.note ? String(bill.note) : "",
    sku: bill.sku ? String(bill.sku) : "",
    providerRef: bill.providerRef ? String(bill.providerRef) : "",
    menuCategory: bill.menuCategory ? String(bill.menuCategory) : "",
    menuProduct: bill.menuProduct ? String(bill.menuProduct) : "",
    tagihan: Number(bill.tagihan) || 0,
    denda: Number(bill.denda) || 0,
    adminFee: Number(bill.adminFee) || 0,
    providerCost: Number(bill.providerCost) || 0,
    stand: bill.stand ? String(bill.stand) : "",
  };
}

function normalizeGroup(row: Partial<Group> & { members?: Member[]; bills?: GroupBill[] }): Group {
  const members = Array.isArray(row.members)
    ? row.members.filter((member) => member?.number).map((member) => ({
      number: String(member.number).trim(),
      name: storedName(String(member.name || "")),
      product: member.product ? String(member.product) : "",
    }))
    : [];
  return {
    id: row.id || crypto.randomUUID(),
    name: row.name || row.collector || "Kolektor",
    collector: row.collector || row.name || "Kolektor",
    category: typeof row.category === "string" ? row.category.trim() : "",
    loketCode: row.loketCode,
    ownerName: row.ownerName,
    members,
    bills: Array.isArray(row.bills) ? row.bills.map((bill) => normalizeBill(bill)).filter((bill) => bill.number) : [],
    history: Array.isArray(row.history) ? row.history : [],
  };
}

function readCollectiveCache(userId: string) {
  if (!userId) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(userId)) || "") as { dirty?: boolean; rows?: Group[] };
    if (!Array.isArray(parsed?.rows)) return null;
    return { dirty: Boolean(parsed.dirty), rows: adoptGroups(parsed.rows) };
  } catch {
    return null;
  }
}

function writeCollectiveCache(userId: string, rows: Group[], dirty: boolean) {
  if (!userId) return;
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({ dirty, rows }));
  } catch {
    // Perangkat penuh. Daftar di layar tetap dipakai.
  }
}

function cleanCell(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(0);
  const text = String(value).trim().replace(/^\uFEFF/, "").replace(/^["']|["']$/g, "");
  if (/^\d+(\.\d+)?e\+\d+$/i.test(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) return num.toFixed(0);
  }
  return text.replace(/\.0+$/, "");
}

function normalizeId(value: string) {
  const compact = value.replace(/\s+/g, "");
  return /\d/.test(compact) && compact.replace(/[\d.]/g, "").length <= 2 ? compact : value.trim();
}

function isCustomerId(value: string) {
  const text = normalizeId(value);
  if (text.length < 5 || text.length > 32) return false;
  if (/^(id|nama|produk|product|nomor|pelanggan|no)$/i.test(text)) return false;
  return /\d/.test(text);
}

function canonicalCategory(product?: string): string {
  const raw = (product || "").trim();
  if (!raw) return "CUSTID";
  const tab = collectiveTab(raw, raw);
  if (tab) return tab;
  const key = raw.toUpperCase().replace(/\s+/g, " ").replace(/PASCABAYAR/g, "POSTPAID");
  if ((KOLEKTIF_CATEGORIES as readonly string[]).includes(key)) return key;
  for (const [category, names] of Object.entries(PRODUCTS)) {
    const canon = category.toUpperCase().replace(/\s+/g, " ");
    if (!(KOLEKTIF_CATEGORIES as readonly string[]).includes(canon)) continue;
    if (key === canon || names.some((name) => name.toUpperCase() === key)) return canon;
  }
  const prefixed = KOLEKTIF_CATEGORIES.find((item) => key === item || key.startsWith(`${item} `) || key.startsWith(`${item}-`));
  if (prefixed) return prefixed;
  const token = key.split(" ")[0];
  if (token !== key) {
    const fromToken = canonicalCategory(token);
    if ((KOLEKTIF_CATEGORIES as readonly string[]).includes(fromToken)) return fromToken;
  }
  return key;
}

function sameCategory(product: string | undefined, category: string) {
  return canonicalCategory(product) === canonicalCategory(category);
}

function memberKey(member: { number: string; product?: string }) {
  return `${canonicalCategory(member.product)}:${member.number}`;
}

function expandGroup(row: Group): Group[] {
  const buckets = new Map<string, { members: Member[]; bills: GroupBill[] }>();
  const put = (category: string) => {
    const key = canonicalCategory(category);
    const found = buckets.get(key);
    if (found) return found;
    const created = { members: [] as Member[], bills: [] as GroupBill[] };
    buckets.set(key, created);
    return created;
  };
  const explicit = row.category.trim();
  if (explicit) put(explicit);
  row.members.forEach((member) => {
    put((member.product || "").trim() || explicit || "CUSTID").members.push(member);
  });
  row.bills.forEach((bill) => {
    const category = (bill.product || "").trim();
    if (category) put(category).bills.push(bill);
  });
  const looseBills = row.bills.filter((bill) => !(bill.product || "").trim());
  if (looseBills.length > 0 && (explicit || buckets.size === 1)) {
    const bucket = put(explicit || [...buckets.keys()][0]);
    looseBills.forEach((bill) => {
      if (!bucket.bills.some((item) => item.number === bill.number)) bucket.bills.push(bill);
    });
  }
  if (buckets.size === 0) return [{ ...row, category: canonicalCategory(explicit || "CUSTID") }];
  return [...buckets.entries()].map(([category, bucket], index) => ({
    ...row,
    id: index === 0 ? row.id : `${row.id}:${category}`,
    category,
    members: bucket.members,
    bills: bucket.bills,
    history: index === 0 ? row.history : [],
  }));
}

function adoptGroups(rows: Array<Partial<Group> & { members?: Member[]; bills?: GroupBill[] }>) {
  return rows.flatMap((row) => expandGroup(normalizeGroup(row)));
}

function sameCollectorCategory(group: Group, category: string) {
  return sameCategory(group.category, category);
}

function findBill(bills: GroupBill[], member: Member, peers: Member[]) {
  const exact = bills.find((bill) => bill.number === member.number && sameCategory(bill.product, member.product || "") && Boolean((bill.product || "").trim() || (member.product || "").trim()));
  if (exact) return exact;
  const siblings = peers.filter((item) => item.number === member.number);
  if (siblings.length !== 1) return undefined;
  return bills.find((bill) => bill.number === member.number && !(bill.product || "").trim());
}

function quoteSettled(bill: GroupBill | undefined) {
  if (!bill) return false;
  if (bill.status === "LUNAS" || bill.status === "LAINNYA") return true;
  return Boolean(bill.providerRef) && bill.total >= 1000;
}

function buildBills(group: Group): GroupBill[] {
  return group.members.map((member) => {
    const existing = findBill(group.bills, member, group.members);
    const name = storedName(existing?.name || member.name || "");
    if (existing && quoteSettled(existing)) {
      return { ...existing, name, product: member.product || existing.product };
    }
    return { number: member.number, name, product: member.product || "", period: "Memuat", total: 0, status: "BL LNS" as const };
  });
}

function withBills(group: Group) {
  return { ...group, bills: buildBills(group) };
}

function mergeMembers(current: Member[], incoming: Member[]) {
  const merged = current.map((member) => ({ ...member }));
  incoming.forEach((member) => {
    const index = merged.findIndex((item) => item.number === member.number && sameCategory(item.product, member.product || ""));
    if (index >= 0) {
      merged[index] = { ...merged[index], name: member.name || merged[index].name, product: member.product || merged[index].product };
      return;
    }
    const blank = canonicalCategory(member.product) !== "CUSTID"
      ? merged.findIndex((item) => item.number === member.number && !(item.product || "").trim())
      : -1;
    if (blank >= 0) {
      merged[blank] = { ...merged[blank], name: member.name || merged[blank].name, product: member.product };
      return;
    }
    merged.push(member);
  });
  return merged;
}

function splitLoose(line: string) {
  const clean = line.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];
  const delimiter = clean.includes(";") ? ";" : clean.includes("\t") ? "\t" : clean.includes("|") ? "|" : clean.includes(",") ? "," : "";
  if (!delimiter) {
    const match = clean.match(/^(\S+)\s+(.+)$/);
    return match ? [match[1], match[2].trim()] : [clean];
  }
  return clean.split(delimiter).map((part) => part.trim().replace(/^["']|["']$/g, ""));
}

function rowsFromText(text: string) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => splitLoose(line)).filter((row) => row.some((cell) => cell.trim()));
}

function headerColumn(header: string[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const index = header.findIndex((cell) => pattern.test(cell.trim().toLowerCase()));
    if (index >= 0) return index;
  }
  return -1;
}

function membersFromTable(rows: string[][], fallbackProduct: string): Member[] {
  const table = rows.map((row) => row.map((cell) => cleanCell(cell)));
  let headerAt = -1;
  for (let index = 0; index < Math.min(table.length, 8); index += 1) {
    const cells = table[index];
    const hasLabel = cells.some((cell) => /idpel|id pelanggan|^id\b|nomor|^no\b|nama|produk|product/i.test(cell));
    const hasId = cells.some((cell) => isCustomerId(cell));
    if (hasLabel && !hasId) {
      headerAt = index;
      break;
    }
  }
  const header = headerAt >= 0 ? table[headerAt] : [];
  const sample = table.find((row, index) => index !== headerAt && row.some((cell) => isCustomerId(cell))) ?? [];
  const guessedId = Math.max(0, sample.findIndex((cell) => isCustomerId(cell)));
  const pick = (found: number, fallback: number) => found >= 0 ? found : fallback;
  const idCol = pick(headerAt >= 0 ? headerColumn(header, [/idpel/i, /id pelanggan/i, /^id\b/i, /nomor/i, /\bid\b/i, /^no\b/i]) : guessedId, guessedId);
  const nameCol = pick(headerAt >= 0 ? headerColumn(header, [/nama|name/i]) : guessedId + 1, idCol + 1);
  const productCol = pick(headerAt >= 0 ? headerColumn(header, [/produk|product|biller|kategori/i]) : guessedId + 2, idCol + 2);
  return table.filter((_, index) => index !== headerAt).map((row) => ({
    number: normalizeId(row[idCol] ?? ""),
    name: storedName(row[nameCol] ?? ""),
    product: (row[productCol] ?? "").trim() || fallbackProduct,
  })).filter((row) => isCustomerId(row.number));
}

function sheetRows(book: XLSX.WorkBook) {
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: "" });
    const table = rows.map((row) => (Array.isArray(row) ? row : []).map((cell) => cleanCell(cell)));
    if (table.some((row) => row.some(Boolean))) return table;
  }
  return [];
}

export function LoketKolektifPage() {
  const { profile } = useAuth();
  const { tick, requestRefresh, loketCode } = useLoketRefresh();
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeId, setActiveId] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(String(new Date().getMonth() + 1));
  const [historyYear, setHistoryYear] = useState(String(new Date().getFullYear()));
  const [historyApplied, setHistoryApplied] = useState({ month: String(new Date().getMonth() + 1), year: String(new Date().getFullYear()) });
  const [historyQuery, setHistoryQuery] = useState("");
  const [historySales, setHistorySales] = useState<Sale[]>([]);
  const [historyPicked, setHistoryPicked] = useState<string[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filter, setFilter] = useState<"semua" | "BL LNS" | "LUNAS" | "LAINNYA">("semua");
  const [productFilter, setProductFilter] = useState<string>("semua");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [sessionOmit, setSessionOmit] = useState<string[]>([]);
  const [collectorName, setCollectorName] = useState("");
  const [biller, setBiller] = useState("PLN");
  const [plnAdmin, setPlnAdmin] = useState(loadPlnAdmin);
  const [detailProduct, setDetailProduct] = useState("Postpaid");
  const [custNo, setCustNo] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"error" | "ok">("error");
  const [paying, setPaying] = useState(false);
  const payingLock = useRef(false);
  const loketName = profile?.full_name || profile?.username || "Loket";
  const userId = profile?.id ?? "";
  const fileRef = useRef<HTMLInputElement>(null);
  const groupsRef = useRef<Group[]>([]);
  const activeIdRef = useRef("");
  const productFilterRef = useRef("semua");
  const billerRef = useRef("PLN");
  const manageOpenRef = useRef(false);
  const revision = useRef(0);
  const custNoRef = useRef<HTMLInputElement>(null);
  const removedIds = useRef<string[]>([]);
  groupsRef.current = groups;
  activeIdRef.current = activeId;
  productFilterRef.current = productFilter;
  billerRef.current = biller;
  manageOpenRef.current = manageOpen;

  const tell = (text: string, tone: "error" | "ok" = "error") => {
    setNoticeTone(tone);
    setNotice(text);
  };

  const groupsFromSession = async () => {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id ?? "";
    const raw = data.user?.user_metadata?.collectives as Array<Group & { ownerId?: string }> | undefined;
    if (!uid || !Array.isArray(raw)) return null;
    return adoptGroups(raw.filter((row) => !row?.ownerId || row.ownerId === uid));
  };

  const applyGroups = (rows: Group[]) => {
    const ready = adoptGroups(rows);
    groupsRef.current = ready;
    setGroups(ready);
    setActiveId((current) => {
      const filter = manageOpenRef.current ? billerRef.current : productFilterRef.current;
      const pool = filter === "semua" ? ready : ready.filter((group) => sameCollectorCategory(group, filter));
      if (current && pool.some((group) => group.id === current)) return current;
      return "";
    });
    setSessionOmit([]);
    setNotice("");
  };

  const mirrorAccount = (rows: Group[]) => supabase.auth.updateUser({
    data: { collectives: rows.map((row) => ({ ...row, ownerId: userId })) },
  }).then(() => undefined, () => undefined);

  const load = async () => {
    const revAtStart = revision.current;
    let parsed: Awaited<ReturnType<typeof readApi>> = { ok: false, json: false, body: { error: HOSTING_KOLEKTIF } };
    try {
      const response = await apiFetch("/api/kolektif", { headers: await authHeader() });
      parsed = await readApi(response);
    } catch {
      parsed = { ok: false, json: false, body: { error: HOSTING_KOLEKTIF } };
    }
    if (revision.current !== revAtStart) return;
    const cached = readCollectiveCache(userId);
    if (cached?.dirty) {
      applyGroups(cached.rows);
      return;
    }
    if (parsed.ok && parsed.json && Array.isArray(parsed.body.rows)) {
      const plain = parsed.body.rows.map((row) => normalizeGroup(row));
      const remote = plain.flatMap((row) => expandGroup(row));
      const migrated = remote.length !== plain.length || remote.some((group, index) => group.id !== plain[index]?.id || canonicalCategory(group.category) !== canonicalCategory(plain[index]?.category || ""));
      if (migrated) {
        commitLocal(remote);
        return;
      }
      applyGroups(remote);
      writeCollectiveCache(userId, remote, false);
      return;
    }
    if (groupsRef.current.length > 0) return;
    if (cached?.rows.length) {
      applyGroups(cached.rows);
      return;
    }
    const own = await groupsFromSession();
    if (revision.current !== revAtStart) return;
    if (own?.length) {
      applyGroups(own);
      writeCollectiveCache(userId, own, false);
      return;
    }
    tell(parsed.body.error || "Daftar kolektif gagal dimuat.");
  };
  useEffect(() => { void load(); }, [tick, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sync = () => setPlnAdmin(loadPlnAdmin());
    window.addEventListener(ADMIN_BANK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ADMIN_BANK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    if (productFilter === "semua") return;
    const group = groups.find((item) => item.id === activeId);
    if (activeId && (!group || !sameCollectorCategory(group, productFilter))) {
      setActiveId("");
      setPicked([]);
      setSessionOmit([]);
    }
  }, [activeId, groups, productFilter]);
  const selectedGroup = groups.find((group) => group.id === activeId) ?? null;
  const active = selectedGroup && (productFilter === "semua" || sameCollectorCategory(selectedGroup, productFilter)) ? selectedGroup : null;
  const modalActive = selectedGroup && sameCollectorCategory(selectedGroup, biller) ? selectedGroup : null;
  const activeLabel = active?.collector || active?.name || "";
  const modalLabel = modalActive?.collector || modalActive?.name || "";
  const sidebarGroups = groups.filter((group) => productFilter === "semua" || sameCollectorCategory(group, productFilter));
  const modalGroups = groups.filter((group) => sameCollectorCategory(group, biller));
  const modalMembers = modalActive?.members ?? [];
  const omitted = new Set(sessionOmit);
  const scopedMembers = (active?.members ?? []).filter((member) => productFilter === "semua" || sameCategory(member.product, productFilter));
  const tableRows: GroupBill[] = scopedMembers.filter((member) => !omitted.has(memberKey(member))).map((member) => {
    const bill = active ? findBill(active.bills, member, active.members) : undefined;
    const shown = bill
      ? { ...bill, name: storedName(member.name) || storedName(bill.name), product: member.product || bill.product }
      : { number: member.number, name: storedName(member.name), product: member.product || "", period: "Memuat", total: 0, status: "BL LNS" as const };
    if (!quoteSettled(shown)) return { ...shown, period: "Memuat", total: 0, status: "BL LNS" as const, providerRef: "", note: "" };
    return shown;
  });
  const bills = tableRows.map((row) => applyDeskAdmin(row, plnAdmin));
  const counts = {
    semua: bills.length,
    "BL LNS": bills.filter((row) => row.status === "BL LNS").length,
    LUNAS: bills.filter((row) => row.status === "LUNAS").length,
    LAINNYA: bills.filter((row) => row.status === "LAINNYA").length,
  };
  const visible = bills.filter((row) => {
    if (filter !== "semua" && row.status !== filter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return row.number.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
  });
  const payable = (picked.length ? bills.filter((row) => picked.includes(memberKey(row))) : bills)
    .filter((row) => row.status !== "LUNAS" && row.total >= 1000);
  const listTotal = bills.filter((row) => row.status !== "LUNAS").reduce((sum, row) => sum + row.total, 0);
  const pendingKey = bills.filter((row) => row.period === "Memuat").map((row) => memberKey(row)).join("|");
  useEffect(() => {
    if (!active || !pendingKey) return;
    const groupId = active.id;
    const slice = bills.filter((row) => row.period === "Memuat").slice(0, 40);
    let cancel = false;
    tell(`Mengecek ${slice.length} ID pelanggan ke server...`, "ok");
    void (async () => {
      let response: Response;
      try {
        response = await apiFetch("/api/biller/inquiry-batch", {
          method: "POST",
          headers: await authHeader(),
          body: JSON.stringify({ items: slice.map((row) => {
            const menu = resolveCollectiveProduct(row.product || "", row.product || "") || resolveCollectiveProduct(canonicalCategory(row.product), row.product || "");
            return { key: memberKey(row), category: menu?.category || canonicalCategory(row.product), product: menu?.product || row.product || "", customerNumber: row.number, adminFee: adminForProduct(menu?.category || row.product || "", menu?.product || row.product || "", plnAdmin) };
          }) }),
        }, 90_000);
      } catch {
        if (!cancel) {
          tell("Cek tagihan kolektif tidak terhubung ke server. Saldo tidak berubah.");
          const failed = groupsRef.current.map((group) => group.id === groupId ? { ...group, bills: group.members.map((member) => {
            const previous = findBill(group.bills, member, group.members);
            if (previous && quoteSettled(previous) && !slice.some((row) => memberKey(row) === memberKey(member))) return previous;
            if (!slice.some((row) => memberKey(row) === memberKey(member))) return previous && quoteSettled(previous) ? previous : { number: member.number, name: storedName(member.name), product: member.product || "", period: "Memuat", total: 0, status: "BL LNS" as const };
            return { number: member.number, name: storedName(member.name), product: member.product || "", period: "-", total: 0, status: "LAINNYA" as const, note: "Cek tagihan tidak mendapat jawaban. Coba lagi beberapa saat." };
          }) } : group);
          commitLocal(failed);
        }
        return;
      }
      const body = await response.json().catch(() => ({} as { error?: string; results?: unknown[] }));
      if (cancel) return;
      if (!response.ok) {
        tell(body.error || "Cek tagihan kolektif gagal.");
        const failed = groupsRef.current.map((group) => group.id === groupId ? { ...group, bills: group.members.map((member) => slice.some((row) => memberKey(row) === memberKey(member)) ? { number: member.number, name: storedName(member.name), product: member.product || "", period: "-", total: 0, status: "LAINNYA" as const, note: body.error || "Cek tagihan gagal." } : (findBill(group.bills, member, group.members) ?? { number: member.number, name: storedName(member.name), product: member.product || "", period: "Memuat", total: 0, status: "BL LNS" as const })) } : group);
        commitLocal(failed);
        return;
      }
      const results = Array.isArray(body.results) ? body.results as Array<Record<string, unknown>> : [];
      const byKey = new Map(results.map((item) => [String(item.key || ""), item]));
      const current = groupsRef.current.find((group) => group.id === groupId);
      if (!current) return;
      const checked = new Map(slice.map((row) => [memberKey(row), row]));
      const billsNext = current.members.map((member) => {
        const key = memberKey(member);
        const previous = findBill(current.bills, member, current.members);
        if (!checked.has(key)) return previous && quoteSettled(previous) ? previous : { number: member.number, name: storedName(member.name), product: member.product || "", period: "Memuat", total: 0, status: "BL LNS" as const };
        const hit = byKey.get(key);
        const quote = hit?.bill && typeof hit.bill === "object" ? hit.bill as Record<string, unknown> : {};
        const inquired = storedName(String(quote.customerName || ""));
        const statusText = String(hit?.statusText || "failed");
        const providerRef = String(hit?.providerRef || "");
        const total = Number(quote.total) || 0;
        const incomingNote = String(hit?.message || "");
        const paid = statusText === "paid" ? (paidNotice(incomingNote) || "[0088] TAGIHAN SUDAH TERBAYAR") : paidNotice(incomingNote);
        let status = paid ? "LUNAS" as const : statusText === "found" ? "BL LNS" as const : "LAINNYA" as const;
        if (status === "BL LNS" && total < 1000) status = "LAINNYA";
        const note = paid || incomingNote || (statusText === "not_found" ? "Tidak ada tagihan." : status === "LAINNYA" ? "Jawaban untuk ID ini tidak kembali." : "");
        return {
          number: member.number,
          name: preferShownName(inquired, member.name),
          product: member.product || "",
          period: String(quote.period || (status === "BL LNS" ? "Tagihan" : "-")),
          stand: String(quote.stand || ""),
          total,
          status,
          note: status === "BL LNS" ? "" : note,
          sku: String(hit?.buyerSkuCode || ""),
          providerRef,
          menuCategory: String(hit?.category || ""),
          menuProduct: String(hit?.product || ""),
          tagihan: Number(quote.amount) || 0,
          denda: Number(quote.denda) || 0,
          adminFee: Number(quote.adminFee) || 0,
          providerCost: Number(quote.providerCost) || 0,
        };
      });
      const members = current.members.map((member) => {
        const bill = billsNext.find((item) => memberKey(item) === memberKey(member));
        return bill?.name ? { ...member, name: bill.name } : member;
      });
      if (cancel) return;
      const answered = billsNext.filter((item) => checked.has(memberKey(item)));
      const readable = answered.filter((item) => item.status === "BL LNS").length;
      const settled = answered.filter((item) => item.status === "LUNAS").length;
      const review = answered.filter((item) => item.status === "LAINNYA").length;
      tell(`${readable} tagihan terbaca, ${settled} sudah lunas, ${review} perlu diperiksa.`, review > 0 && readable === 0 && settled === 0 ? "error" : "ok");
      commitLocal(groupsRef.current.map((group) => group.id === groupId ? { ...group, members, bills: billsNext } : group));
    })();
    return () => { cancel = true; };
  }, [active?.id, pendingKey]);
  const nextBatch = payable.slice(0, 10);
  const nextBatchTotal = nextBatch.reduce((sum, row) => sum + row.total, 0);
  const remainder = payable.slice(10);
  const remainderTotal = remainder.reduce((sum, row) => sum + row.total, 0);

  const publish = async (rows: Group[], rev: number) => {
    const keepLocal = async () => {
      if (revision.current !== rev) return;
      await mirrorAccount(groupsRef.current);
    };
    try {
      const listed = await readApi(await apiFetch("/api/kolektif", { headers: await authHeader() }));
      if (revision.current !== rev) return;
      if (!listed.json || !listed.ok || !Array.isArray(listed.body.rows)) {
        await keepLocal();
        return;
      }
      for (const id of removedIds.current) {
        const removed = await readApi(await apiFetch("/api/kolektif", { method: "POST", headers: await authHeader(), body: JSON.stringify({ id, action: "delete" }) }));
        if (revision.current !== rev) return;
        if (!removed.json) {
          await keepLocal();
          return;
        }
        if (!removed.ok && !String(removed.body.error || "").includes("tidak ditemukan")) {
          await keepLocal();
          return;
        }
      }
      let latest = rows;
      let changed = false;
      for (const group of rows) {
        const saved = await readApi(await apiFetch("/api/kolektif", {
          method: "POST",
          headers: await authHeader(),
          body: JSON.stringify({ id: group.id, name: group.name, collector: group.collector, category: group.category, members: group.members }),
        }));
        if (revision.current !== rev) return;
        if (!saved.json || !saved.ok) {
          await keepLocal();
          return;
        }
        const savedId = String(saved.body.row?.id ?? group.id);
        if (savedId !== group.id) {
          changed = true;
          latest = latest.map((item) => item.id === group.id ? { ...item, id: savedId } : item);
          if (activeIdRef.current === group.id) setActiveId(savedId);
        }
        const current = latest.find((item) => item.id === savedId);
        if (current?.bills.length) {
          await apiFetch("/api/kolektif/bills", { method: "POST", headers: await authHeader(), body: JSON.stringify({ id: savedId, bills: current.bills }) }).catch(() => undefined);
        }
      }
      if (revision.current !== rev) return;
      if (changed) {
        groupsRef.current = latest;
        setGroups(latest);
      }
      removedIds.current = [];
      writeCollectiveCache(userId, latest, false);
      await mirrorAccount(latest);
    } catch {
      await keepLocal();
    }
  };

  const commitLocal = (rows: Group[], message?: string, nextActive?: string) => {
    revision.current += 1;
    const rev = revision.current;
    const ready = rows.map((row) => withBills(row));
    groupsRef.current = ready;
    setGroups(ready);
    if (nextActive !== undefined) setActiveId(nextActive);
    writeCollectiveCache(userId, ready, true);
    if (message) tell(message, "ok");
    void publish(ready, rev);
  };

  const storeMembers = (incoming: Member[], seedName: string) => {
    if (incoming.length === 0) {
      tell("Tidak ada pelanggan yang terbaca. Gunakan ID dan nama, satu pelanggan tiap baris.");
      return;
    }
    const current = groupsRef.current;
    const categoryLabel = canonicalCategory(incoming[0]?.product || biller);
    const selected = current.find((group) => group.id === activeIdRef.current) ?? null;
    const sameName = (group: Group, name: string) => (group.collector || group.name).trim().toLowerCase() === name.trim().toLowerCase();
    const target = selected && sameCollectorCategory(selected, categoryLabel)
      ? selected
      : current.find((group) => selected && sameName(group, selected.collector || selected.name) && sameCollectorCategory(group, categoryLabel)) ?? null;
    if (target) {
      const members = mergeMembers(target.members, incoming);
      const next = current.map((group) => group.id === target.id ? { ...group, category: categoryLabel, members } : group);
      setProductFilter(categoryLabel);
      commitLocal(next, `${incoming.length} pelanggan ${categoryLabel} masuk ke daftar.`, target.id);
      return;
    }
    const name = selected ? (selected.collector || selected.name) : (collectorName.trim() || seedName || "Kolektor");
    const row: Group = { id: crypto.randomUUID(), name, collector: name, category: categoryLabel, members: mergeMembers([], incoming), bills: [], history: [] };
    setCollectorName("");
    setProductFilter(categoryLabel);
    commitLocal([row, ...current], `${incoming.length} pelanggan ${categoryLabel} masuk ke ${name}.`, row.id);
  };

  const importFile = async (file: File) => {
    const category = biller;
    const chosen = selectedProduct();
    if (manageOpen) setProductFilter(category);
    const stamp = (rows: Member[]) => rows.map((row) => {
      const fromFile = (row.product || "").trim();
      const resolved = fromFile ? resolveCollectiveProduct(fromFile, fromFile) : null;
      return { ...row, product: resolved?.product || chosen || fromFile || category };
    });
    const lower = file.name.toLowerCase();
    const seed = file.name.replace(/\.[^.]+$/, "") || "Kolektor";
    const fromText = async () => stamp(membersFromTable(rowsFromText(await file.text()), category));
    if (lower.endsWith(".txt") || lower.endsWith(".csv")) {
      const parsed = await fromText();
      if (parsed.length > 0 || lower.endsWith(".txt")) {
        storeMembers(parsed, seed);
        return;
      }
    }
    let members: Member[] = [];
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      members = stamp(membersFromTable(sheetRows(book), category));
    } catch {
      members = [];
    }
    if (members.length === 0) members = await fromText();
    storeMembers(members, seed);
  };

  const payBatch = async () => {
    if (!active || payable.length === 0 || paying || payingLock.current) return;
    payingLock.current = true;
    setPaying(true);
    setNotice("");
    try {
    const next = active.bills.map((row) => ({ ...row }));
    const queue = [...payable];
    const slips: { id: string; name: string; product: string; period: string; tagihan: number; admin: number; total: number; sn: string; at: string }[] = [];
    let stopped = "";
    while (queue.length > 0) {
      const chunk = queue.splice(0, 10);
      let paidCount = 0;
      let paidTotal = 0;
      for (const row of chunk) {
        const ref = row.providerRef && /^[A-Za-z0-9._:-]{6,80}$/.test(row.providerRef)
          ? row.providerRef
          : `kolektif${active.id.replace(/-/g, "").slice(0, 16)}${row.number.replace(/\W/g, "").slice(-12)}`.slice(0, 80);
        let response: Response;
        try {
          response = await apiFetch("/api/loket-sales", {
            method: "POST",
            headers: await authHeader(),
            body: JSON.stringify({
              channel: "digiflazz",
              clientRef: ref,
              providerRef: row.providerRef || ref,
              buyerSkuCode: row.sku,
              category: row.menuCategory || canonicalCategory(row.product),
              product: row.menuProduct || row.product || canonicalCategory(row.product),
              customerNumber: row.number,
              customerName: storedName(row.name),
              amount: row.total,
              tagihan: row.tagihan || row.total,
              denda: row.denda || 0,
              adminFee: row.adminFee || 0,
              providerCost: row.providerCost || 0,
              period: row.period,
              loketName,
            }),
          }, 55_000);
        } catch {
          stopped = "Pembayaran kolektif belum mendapat jawaban tepat waktu. Cek status sebelum mengulang. Saldo hanya terpotong bila Sukses.";
          break;
        }
        const parsed = await readApi(response);
        const sale = (parsed.body as { sale?: Sale }).sale;
        const statusText = String((parsed.body as { statusText?: string }).statusText || sale?.status || "");
        if (!parsed.ok || (statusText !== "success" && statusText !== "simulated")) {
          stopped = parsed.body.error || (statusText === "pending"
            ? "Pembayaran masih diproses. Cek status sebelum mengulang. Saldo hanya terpotong bila Sukses."
            : "Pembayaran kolektif gagal. Saldo tidak berubah.");
          break;
        }
        const numbered = next.filter((item) => item.number === row.number);
        const target = numbered.find((item) => sameCategory(item.product, row.product || ""))
          ?? (numbered.length === 1 && !(numbered[0].product || "").trim() ? numbered[0] : undefined);
        if (target) {
          target.status = "LUNAS";
          target.total = row.total;
          target.adminFee = row.adminFee || 0;
          target.tagihan = row.tagihan || target.tagihan || 0;
          target.note = "";
          if (!(target.product || "").trim()) target.product = row.product || "";
        }
        slips.push({
          id: sale?.customerNumber || row.number,
          name: storedName(sale?.customerName || row.name) || shownCustomer(row.name),
          product: sale?.product || row.menuProduct || row.product || "",
          period: sale?.period || row.period,
          tagihan: Number(sale?.tagihan) || row.tagihan || row.total,
          admin: Number(sale?.adminFee) || row.adminFee || 0,
          total: Number(sale?.amount) || row.total,
          sn: sale?.sn || "",
          at: formatWaktu(sale?.createdAt || new Date().toISOString()),
        });
        paidCount += 1;
        paidTotal += row.total;
      }
      if (paidCount > 0) {
        const updated = groupsRef.current.map((group) => group.id === active.id ? { ...group, bills: next.map((bill) => ({ ...bill })) } : group);
        groupsRef.current = updated;
        setGroups(updated);
        writeCollectiveCache(userId, updated, true);
        await apiFetch("/api/kolektif/bills", { method: "POST", headers: await authHeader(), body: JSON.stringify({ id: active.id, bills: next, paid: true, paidCount, paidTotal }) }).catch(() => undefined);
      }
      if (stopped) break;
    }
    if (slips.length > 0) {
      const opened = printReceipts(loadPrinterSettings(loketCode), slips, identityLine(loketCode, loketName));
      if (!opened) tell("Struk belum terbuka. Cetak ulang dari riwayat kolektif.");
    }
    await apiFetch("/api/biller/sync", { method: "POST", headers: await authHeader(), body: "{}" }, 30_000).catch(() => undefined);
    if (stopped) tell(stopped);
    setConfirmOpen(false);
    setPicked([]);
    requestRefresh();
    await load();
    } catch {
      tell("Pembayaran kolektif terputus. Cek status sebelum mengulang.");
    } finally {
      payingLock.current = false;
      setPaying(false);
    }
  };

  const productChoices = collectiveProductChoices(biller);
  const productChoiceKey = productChoices.join("|");
  useEffect(() => {
    setDetailProduct((current) => {
      if (productChoices.includes(current)) return current;
      if (biller === "PDAM" || biller === "TELCO" || biller === "INTERNET & TV") return "";
      return productChoices[0] || "";
    });
  }, [biller, productChoiceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedProduct = () => {
    if (productChoices.length === 0) return biller;
    if (productChoices.includes(detailProduct)) return detailProduct;
    if (biller === "PDAM" || biller === "TELCO" || biller === "INTERNET & TV") return "";
    return productChoices[0] || biller;
  };

  const applyProduct = () => {
    const product = selectedProduct();
    if (!product) {
      tell(biller === "PDAM" ? "Pilih wilayah PDAM terlebih dahulu." : "Pilih produk terlebih dahulu.");
      return;
    }
    const group = groupsRef.current.find((item) => item.id === activeIdRef.current && sameCollectorCategory(item, biller));
    if (!group) {
      tell(`Pilih kolektor ${biller} terlebih dahulu.`);
      return;
    }
    let changed = 0;
    const members = group.members.map((member) => {
      if (canonicalCategory(member.product || biller) !== canonicalCategory(biller)) return member;
      const bare = (KOLEKTIF_CATEGORIES as readonly string[]).includes((member.product || "").trim().toUpperCase());
      if (!bare && resolveCollectiveProduct(member.product || "", member.product || "")) return member;
      changed += 1;
      return { ...member, product };
    });
    if (changed === 0) {
      tell("Semua pelanggan pada kategori ini sudah punya produk.", "ok");
      return;
    }
    const bills = group.bills.map((bill) => {
      if (bill.status === "LUNAS") return bill;
      const bare = (KOLEKTIF_CATEGORIES as readonly string[]).includes((bill.product || "").trim().toUpperCase());
      if (!bare && resolveCollectiveProduct(bill.product || "", bill.product || "")) return bill;
      return { ...bill, product, period: "Memuat", total: 0, status: "BL LNS" as const, providerRef: "", sku: "", note: "" };
    });
    commitLocal(groupsRef.current.map((item) => item.id === group.id ? { ...item, members, bills } : item), `${changed} pelanggan memakai ${product}. Tagihan dicek ulang.`, group.id);
  };

  const recheckBills = () => {
    if (!active || paying) return;
    const next = groupsRef.current.map((group) => group.id !== active.id ? group : {
      ...group,
      bills: group.bills.map((bill) => bill.status === "LUNAS" ? bill : { ...bill, period: "Memuat", total: 0, status: "BL LNS" as const, providerRef: "", sku: "", note: "" }),
    });
    commitLocal(next, "Tagihan dicek ulang ke server.", active.id);
  };

  const addCollector = () => {
    const name = collectorName.trim();
    if (!name) return;
    const category = canonicalCategory(biller);
    const existing = groupsRef.current.find((group) => (group.collector || group.name).trim().toLowerCase() === name.toLowerCase() && sameCollectorCategory(group, category));
    setProductFilter(category);
    if (existing) {
      setActiveId(existing.id);
      setCollectorName("");
      tell(`Kolektor ${existing.collector || existing.name} dipilih untuk ${category}.`, "ok");
      requestAnimationFrame(() => custNoRef.current?.focus());
      return;
    }
    const row: Group = { id: crypto.randomUUID(), name, collector: name, category, members: [], bills: [], history: [] };
    setCollectorName("");
    commitLocal([row, ...groupsRef.current], `Kolektor ${name} ditambahkan untuk ${category}.`, row.id);
    requestAnimationFrame(() => custNoRef.current?.focus());
  };

  const addCustomer = () => {
    const number = normalizeId(custNo);
    const group = groupsRef.current.find((item) => item.id === activeIdRef.current && sameCollectorCategory(item, biller));
    if (!group) {
      tell(`Tambah kolektor ${biller} terlebih dahulu, lalu masukkan pelanggan.`);
      return;
    }
    if (!isCustomerId(number)) {
      tell("ID pelanggan minimal 5 karakter.");
      custNoRef.current?.focus();
      return;
    }
    if (group.members.some((member) => member.number === number && sameCategory(member.product, biller))) {
      tell(`ID ${number} sudah ada di daftar ${biller}. Tidak ditambahkan lagi.`);
      custNoRef.current?.focus();
      return;
    }
    const product = selectedProduct();
    if (!product) {
      tell(biller === "PDAM" ? "Pilih wilayah PDAM terlebih dahulu." : "Pilih produk terlebih dahulu.");
      return;
    }
    const members = mergeMembers(group.members, [{ number, name: "", product }]);
    const next = groupsRef.current.map((item) => item.id === group.id ? { ...item, category: canonicalCategory(product), members } : item);
    setCustNo("");
    setProductFilter(canonicalCategory(product));
    commitLocal(next, `${number} masuk ke ${group.collector || group.name} sebagai ${product}.`, group.id);
    requestAnimationFrame(() => custNoRef.current?.focus());
  };

  const removeGroup = (id: string) => {
    removedIds.current = [...removedIds.current, id];
    const removed = groupsRef.current.find((group) => group.id === id);
    const next = groupsRef.current.filter((group) => group.id !== id);
    const nextActive = activeIdRef.current === id ? "" : activeIdRef.current;
    commitLocal(next, removed ? `Kolektor ${removed.collector || removed.name} pada ${removed.category} dihapus.` : "Kolektor dihapus.", nextActive);
  };

  const exportCustomers = () => {
    const source = groupsRef.current.find((group) => group.id === activeIdRef.current && sameCollectorCategory(group, biller)) ?? null;
    const rows = (source?.members ?? []).filter((member) => sameCategory(member.product, biller));
    if (!source || rows.length === 0) {
      tell(source ? `Belum ada data pelanggan ${biller} untuk kolektor ini.` : `Pilih kolektor ${biller} terlebih dahulu.`);
      return;
    }
    const sheet = XLSX.utils.aoa_to_sheet([
      ["ID Pelanggan", "Nama Pelanggan", "Produk"],
      ...rows.map((member) => [member.number, member.name, member.product || canonicalCategory(member.product)]),
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Pelanggan");
    const safeName = (source.collector || source.name || "kolektif").replace(/[\\/:*?"<>|]/g, "-");
    XLSX.writeFile(book, `${safeName}-${biller}.xlsx`);
  };

  const removeCustomer = (number: string, product?: string) => {
    const group = groupsRef.current.find((item) => item.id === activeIdRef.current);
    if (!group) return;
    const key = memberKey({ number, product });
    const members = group.members.filter((member) => memberKey(member) !== key);
    const next = groupsRef.current.map((item) => item.id === group.id ? { ...item, members, bills: item.bills.filter((bill) => memberKey(bill) !== key) } : item);
    setPicked((rows) => rows.filter((item) => item !== key));
    setSessionOmit((rows) => rows.filter((item) => item !== key));
    commitLocal(next, "Pelanggan dihapus.", group.id);
  };

  const releaseCustomer = (key: string) => {
    setSessionOmit((rows) => rows.includes(key) ? rows : [...rows, key]);
    setPicked((rows) => rows.filter((item) => item !== key));
    tell("Pelanggan dikeluarkan dari daftar transaksi ini.", "ok");
  };

  useEffect(() => {
    if (!historyOpen) return;
    let stop = false;
    (async () => {
      const response = await apiFetch("/api/loket-sales", { headers: await authHeader() });
      const body = response.ok ? await response.json() : { sales: [], simulations: [] };
      if (!stop) setHistorySales((body.sales ?? []) as Sale[]);
    })();
    return () => { stop = true; };
  }, [historyOpen, tick]);

  const historyRows = useMemo(() => {
    if (!active) return [];
    const members = new Set(active.members.filter((member) => productFilter === "semua" || sameCategory(member.product, productFilter)).map((member) => member.number));
    const needle = historyQuery.trim().toLowerCase();
    return historySales.filter((sale) => {
      if (!isProductionSuccess(sale.status)) return false;
      const inGroup = members.has(sale.customerNumber);
      if (!inGroup) return false;
      if (productFilter !== "semua" && canonicalCategory(sale.product) !== canonicalCategory(productFilter) && canonicalCategory(sale.category) !== canonicalCategory(productFilter)) return false;
      const date = new Date(sale.createdAt);
      if (date.getMonth() + 1 !== Number(historyApplied.month) || date.getFullYear() !== Number(historyApplied.year)) return false;
      if (!needle) return true;
      return sale.customerNumber.toLowerCase().includes(needle) || sale.customerName.toLowerCase().includes(needle);
    });
  }, [active, historySales, historyApplied, historyQuery, productFilter]);
  const historyPageCount = Math.max(1, Math.ceil(historyRows.length / 8));
  const historySlice = historyRows.slice((historyPage - 1) * 8, historyPage * 8);
  const historySelected = historyRows.filter((sale) => historyPicked.includes(sale.id));
  const historySelectedTotal = historySelected.reduce((sum, sale) => sum + Number(sale.amount), 0);
  const historyPageIds = historySlice.map((sale) => sale.id);
  const historyPageChecked = historyPageIds.length > 0 && historyPageIds.every((id) => historyPicked.includes(id));

  const printHistory = () => {
    if (!active || historySelected.length === 0) return;
    const period = new Date(Number(historyApplied.year), Number(historyApplied.month) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    printReceipts(loadPrinterSettings(loketCode), historySelected.map((sale) => ({
      id: sale.customerNumber,
      name: sale.customerName,
      product: sale.product,
      period,
      tagihan: Number(sale.tagihan) || Math.max(0, Number(sale.amount) - Number(sale.adminFee ?? 0) - Number(sale.denda ?? 0)),
      admin: Number(sale.adminFee ?? 0),
      total: Number(sale.amount),
      sn: sale.sn || "",
      at: formatWaktu(sale.createdAt),
    })), identityLine(loketCode, loketName));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <div className="grid min-h-0 w-full flex-1 grid-cols-1 gap-1 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-slate-300 bg-white">
        <div className="shrink-0 px-2 py-1 text-[11px] font-bold uppercase text-slate-500">Kolektor</div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5">
          {sidebarGroups.length === 0 && <p className="text-xs text-slate-400">{productFilter === "semua" ? "Belum ada kolektor." : `Belum ada kolektor ${productFilter}.`}</p>}
          {sidebarGroups.map((group) => (
            <button key={group.id} onClick={() => { setActiveId(group.id); setPicked([]); setSessionOmit([]); }} className={`block w-full rounded-md border px-2 py-1 text-left text-xs leading-4 ${activeId === group.id ? "border-amber-600 bg-amber-500 font-semibold text-white shadow-sm ring-2 ring-amber-300" : "border-transparent text-slate-700 hover:bg-slate-50"}`}>
              {group.collector || group.name}
              <div className={`text-[11px] leading-4 ${activeId === group.id ? "text-amber-100" : "text-slate-400"}`}>{group.members.length} pelanggan{productFilter === "semua" && group.category ? ` ${group.category}` : ""}</div>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center px-1.5 py-1">
          <button onClick={() => setManageOpen(true)} className="h-7 w-full rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700">Kelola Kolektif</button>
        </div>
      </aside>
      <section className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-slate-300 bg-white">
        <div className="shrink-0 border-b border-slate-100 px-2 py-1 text-xs font-semibold leading-4 text-slate-900">
          {activeLabel ? `Kelola Pelanggan - ${activeLabel}${productFilter === "semua" ? "" : ` · ${productFilter}`}` : "Kelola Pelanggan"}
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 px-2 py-1">
          {(["semua", ...KOLEKTIF_CATEGORIES] as const).map((key) => (
            <button key={key} type="button" onClick={() => { setProductFilter(key); if (key !== "semua") setBiller(key); setPicked([]); }} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${productFilter === key ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}>{key === "semua" ? "Semua" : key}</button>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-100 px-2 py-1">
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold leading-4 text-slate-700">Impor Excel/CSV</button>
          <button onClick={() => setSheetOpen(true)} disabled={!active || bills.length === 0 || bills.some((row) => row.period === "Memuat")} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold leading-4 text-slate-700 disabled:opacity-40">Preview List</button>
          <button onClick={() => setHistoryOpen(true)} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold leading-4 text-slate-700">Riwayat Pembayaran</button>
          <button type="button" onClick={recheckBills} disabled={!active || paying || bills.some((row) => row.period === "Memuat")} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold leading-4 text-slate-700 disabled:opacity-40">Cek Ulang</button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1">
          {([
            ["semua", `Semua (${counts.semua})`],
            ["BL LNS", `BL LUNAS (${counts["BL LNS"]})`],
            ["LUNAS", `LUNAS (${counts.LUNAS})`],
            ["LAINNYA", `Perlu Diperiksa (${counts.LAINNYA})`],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${filter === key ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}>{label}</button>
          ))}
          <label className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            Admin Bank
            <Select value={String(plnAdmin)} onChange={(event) => { const fee = Number(event.target.value); setPlnAdmin(fee); savePlnAdmin(fee); }} className="h-7 w-[11rem] min-w-[11rem] shrink-0 py-0 text-xs leading-4" style={{ width: "11rem", minWidth: "11rem", paddingLeft: 10, paddingRight: 28, fontSize: 12 }}>
              {ADMIN_FEES.map((fee) => <option key={fee} value={fee}>{formatRupiah(fee)}</option>)}
            </Select>
          </label>
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Cari ID atau nama" className="h-7 w-40 rounded-md border border-slate-200 px-2 text-xs" />
        </div>
        <div className={`h-4 shrink-0 truncate px-2 text-[11px] leading-4 ${noticeTone === "ok" ? "text-emerald-700" : "text-rose-600"}`}>{notice}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-left text-xs leading-4">
            <colgroup>
              <col className="w-8" />
              <col className="w-7" />
              <col className="w-[7.25rem]" />
              <col />
              <col className="w-[6.5rem]" />
              <col className="w-[4.75rem]" />
              <col className="w-[5.25rem]" />
              <col className="w-[9rem]" />
              <col className="w-[13.25rem]" />
              <col className="w-16" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
              <tr>
                <th className="px-1 py-1"><input type="checkbox" checked={visible.length > 0 && visible.every((row) => picked.includes(memberKey(row)))} onChange={(event) => setPicked(event.target.checked ? visible.map((row) => memberKey(row)) : [])} /></th>
                {["No", "ID Pelanggan", "Nama Pelanggan", "Produk", "Periode", "Admin Bank", "Total Bayar", "Status", ""].map((head) => <th key={head || "aksi"} className={`whitespace-nowrap px-1 py-1 font-semibold ${head === "Admin Bank" || head === "Total Bayar" ? "text-right" : ""}`}>{head}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && active && <tr><td colSpan={10} className="px-2 py-4 text-center text-slate-500">{bills.length === 0 ? (productFilter === "semua" ? "Belum ada pelanggan pada kolektor ini." : `Belum ada data pelanggan ${productFilter} untuk kolektor ini.`) : "Tidak ada pelanggan pada filter ini."}</td></tr>}
              {visible.map((row, index) => (
                <tr key={memberKey(row)} className="border-t border-slate-100 text-slate-700">
                  <td className="px-1 py-0.5"><input type="checkbox" checked={picked.includes(memberKey(row))} onChange={(event) => setPicked((rows) => event.target.checked ? [...rows, memberKey(row)] : rows.filter((item) => item !== memberKey(row)))} /></td>
                  <td className="px-1 py-0.5 tabular-nums">{index + 1}</td>
                  <td className="truncate px-1 py-0.5 font-mono" title={row.number}>{row.number}</td>
                  <td className="truncate px-1 py-0.5" title={shownCustomer(row.name)}>{shownCustomer(row.name)}</td>
                  <td className="min-w-[6.5rem] whitespace-nowrap px-1 py-0.5" title={row.menuProduct || row.product || ""}>{row.menuProduct || row.product || canonicalCategory(row.product)}</td>
                  <td className="whitespace-nowrap px-1 py-0.5" title={monthOf(row.period)}>{shortPeriod(row.period)}</td>
                  <td className="whitespace-nowrap px-1 py-0.5 text-right tabular-nums">{row.period === "Memuat" ? "—" : formatRupiah(row.adminFee || 0)}</td>
                  <td className="min-w-[9rem] whitespace-nowrap px-1 py-0.5 text-right font-semibold tabular-nums">{formatRupiah(row.total)}</td>
                  <td className="whitespace-nowrap px-1 py-0.5" title={billStatusLabel(row)}>{billStatusLabel(row)}</td>
                  <td className="px-1 py-0.5 text-right"><button type="button" onClick={() => releaseCustomer(memberKey(row))} className="text-[11px] font-semibold leading-4 text-rose-600">Keluarkan</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 bg-slate-800 px-2 py-1 text-white">
          <div className="min-w-0 truncate text-xs text-slate-200">Total: {bills.length} pelanggan · Total bayar: {formatRupiah(listTotal)}</div>
          <button type="button" onClick={() => nextBatch.length && setConfirmOpen(true)} disabled={nextBatch.length === 0 || paying} className="h-8 shrink-0 whitespace-nowrap rounded-md bg-amber-500 px-3 text-xs font-black text-slate-950 disabled:opacity-40">{paying ? "Memproses" : `Bayar ${nextBatch.length} Lembar`}</button>
        </div>
      </section>
    </div>
      {sheetOpen && active && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-6xl overflow-auto rounded-2xl bg-white p-4 shadow-xl">
            <pre className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-5 text-slate-800">{sheetText({ ...active, bills }, loketCode, loketName)}</pre>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => printSheet(sheetText({ ...active, bills }, loketCode, loketName))}>CETAK</Button>
              <Button variant="outline" onClick={() => setSheetOpen(false)}>Selesai</Button>
            </div>
          </div>
        </div>
      )}
      {historyOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setHistoryOpen(false)}>
          <div className="flex h-[min(720px,85vh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="shrink-0 border-b border-slate-100 px-4 py-3">
              <h2 className="font-semibold text-slate-900">Riwayat Pembayaran {active ? `· ${active.collector || active.name}` : ""}</h2>
              <div className="mt-3 grid grid-cols-[1fr_8rem_auto_1.4fr] items-end gap-2">
                <Select value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)}>
                  {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2026, index, 1).toLocaleDateString("id-ID", { month: "long" })}</option>)}
                </Select>
                <Select value={historyYear} onChange={(event) => setHistoryYear(event.target.value)}>
                  {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((item) => <option key={item}>{item}</option>)}
                </Select>
                <button type="button" onClick={() => { setHistoryApplied({ month: historyMonth, year: historyYear }); setHistoryPage(1); setHistoryPicked([]); }} className="h-10 rounded-lg bg-amber-500 px-4 text-sm font-bold text-white">Tampilkan</button>
                <Input value={historyQuery} onChange={(event) => { setHistoryQuery(event.target.value); setHistoryPage(1); }} placeholder="Cari ID atau nama pelanggan" />
              </div>
            </div>
            <div className="min-h-[320px] flex-1 overflow-auto">
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-8" />
                  <col className="w-10" />
                  <col className="w-32" />
                  <col />
                  <col className="w-28" />
                  <col className="w-36" />
                  <col className="w-28" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
                  <tr>
                    <th className="px-2 py-2"><input type="checkbox" checked={historyPageChecked} onChange={(event) => setHistoryPicked((rows) => event.target.checked ? [...new Set([...rows, ...historyPageIds])] : rows.filter((id) => !historyPageIds.includes(id)))} /></th>
                    {["No", "ID Pelanggan", "Nama Pelanggan", "Produk", "Tanggal", "Nominal"].map((head) => <th key={head} className="px-2 py-2 font-semibold">{head}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {historySlice.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Belum ada pembayaran pada periode ini.</td></tr>}
                  {historySlice.map((sale, index) => (
                    <tr key={sale.id} className="border-t border-slate-100 text-slate-700">
                      <td className="px-3 py-2"><input type="checkbox" checked={historyPicked.includes(sale.id)} onChange={(event) => setHistoryPicked((rows) => event.target.checked ? [...rows, sale.id] : rows.filter((id) => id !== sale.id))} /></td>
                      <td className="px-3 py-2">{(historyPage - 1) * 8 + index + 1}</td>
                      <td className="px-3 py-2 font-mono">{sale.customerNumber}</td>
                      <td className="break-words px-2 py-2">{sale.customerName}</td>
                      <td className="px-3 py-2">{sale.product}</td>
                      <td className="px-3 py-2">{formatWaktu(sale.createdAt)}</td>
                      <td className="px-3 py-2 font-semibold">{formatRupiah(sale.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              <span>Halaman {Math.min(historyPage, historyPageCount)} dari {historyPageCount}</span>
              <div className="flex gap-1">
                {Array.from({ length: historyPageCount }, (_, index) => (
                  <button key={index + 1} onClick={() => setHistoryPage(index + 1)} className={`h-7 min-w-7 rounded-md px-2 font-semibold ${historyPage === index + 1 ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}>{index + 1}</button>
                ))}
              </div>
            </div>
            <div className="sticky bottom-0 flex shrink-0 items-center justify-between gap-2 bg-slate-800 px-4 py-3 text-white">
              <div className="text-sm text-slate-200">{historySelected.length} transaksi dipilih · Total {formatRupiah(historySelectedTotal)}</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setHistoryOpen(false)} className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold">Tutup</button>
                <button type="button" onClick={printHistory} disabled={historySelected.length === 0} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 disabled:opacity-40">Cetak Ulang ({historySelected.length})</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" onKeyDown={(event) => { if (event.key === "Escape" && !paying) setConfirmOpen(false); if (event.key === "Enter" && !paying) { event.preventDefault(); void payBatch(); } }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" tabIndex={-1} ref={(node) => node?.focus()}>
            <h2 className="font-semibold text-slate-900">Pembayaran batch</h2>
            <p className="mt-2 text-sm text-slate-600">Batch ini {nextBatch.length} lembar senilai {formatRupiah(nextBatchTotal)}. Setiap batch paling banyak 10 lembar.</p>
            {remainder.length > 0 && <p className="mt-2 text-sm text-slate-600">Sisa {remainder.length} lembar senilai {formatRupiah(remainderTotal)} dibayar pada batch berikutnya sampai seluruh tagihan selesai.</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => !paying && setConfirmOpen(false)}>Batal</Button>
              <button type="button" onClick={payBatch} disabled={paying} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{paying ? "Memproses" : "Lanjutkan"}</button>
            </div>
          </div>
        </div>
      )}
      {manageOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setManageOpen(false)}>
          <div className="grid max-h-[85vh] w-full max-w-4xl gap-4 overflow-auto rounded-2xl bg-white p-4 shadow-xl md:grid-cols-2" onClick={(event) => event.stopPropagation()}>
            <div>
              <h2 className="font-semibold text-slate-900">Kolektor</h2>
              <div className="mt-3 flex gap-2">
                <Input value={collectorName} onChange={(event) => setCollectorName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCollector(); } }} placeholder="Nama kolektor, lalu Enter" />
                <button type="button" onClick={addCollector} className="rounded-lg bg-amber-500 px-3 text-sm font-semibold text-white">Tambah</button>
              </div>
              <div className="mt-3 space-y-1">
                {modalGroups.length === 0 && <p className="px-2 py-3 text-sm text-slate-400">Belum ada kolektor {biller}.</p>}
                {modalGroups.map((group) => {
                  const selected = activeId === group.id;
                  return (
                    <div key={group.id} className={`flex items-center justify-between rounded-lg border px-2 py-2 text-sm ${selected ? "border-amber-600 bg-amber-500 text-white shadow-sm ring-2 ring-amber-300" : "border-transparent text-slate-700 hover:bg-slate-50"}`}>
                      <button type="button" onClick={() => { setActiveId(group.id); setPicked([]); setSessionOmit([]); }} className="min-w-0 flex-1 truncate text-left font-semibold">{group.collector || group.name}</button>
                      <button type="button" onClick={() => removeGroup(group.id)} className={`shrink-0 text-xs font-semibold ${selected ? "text-white" : "text-rose-600"}`}>Hapus</button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex min-h-0 flex-col">
              <h2 className="font-semibold text-slate-900">{modalLabel ? `Kelola Pelanggan - ${modalLabel} · ${biller}` : `Kelola Pelanggan · ${biller}`}</h2>
              <div className="mt-3 grid gap-2">
                <Select value={biller} onChange={(event) => { const next = event.target.value; setBiller(next); setProductFilter(next); setPicked([]); }}>
                  {KOLEKTIF_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
                </Select>
                {productChoices.length > 0 && (
                  <Select value={detailProduct} onChange={(event) => setDetailProduct(event.target.value)}>
                    {(biller === "PDAM" || biller === "TELCO" || biller === "INTERNET & TV") && <option value="">Pilih produk</option>}
                    {productChoices.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Select>
                )}
                <Input ref={custNoRef} value={custNo} onChange={(event) => setCustNo(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomer(); } }} placeholder="Nomor pelanggan, lalu Enter" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={addCustomer} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white">Tambah</button>
                  <button type="button" onClick={applyProduct} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Terapkan Produk</button>
                  <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Import Excel/CSV/Notepad</button>
                  <button type="button" onClick={exportCustomers} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Ekspor Excel</button>
                </div>
              </div>
              <div className="mt-3 max-h-80 min-h-48 overflow-auto text-sm">
                {!modalActive && modalGroups.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Belum ada kolektor {biller}.</p>}
                {modalActive && modalMembers.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Belum ada data pelanggan {biller} untuk kolektor ini.</p>}
                {modalMembers.map((member) => (
                  <div key={memberKey(member)} className="flex items-center justify-between border-b border-slate-100 py-1.5">
                    <span>{canonicalCategory(member.product)} · {member.number} · {member.name}</span>
                    <button type="button" onClick={() => removeCustomer(member.number, member.product)} className="text-xs text-rose-600">Hapus</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 text-right"><Button variant="outline" onClick={() => setManageOpen(false)}>Tutup</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LoketTransferPage() {
  const { requestRefresh } = useLoketRefresh();
  const [bank, setBank] = useState(BANKS[0]);
  const [account, setAccount] = useState("");
  const [holder, setHolder] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (sending) return;
    setSending(true);
    const response = await fetch("/api/loket-sales", {
      method: "POST",
      headers: await authHeader(),
      body: JSON.stringify({ channel: "simulation", clientRef: `transfer:${crypto.randomUUID()}`, category: "Transfer", product: `Transfer ${bank}`, customerNumber: account, customerName: holder || bank, amount: Number(amount) }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Transfer gagal."); setMessage(""); setSending(false); return; }
    setError("");
    setMessage(`Simulasi transfer ${bank} tercatat. Status: Simulasi. Saldo produksi ${formatRupiah(Number(body.balance))} tidak berubah.`);
    requestRefresh();
    setSending(false);
  };

  return (
    <section className="space-y-2 rounded-md border border-slate-300 bg-white p-3">
      <h1 className="text-lg font-black">Transfer Uang</h1>
      <div className="flex flex-wrap gap-2">
        {BANKS.map((item) => (
          <button key={item} onClick={() => setBank(item)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${bank === item ? "bg-sky-700 text-white" : "bg-slate-100"}`}>{item}</button>
        ))}
      </div>
      <div className="max-w-xl space-y-3">
        <Field label="Nomor rekening tujuan"><Input className="h-9 text-base font-black" value={account} onChange={(event) => setAccount(event.target.value)} /></Field>
        <Field label="Nama pemilik"><Input className="h-9 font-black" value={holder} onChange={(event) => setHolder(event.target.value)} /></Field>
        <Field label="Nominal"><Input className="h-9 text-base font-black" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      <Button onClick={send} disabled={sending || account.trim().length < 6 || Number(amount) < 10000}>{sending ? "Mengirim..." : "Kirim Transfer"}</Button>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}
    </section>
  );
}

function statusLabel(status: string) {
  const key = status.toLowerCase();
  if (key === "success") return "Success";
  if (key === "pending") return "Pending";
  if (key === "simulated" || key === "simulasi") return "Simulasi";
  if (key === "refunded" || key === "refund") return "Refund";
  if (key === "gagal" || key === "failed" || key === "cancelled") return "Gagal";
  return status;
}

export function LoketStatusPage() {
  const { profile } = useAuth();
  const { tick, loketCode, requestRefresh } = useLoketRefresh();
  const [tab, setTab] = useState<"list" | "manual">("list");
  const [sales, setSales] = useState<Sale[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState("success");
  const [appliedStatus, setAppliedStatus] = useState("success");
  const [cleanupNote, setCleanupNote] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);

  const load = async () => {
    const response = await fetch("/api/loket-sales", { headers: await authHeader() });
    const body = response.ok ? await response.json() : { sales: [], simulations: [] };
    setSales((body.sales ?? []) as Sale[]);
  };

  const cleanupTrials = async () => {
    setCleanupNote("");
    const response = await fetch(apiUrl("/api/loket-sales/cleanup"), { method: "POST", headers: await authHeader(), body: "{}" });
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    setCleanupNote(response.ok ? (body.message || "Percobaan lama dibersihkan.") : (body.error || "Pembersihan belum selesai."));
    await load();
    requestRefresh();
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [tick]);

  const rows = useMemo(() => sales.filter((sale) => {
    if (sale.status === "simulated") return false;
    if (sale.status === "pending" && !isLivePending(sale.status, sale.createdAt)) return false;
    if (appliedStatus === "semua" && sale.status !== "success" && sale.status !== "pending") return false;
    if (appliedStatus === "success" && !isProductionSuccess(sale.status)) return false;
    const needle = appliedQuery.trim().toLowerCase();
    if (needle && !sale.customerNumber.toLowerCase().includes(needle) && !sale.customerName.toLowerCase().includes(needle)) return false;
    if (appliedStatus !== "semua" && appliedStatus !== "success" && statusLabel(sale.status).toLowerCase() !== appliedStatus) return false;
    return true;
  }), [sales, appliedQuery, appliedStatus]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 8));
  const safePage = Math.min(page, pageCount);
  const slice = rows.slice((safePage - 1) * 8, safePage * 8);
  const selected = rows.filter((sale) => picked.includes(sale.id));
  const selectedTotal = selected.reduce((sum, sale) => sum + Number(sale.amount), 0);

  const search = () => {
    setAppliedQuery(query);
    setAppliedStatus(status);
    setPage(1);
    load();
  };

  const billFromSale = (sale: Sale) => ({
    id: sale.customerNumber,
    name: sale.customerName,
    product: sale.product,
    period: sale.period || formatWaktu(sale.createdAt),
    tagihan: sale.tagihan ?? Math.max(0, Number(sale.amount) - Number(sale.adminFee ?? 0)),
    admin: Number(sale.adminFee ?? 0),
    total: Number(sale.amount),
    sn: sale.sn || "",
    at: formatWaktu(sale.createdAt),
  });

  const reprintOne = (sale: Sale) => {
    printReceipts(loadPrinterSettings(loketCode), [billFromSale(sale)], identityLine(loketCode, profile?.full_name || profile?.username || "Loket"));
  };

  const reprint = () => {
    if (selected.length === 0) return;
    printReceipts(loadPrinterSettings(loketCode), selected.map(billFromSale), identityLine(loketCode, profile?.full_name || profile?.username || "Loket"));
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-slate-300 bg-white">
      <div className="flex shrink-0 gap-2 border-b border-slate-200 px-4">
        <button onClick={() => setTab("list")} className={`px-3 py-3 text-xs font-bold ${tab === "list" ? "border-b-2 border-amber-500 text-amber-600" : "text-slate-400"}`}>List Transaksi</button>
        <button onClick={() => setTab("manual")} className={`px-3 py-3 text-xs font-bold ${tab === "manual" ? "border-b-2 border-amber-500 text-amber-600" : "text-slate-400"}`}>Cetak Ulang Manual</button>
      </div>
      <div className="grid h-[68px] shrink-0 grid-cols-[1.4fr_12rem_auto] items-end gap-2 overflow-hidden px-2 py-1.5">
        <Field label="Cari nomor pelanggan"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") search(); }} placeholder="Cari nomor pelanggan" /></Field>
        <Field label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="success">Sukses</option>
            <option value="pending">Pending baru</option>
            <option value="gagal">Gagal</option>
            <option value="semua">Sukses dan pending baru</option>
          </Select>
        </Field>
        <div className="flex gap-2">
          <button type="button" onClick={search} className="h-10 rounded-lg bg-amber-500 px-4 text-sm font-bold text-white">Cari / Refresh</button>
          <button type="button" onClick={() => void cleanupTrials()} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-700">Bersihkan percobaan</button>
        </div>
      </div>
      {cleanupNote && <p className="px-3 text-xs font-semibold text-slate-600">{cleanupNote}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-500">
            <tr>{["Aksi", "Produk", "ID Pelanggan", "Nama Pelanggan", "Nominal", "Status", "Tanggal/Jam"].map((head) => <th key={head} className="px-3 py-2 font-semibold">{head}</th>)}</tr>
          </thead>
          <tbody>
            {slice.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Belum ada transaksi pada filter ini.</td></tr>}
            {slice.map((sale) => {
              const on = picked.includes(sale.id);
              return (
                <tr key={sale.id} className={`border-t border-slate-100 text-slate-700 ${on ? "bg-amber-50" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => setPicked((rows) => rows.includes(sale.id) ? rows.filter((id) => id !== sale.id) : [...rows, sale.id])} className={`rounded-md px-2 py-1 text-[11px] font-bold ${on ? "bg-amber-500 text-white" : "bg-slate-800 text-white"}`}>{on ? "DIPILIH" : "PILIH"}</button>
                      <button type="button" onClick={() => reprintOne(sale)} className="rounded-md bg-sky-700 px-2 py-1 text-[11px] font-bold text-white">Cetak Ulang</button>
                    </div>
                  </td>
                  <td className="px-3 py-2">{sale.product}</td>
                  <td className="px-3 py-2 font-mono">{sale.customerNumber}</td>
                  <td className="px-3 py-2">{sale.customerName}</td>
                  <td className="px-3 py-2 font-semibold">{formatRupiah(sale.amount)}</td>
                  <td className="px-3 py-2">{statusLabel(sale.status)}</td>
                  <td className="px-3 py-2">{formatWaktu(sale.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        <span>Halaman {safePage} dari {pageCount}</span>
        <div className="flex gap-1">
          {Array.from({ length: pageCount }, (_, index) => (
            <button key={index + 1} onClick={() => setPage(index + 1)} className={`h-7 min-w-7 rounded-md px-2 font-semibold ${safePage === index + 1 ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}>{index + 1}</button>
          ))}
        </div>
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 bg-slate-800 px-3 text-white">
        <div className="text-base font-black">{tab === "manual" ? `${selected.length} transaksi dipilih · Total ${formatRupiah(selectedTotal)}` : `${rows.length} transaksi`}</div>
        {tab === "manual" ? (
          <button type="button" onClick={reprint} disabled={selected.length === 0} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 disabled:opacity-40">Cetak Ulang ({selected.length})</button>
        ) : <span className="text-xs text-slate-400">Cetak ulang memakai data struk di server</span>}
      </div>
    </section>
  );
}

export function LoketReportPage() {
  const { profile } = useAuth();
  const { tick, loketCode } = useLoketRefresh();
  const [menu, setMenu] = useState<"rekap" | "setoran">("rekap");
  const [sales, setSales] = useState<Sale[]>([]);
  const [tickets, setTickets] = useState<{ id: string; amount: number; bank: string; status: string; transferAt: string; uniqueCode?: string; transferAmount?: number }[]>([]);
  const [biller, setBiller] = useState("semua");
  const [product, setProduct] = useState("semua");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<"rekap" | "detil">("rekap");
  const [preview, setPreview] = useState("");
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const loketName = profile?.full_name || profile?.username || "Loket";

  useEffect(() => {
    (async () => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token ?? "";
      const [salesRes, depositRes] = await Promise.all([
        fetch("/api/loket-sales", { headers: { Authorization: `Bearer ${token}` } }),
        depositRequest("/api/deposits", "GET", token),
      ]);
      const salesBody = salesRes.ok ? await salesRes.json() : { sales: [], simulations: [] };
      setSales(((salesBody.sales ?? []) as Sale[]).filter((sale) => isProductionSuccess(sale.status)));
      setTickets(depositRes.ok ? (depositRes.body.tickets ?? []) as typeof tickets : []);
    })();
  }, [tick]);

  const reportCategories = [...new Set([...CATEGORIES, ...BILLER_CATEGORIES])];
  const products = biller === "semua"
    ? [...new Set([...Object.values(PRODUCTS).flat(), ...BILLER_CATALOG.map((entry) => entry.label)])]
    : (PRODUCTS[biller] ?? productsFor(biller));
  const filtered = useMemo(() => sales.filter((sale) => {
    if (!isProductionSuccess(sale.status)) return false;
    if (biller !== "semua" && sale.category !== biller) return false;
    if (product !== "semua" && !sale.product.toLowerCase().includes(product.toLowerCase())) return false;
    const day = sale.createdAt.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }), [sales, biller, product, from, to]);

  const buildPreview = () => {
    const header = ["MENTARI NUSANTARA", kind === "rekap" ? "REKAP LAPORAN" : "DETIL LAPORAN", identityLine(loketCode, loketName), `Periode ${from || "awal"} s/d ${to || "akhir"}`];
    if (kind === "rekap") {
      const map = new Map<string, { count: number; total: number }>();
      filtered.forEach((sale) => {
        const current = map.get(sale.category) ?? { count: 0, total: 0 };
        current.count += 1;
        current.total += Number(sale.amount);
        map.set(sale.category, current);
      });
      const lines = [...header, ""];
      map.forEach((value, name) => lines.push(`${name}  ${value.count} trx  ${formatRupiah(value.total)}`));
      lines.push("", `TOTAL ${formatRupiah(filtered.reduce((sum, sale) => sum + Number(sale.amount), 0))}`);
      setPreview(lines.join("\n"));
      return;
    }
    const lines = [...header, "", "Waktu                Produk                 ID Pelanggan       Total"];
    filtered.forEach((sale) => lines.push(`${formatWaktu(sale.createdAt).padEnd(20)}${sale.product.padEnd(23)}${sale.customerNumber.padEnd(18)}${sale.customerName.padEnd(16)} admin ${formatRupiah(sale.adminFee ?? 0)}  ${formatRupiah(sale.amount)}  ${sale.status}`));
    setPreview(lines.join("\n"));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button onClick={() => { setMenu("rekap"); setPreview(""); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${menu === "rekap" ? "bg-sky-700 text-white" : "bg-white"}`}>Rekap / Detil Laporan</button>
        <button onClick={() => { setMenu("setoran"); setPreview(""); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${menu === "setoran" ? "bg-sky-700 text-white" : "bg-white"}`}>Pantauan Setoran</button>
      </div>
      {menu === "rekap" && (
        <section className="space-y-2 rounded-md border border-slate-300 bg-white p-3">
          <h1 className="text-lg font-black">Rekap / Detil Laporan</h1>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Biller">
              <Select value={biller} onChange={(event) => { setBiller(event.target.value); setProduct("semua"); }}>
                <option value="semua">Semua biller</option>
                {reportCategories.map((item) => <option key={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Produk">
              <Select value={product} onChange={(event) => setProduct(event.target.value)}>
                <option value="semua">Semua produk</option>
                {products.map((item) => <option key={item}>{item}</option>)}
              </Select>
            </Field>
            <Field label="Tanggal dari"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
            <Field label="Tanggal sampai"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
            <Field label="Jenis laporan">
              <Select value={kind} onChange={(event) => setKind(event.target.value as "rekap" | "detil")}>
                <option value="rekap">Rekap</option>
                <option value="detil">Detil</option>
              </Select>
            </Field>
          </div>
          <Button onClick={buildPreview}>Preview Laporan</Button>
          {preview && (
            <div>
              <pre className="overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-xs">{preview}</pre>
              <Button className="mt-3" variant="outline" onClick={() => printBill("MENTARI NUSANTARA", preview.split("\n"))}>CETAK</Button>
            </div>
          )}
        </section>
      )}
      {menu === "setoran" && (
        <section className="rounded-md border border-slate-300 bg-white p-3">
          <h1 className="text-lg font-black">Pantauan Setoran</h1>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Bulan">
              <Select value={month} onChange={(event) => setMonth(event.target.value)}>
                {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2026, index, 1).toLocaleDateString("id-ID", { month: "long" })}</option>)}
              </Select>
            </Field>
            <Field label="Tahun">
              <Select value={year} onChange={(event) => setYear(event.target.value)}>
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((item) => <option key={item}>{item}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => {
              const rows = setoranDays(Number(year), Number(month), sales.map((sale) => ({ amount: sale.amount, at: sale.createdAt })), tickets.map((ticket) => ({ amount: ticket.amount, at: ticket.transferAt, status: ticket.status })));
              const period = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
              setPreview(setoranLines(identityLine(loketCode, loketName), period, rows, formatRupiah).join("\n"));
            }}>Preview Laporan</Button>
          </div>
          {preview && menu === "setoran" && (
            <div className="mt-3">
              <pre className="overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-xs">{preview}</pre>
              <Button className="mt-3" variant="outline" onClick={() => printBill("MENTARI NUSANTARA", preview.split("\n"))}>CETAK</Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function LoketSettingPage() {
  const { profile } = useAuth();
  const { loketCode } = useLoketRefresh();
  const [panel, setPanel] = useState<"password" | "printer">("password");
  const [oldPassword, setOldPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [printerForm, setPrinterForm] = useState<PrinterSettings>(() => loadPrinterSettings(loketCode));
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { setPrinterForm(loadPrinterSettings(loketCode)); }, [loketCode]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const changePassword = async () => {
    if (!profile?.username) return;
    if (nextPassword.length < 6 || nextPassword !== confirm) { setError("Password baru minimal 6 karakter dan harus sama dengan konfirmasi."); return; }
    const email = `${profile.username}@gigamentarinusantara.id`;
    const signed = await supabase.auth.signInWithPassword({ email, password: oldPassword });
    if (signed.error) { setError("Password lama tidak sesuai."); return; }
    const updated = await supabase.auth.updateUser({ password: nextPassword });
    if (updated.error) { setError(updated.error.message); return; }
    setError("");
    setMessage("Password berhasil diubah.");
    setOldPassword("");
    setNextPassword("");
    setConfirm("");
  };

  const savePrinter = () => {
    savePrinterSettings(loketCode, printerForm);
    setError("");
    setMessage("Pengaturan printer tersimpan untuk loket ini.");
  };
  const refreshPrinter = () => {
    setPrinterForm(loadPrinterSettings(loketCode));
    setPickerOpen(false);
    setError("");
    setMessage("Pengaturan printer dimuat ulang.");
  };
  const testPrint = () => {
    const loket = identityLine(loketCode, profile?.full_name || profile?.username || "Loket");
    const opened = printReceipts(printerForm, [sampleBill()], loket);
    setError(opened ? "" : "Jendela cetak diblokir browser.");
    if (opened) setMessage(`Tes print ${printerForm.format} dikirim ke ${printerForm.printer}.`);
  };
  const previewPage = renderReceipts(printerForm, [sampleBill()], identityLine(loketCode, profile?.full_name || profile?.username || "Loket"));
  const previewSlip = previewPage.pages[0]?.[0];

  return (
    <div className="grid w-full min-w-0 overflow-hidden rounded-md border border-slate-300 bg-white md:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="border-b border-slate-200 p-2 md:border-b-0 md:border-r">
        <button onClick={() => setPanel("password")} className={`mb-1 block w-full rounded-md px-2 py-1.5 text-left text-sm font-black ${panel === "password" ? "bg-sky-700 text-white" : "text-slate-700"}`}>Ubah Password</button>
        <button onClick={() => setPanel("printer")} className={`block w-full rounded-md px-2 py-1.5 text-left text-sm font-black ${panel === "printer" ? "bg-sky-700 text-white" : "text-slate-700"}`}>Setting Printer</button>
      </aside>
      <section className="space-y-2 p-3">
        {panel === "password" && (
          <>
            <h1 className="text-lg font-black">Ubah Password</h1>
            <div className="max-w-lg space-y-3">
              <Field label="Password Lama"><Input className="h-10" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} /></Field>
              <Field label="Password Baru"><Input className="h-10" type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></Field>
              <Field label="Konfirmasi Password"><Input className="h-10" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
              <Button onClick={changePassword}>Simpan</Button>
            </div>
          </>
        )}
        {panel === "printer" && (
          <>
            <h1 className="text-lg font-black">Setting Printer</h1>
            <p className="text-xs text-slate-500">Pengaturan ini berlaku untuk loket ini. Nama printer Windows dipilih lewat dialog cetak saat Tes Print.</p>
            <Field label="Nama printer" className="max-w-lg">
              <div className="flex gap-2">
                <Input className="h-10" value={printerForm.printer} onChange={(event) => setPrinterForm((form) => ({ ...form, printer: event.target.value }))} placeholder="EPSON LX-300+II ESC/P" />
                <button type="button" onClick={() => setPickerOpen((open) => !open)} className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700">Pilih Printer</button>
              </div>
            </Field>
            {pickerOpen && (
              <div className="max-w-lg rounded-xl border border-slate-200 bg-slate-50 p-2">
                {PRINTER_PRESETS.map((name) => (
                  <button key={name} type="button" onClick={() => { setPrinterForm((form) => ({ ...form, printer: name })); setPickerOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white">{name}</button>
                ))}
              </div>
            )}
            <Field label="Jenis cetak">
              <div className="flex flex-wrap gap-2">
                {PRINT_KINDS.map((item) => (
                  <button key={item.id} type="button" onClick={() => setPrinterForm((form) => ({ ...form, kind: item.id }))} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${printerForm.kind === item.id ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}>{item.label}</button>
                ))}
              </div>
            </Field>
            {printerForm.kind === "dotmatrix" && (
              <Field label="Format struk" className="max-w-lg">
                <Select value={printerForm.format} onChange={(event) => setPrinterForm((form) => ({ ...form, format: event.target.value as PrinterSettings["format"] }))}>
                  {PRINT_FORMATS.map((item) => <option key={item}>{item}</option>)}
                </Select>
              </Field>
            )}
            {previewSlip && previewPage.pair ? (
              <div className="grid h-64 grid-cols-[32ch_68ch] items-stretch gap-x-[3ch] overflow-hidden rounded-xl bg-slate-900 p-3 font-mono text-[11px] leading-4 text-slate-100">
                <pre className="m-0 h-full overflow-auto">{previewSlip.loket}</pre>
                <pre className="m-0 h-full overflow-auto">{previewSlip.customer}</pre>
              </div>
            ) : (
              <pre className="max-h-64 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-[11px] leading-4 text-slate-100">{previewSlip?.customer}</pre>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={savePrinter}>Simpan</Button>
              <Button variant="outline" onClick={refreshPrinter}>Refresh</Button>
              <button type="button" onClick={testPrint} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Tes Print</button>
            </div>
          </>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
      </section>
    </div>
  );
}
