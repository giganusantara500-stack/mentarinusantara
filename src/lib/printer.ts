import { formatRupiah } from "@/lib/format";

export const PRINT_FORMATS = ["INKJET", "INKJET-SUMMARY", "TERMAL", "STRUK/4", "STRUK/3", "STRUK/3T-HALF", "STRUK/2T", "STRUK/2T-HALF", "STRUK/2"] as const;
export const PRINT_KINDS = [
  { id: "tinta", label: "Printer Tinta" },
  { id: "dotmatrix", label: "Printer Dotmatrix" },
  { id: "pdf", label: "PDF" },
] as const;
export const PRINTER_PRESETS = ["EPSON LX-300+II ESC/P", "EPSON LX-310 ESC/P", "EPSON LQ-310 ESC/P", "Printer Windows"];

export type PrintFormat = (typeof PRINT_FORMATS)[number];
export type PrintKind = (typeof PRINT_KINDS)[number]["id"];

export interface PrinterSettings {
  printer: string;
  kind: PrintKind;
  format: PrintFormat;
}

export interface ReceiptBill {
  id: string;
  name: string;
  product: string;
  period: string;
  tagihan: number;
  admin: number;
  total: number;
  sn?: string;
  at?: string;
}

const DEFAULTS: PrinterSettings = {
  printer: "EPSON LX-300+II ESC/P",
  kind: "dotmatrix",
  format: "STRUK/4",
};

function storageKey(loketCode: string) {
  return `mentari-printer-setting:${loketCode || "loket"}`;
}

export function loadPrinterSettings(loketCode: string): PrinterSettings {
  try {
    const raw = localStorage.getItem(storageKey(loketCode));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PrinterSettings>;
    const format = PRINT_FORMATS.includes(parsed.format as PrintFormat) ? parsed.format as PrintFormat : DEFAULTS.format;
    const kind = PRINT_KINDS.some((item) => item.id === parsed.kind) ? parsed.kind as PrintKind : DEFAULTS.kind;
    return { printer: parsed.printer?.trim() || DEFAULTS.printer, kind, format };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrinterSettings(loketCode: string, settings: PrinterSettings) {
  localStorage.setItem(storageKey(loketCode), JSON.stringify(settings));
}

function bandCount(format: PrintFormat) {
  if (format === "STRUK/4") return 4;
  if (format === "STRUK/3" || format === "STRUK/3T-HALF") return 3;
  if (format === "STRUK/2" || format === "STRUK/2T" || format === "STRUK/2T-HALF") return 2;
  return 1;
}

function meter(id: string, period: string) {
  const digits = id.replace(/\D/g, "") || "0";
  const seed = Number(digits.slice(-6)) || 0;
  const tarif = ["R1", "R1", "R2", "R3", "B2"][seed % 5];
  const daya = [450, 900, 1300, 2200, 3500][seed % 5];
  const awal = 100000 + (seed % 80000);
  const akhir = awal + 80 + (seed % 420);
  const pad = (value: number) => String(value).padStart(6, "0");
  const month = period.replace(/\s+/g, " ").toUpperCase();
  return {
    tarif: `${tarif} / ${daya} VA`,
    blth: month || new Date().toLocaleDateString("id-ID", { month: "short", year: "numeric" }).toUpperCase(),
    stand: `${pad(awal)} - ${pad(akhir)}`,
    sls: digits.slice(-6).padStart(6, "0"),
  };
}

const SLIP_LINES = 16;

function field(label: string, value: string, width: number) {
  return `${label.padEnd(12)}: ${value}`.slice(0, width);
}

function center(text: string, width: number) {
  const value = text.length > width ? text.slice(0, width) : text;
  const pad = Math.floor((width - value.length) / 2);
  return `${" ".repeat(pad)}${value}`;
}

function columns(left: string, right: string, width: number) {
  const leftWidth = Math.floor(width * 0.54);
  return `${left.slice(0, leftWidth).padEnd(leftWidth)}${right}`.slice(0, width);
}

function padLines(lines: string[]) {
  const next = lines.slice(0, SLIP_LINES);
  while (next.length < SLIP_LINES) next.push("");
  return next.join("\n");
}

function wrap(text: string, width: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else current = next;
  });
  if (current) lines.push(current);
  return lines;
}

const SAH = "PLN menyatakan struk ini sebagai bukti pembayaran yang sah";

function footerLines(width: number) {
  return [...wrap(SAH, width), "Call Center PLN 123", "www.pln.co.id"].map((line) => center(line, width));
}

function balance(lines: string[]) {
  const spare = Math.max(0, SLIP_LINES - lines.length);
  const top = Math.floor(spare / 2);
  const bottom = spare - top;
  return [...Array(top).fill(""), ...lines, ...Array(bottom).fill("")].slice(0, SLIP_LINES);
}

function receiptTitle(product: string) {
  const name = product.toUpperCase();
  if (name.includes("PLN") || name.includes("LISTRIK")) return "STRUK PEMBAYARAN TAGIHAN LISTRIK";
  if (name.includes("PDAM")) return "STRUK PEMBAYARAN TAGIHAN PDAM";
  return `STRUK PEMBAYARAN ${name}`.trim();
}

function isPlnSlip(product: string) {
  const name = product.toUpperCase();
  return name.includes("PLN") || name.includes("LISTRIK");
}

function isPrepaidProduct(product: string) {
  return /token|pulsa|paket data|voucher|e-money|e-wallet|\bgames\b|masa aktif|prepaid|gopay|dana|shopee|ovo/i.test(product);
}

function tokenLines(sn: string, width: number) {
  const value = sn.trim();
  const room = Math.max(8, width - 14);
  if (!value) return [field("TOKEN/SN", "-", width)];
  const lines = [field("TOKEN/SN", value.slice(0, room), width)];
  let rest = value.slice(room);
  while (rest) {
    lines.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  return lines;
}

export function slipText(bill: ReceiptBill, width: number, _loket: string, copy: "STRUK" | "SEGI" = "STRUK") {
  const info = meter(bill.id, bill.period);
  const rule = "=".repeat(width);
  const line = "-".repeat(width);
  if (copy === "SEGI") {
    if (isPrepaidProduct(bill.product)) {
      return balance([
        center("SEGI TOKEN", width),
        center(bill.product.toUpperCase(), width),
        line,
        field("IDPEL", bill.id, width),
        field("NAMA", bill.name, width),
        field("TOTAL", formatRupiah(bill.total), width),
        ...(bill.sn ? [field("TOKEN", bill.sn, width)] : []),
        line,
      ]).join("\n");
    }
    return balance([
      center("SEGI PELUNASAN", width),
      center(bill.product.toUpperCase(), width),
      line,
      field("IDPEL", bill.id, width),
      field("NAMA", bill.name, width),
      field("BL/TH", info.blth, width),
      field("TOTAL", formatRupiah(bill.total), width),
      line,
    ]).join("\n");
  }
  const left = Math.max(24, Math.floor(width * 0.5) - 1);
  const proof = [bill.sn ? field("SN/TOKEN", bill.sn, width) : ""].filter(Boolean);
  if (isPrepaidProduct(bill.product)) {
    const title = /token/i.test(bill.product) ? "STRUK PEMBELIAN TOKEN LISTRIK" : `STRUK ${bill.product.toUpperCase()}`;
    return padLines([
      rule,
      center(title, width),
      line,
      field("ID PELANGGAN", bill.id, width),
      field("NAMA", bill.name, width),
      field("KETERANGAN", bill.period || "-", width),
      ...(bill.at ? [field("WAKTU", bill.at, width)] : []),
      line,
      field("NOMINAL", formatRupiah(bill.tagihan), width),
      field("ADMIN", formatRupiah(bill.admin), width),
      field("TOTAL BAYAR", formatRupiah(bill.total), width),
      line,
      ...tokenLines(bill.sn || "", width),
      rule,
    ]);
  }
  if (!isPlnSlip(bill.product)) {
    return padLines([
      rule,
      center(receiptTitle(bill.product), width),
      line,
      field("ID PELANGGAN", bill.id, width),
      field("NAMA", bill.name, width),
      field("PERIODE", bill.period || "-", width),
      ...(bill.at ? [field("WAKTU", bill.at, width)] : []),
      ...proof,
      line,
      field("TAGIHAN", formatRupiah(bill.tagihan), width),
      field("ADMIN", formatRupiah(bill.admin), width),
      field("TOTAL BAYAR", formatRupiah(bill.total), width),
      rule,
    ]);
  }
  return padLines([
    rule,
    center(receiptTitle(bill.product), width),
    line,
    columns(field("ID PELANGGAN", bill.id, left), `BL/TH: ${info.blth}`, width),
    columns(field("NAMA", bill.name, left), `STAND METER: ${info.stand}`, width),
    columns(field("TARIF/DAYA", info.tarif, left), `SLS: ${info.sls}`, width),
    ...proof,
    line,
    field("TAGIHAN", formatRupiah(bill.tagihan), width),
    field("ADMIN BANK", formatRupiah(bill.admin), width),
    field("TOTAL BAYAR", formatRupiah(bill.total), width),
    rule,
    ...footerLines(width),
  ]);
}

export function summaryText(bills: ReceiptBill[], width: number, loket: string) {
  const rule = "=".repeat(width);
  const line = "-".repeat(width);
  const rows = bills.map((bill, index) => `${String(index + 1).padStart(2)} ${bill.id.padEnd(14).slice(0, 14)} ${bill.name.padEnd(16).slice(0, 16)} ${formatRupiah(bill.total)}`);
  const total = bills.reduce((sum, bill) => sum + bill.total, 0);
  return [rule, "MENTARI NUSANTARA", "RINGKASAN STRUK", loket, line, ...rows, line, `TOTAL ${bills.length} LEMBAR  ${formatRupiah(total)}`, rule].join("\n");
}

export function sampleBill(): ReceiptBill {
  return { id: "520591307052", name: "PELANGGAN UJI", product: "PLN POSTPAID", period: "November 2026", tagihan: 93901, admin: 4800, total: 98701 };
}

export interface RenderedSlip { customer: string; loket: string }
export interface RenderedReceipts { pair: boolean; rows: number; pages: RenderedSlip[][] }

export function renderReceipts(settings: PrinterSettings, bills: ReceiptBill[], loket: string): RenderedReceipts {
  const source = bills.length ? bills : [sampleBill()];
  if (settings.kind !== "dotmatrix") {
    const pages = source.map((bill) => [{ customer: slipText(bill, 72, loket, "STRUK"), loket: "" }]);
    return { pair: false, rows: 1, pages };
  }
  const rows = bandCount(settings.format);
  const pages: RenderedSlip[][] = [];
  for (let index = 0; index < source.length; index += rows) {
    const slice = source.slice(index, index + rows);
    pages.push(Array.from({ length: rows }, (_, slot) => {
      const bill = slice[slot];
      if (!bill) return { customer: "", loket: "" };
      const segi = slipText(bill, 32, loket, "SEGI").split("\n");
      const struk = slipText(bill, 68, loket, "STRUK").split("\n");
      const height = Math.max(segi.length, struk.length);
      while (segi.length < height) segi.push("");
      while (struk.length < height) struk.push("");
      return { loket: segi.join("\n"), customer: struk.join("\n") };
    }));
  }
  return { pair: true, rows, pages };
}

export function printReceipts(settings: PrinterSettings, bills: ReceiptBill[], loket: string) {
  const rendered = renderReceipts(settings, bills, loket);
  const popup = window.open("", "struk-printer", "width=980,height=760");
  if (!popup) return false;
  const escape = (value: string) => value.replace(/</g, "&lt;");
  const pageHtml = rendered.pages.map((page) => {
    const bands = page.map((slip) => rendered.pair
      ? `<div class="band"><pre class="segi">${escape(slip.loket)}</pre><pre class="struk">${escape(slip.customer)}</pre></div>`
      : `<pre class="single">${escape(slip.customer)}</pre>`).join("");
    return `<section class="page">${bands}</section>`;
  }).join("");
  const title = settings.kind === "dotmatrix" ? `${settings.printer} · ${settings.format}` : settings.printer;
  popup.document.write(`<!doctype html><html><head><title>${title}</title><style>
    @page{size:A4 portrait;margin:5mm 6mm}
    body{margin:0;color:#000}
    .page{height:287mm;page-break-after:always}
    .band{height:71.75mm;box-sizing:border-box;display:flex;align-items:stretch;overflow:hidden}
    .segi{width:32ch;flex:0 0 32ch}
    .struk{width:68ch;flex:0 0 68ch;margin-left:3ch}
    .segi,.struk,.single{margin:0;height:71.75mm;box-sizing:border-box;font-family:"Courier New",Consolas,monospace;font-size:8.5pt;line-height:calc(71.75mm / 14);white-space:pre;overflow:hidden}
    .single{height:auto;font-size:11pt;line-height:13pt}
  </style></head><body>${pageHtml}</body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}
