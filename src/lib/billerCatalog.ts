export type BillerKind = "prepaid" | "postpaid";

export interface CatalogItem {
  category: string;
  label: string;
  sku: string;
  kind: BillerKind;
  aliases?: string[];
}

function item(category: string, label: string, sku: string, kind: BillerKind, aliases: string[] = []): CatalogItem {
  return { category, label, sku, kind, aliases };
}

const prepaid = "prepaid" as const;
const postpaid = "postpaid" as const;

export const BILLER_CATALOG: CatalogItem[] = [
  item("PLN", "Postpaid", "pln", postpaid, ["pascabayar"]),
  item("PLN", "Nontaglis", "plnnontaglis", postpaid, ["nontaglis"]),
  item("PLN", "Token 20.000", "pln20", prepaid, ["prepaid 20", "token 20"]),
  item("PLN", "Token 50.000", "pln50", prepaid, ["prepaid 50", "token 50"]),
  item("PLN", "Token 100.000", "pln100", prepaid, ["prepaid 100", "token 100"]),
  item("PLN", "Token 200.000", "pln200", prepaid, ["prepaid 200", "token 200"]),
  item("PLN", "Token 500.000", "pln500", prepaid, ["prepaid 500", "token 500"]),
  item("PLN", "Token 1.000.000", "pln1000", prepaid, ["prepaid 1000", "token 1000"]),
  item("PLN", "Token 5.000.000", "pln5000", prepaid, ["prepaid 5000", "token 5000"]),
  item("PLN", "Token 10.000.000", "pln10000", prepaid, ["prepaid 10000", "token 10000"]),
  item("PLN", "Token 20.000 B", "pln20b", prepaid, ["prepaid 20 b", "token 20 b"]),
  item("PLN", "Token 50.000 B", "pln50b", prepaid, ["prepaid 50 b", "token 50 b"]),
  item("PLN", "Token 100.000 B", "pln100b", prepaid, ["prepaid 100 b", "token 100 b"]),
  item("PLN", "Token 1.000.000 B", "pln1000b", prepaid, ["prepaid 1000 b", "token 1000 b"]),

  item("Pulsa", "Telkomsel 5.000", "s5", prepaid),
  item("Pulsa", "Telkomsel 10.000", "s10", prepaid),
  item("Pulsa", "Telkomsel 15.000", "s15", prepaid),
  item("Pulsa", "Telkomsel 20.000", "s20", prepaid),
  item("Pulsa", "Telkomsel 25.000", "s25", prepaid),
  item("Pulsa", "Telkomsel 30.000", "s30", prepaid),
  item("Pulsa", "Telkomsel 50.000", "s50", prepaid),
  item("Pulsa", "Telkomsel 100.000", "s100", prepaid),

  item("Paket Data", "Telkomsel Flash 1", "flash1", prepaid),
  item("Paket Data", "Telkomsel Flash 2", "flash2", prepaid),
  item("Paket Data", "Telkomsel Flash 3", "flash3", prepaid),
  item("Paket Data", "Indosat Yellow", "yellow1", prepaid),
  item("Paket Data", "Axis SS", "axdss2", prepaid),
  item("Paket Data", "Smartfren Unlimited 1", "smdu1", prepaid),
  item("Paket Data", "Smartfren Unlimited 2", "smdu2", prepaid),
  item("Paket Data", "Tri Happy 1", "happy1", prepaid),
  item("Paket Data", "Tri Happy 3", "happy3", prepaid),
  item("Paket Data", "XL Xtra Combo Flex", "flexs", prepaid),

  item("Games", "Mobile Legends 5", "ml5", prepaid),
  item("Games", "Mobile Legends 10", "ml10", prepaid),
  item("Games", "Mobile Legends 12", "ml12", prepaid),
  item("Games", "Free Fire 12", "ff12", prepaid),
  item("Games", "Free Fire 50", "ff50", prepaid),
  item("Games", "Free Fire 70", "ff70", prepaid),
  item("Games", "Free Fire 140", "ff140", prepaid),
  item("Games", "Free Fire 355", "ff355", prepaid),

  item("E-Money", "Cek GoPay", "gopaycek", prepaid),
  item("E-Money", "Cek DANA", "danacek", prepaid),
  item("E-Money", "DANA 20.000", "dana20", prepaid),
  item("E-Money", "DANA 50.000", "dana50", prepaid),
  item("E-Money", "ShopeePay 50.000", "shopee50", prepaid),
  item("E-Money", "ShopeePay 100.000", "shopee100", prepaid),

  item("SMS & Telpon", "Telkomsel Telepon Pas 10", "pas10", prepaid),
  item("SMS & Telpon", "Telkomsel Telepon Pas 20", "pas20", prepaid),
  item("SMS & Telpon", "Telkomsel Telepon Pas 50", "pas50", prepaid),

  item("Voucher", "Aktivasi Voucher Axis 1", "vax1", prepaid),
  item("Voucher", "Aktivasi Voucher Axis 2", "vax2", prepaid),
  item("Voucher", "HotRod 3G 10 Hari", "hotrod3g10d", prepaid),

  item("TV", "K-Vision 30 Hari", "kvision30d", prepaid),
  item("TV", "K-Vision 180 Hari", "kvision180d", prepaid),

  item("Masa Aktif", "Indosat Aktif 90 Hari", "iactive90", prepaid),
  item("Masa Aktif", "Tri Aktif 4 Bulan", "tactive4m", prepaid),

  item("Gas", "Pertagas 20.000", "pertagas20", prepaid, ["pertagas", "pgn 3000"]),

  item("PDAM", "PDAM Ngawi", "ngawi", postpaid, ["ngawi", "kab ngawi"]),
  item("PDAM", "PDAM Banjarnegara", "banjarnegara", postpaid, ["banjarnegara", "kab banjarnegara"]),
  item("PDAM", "PDAM Bekasi", "bekasi", postpaid, ["bekasi"]),
  item("PDAM", "PDAM Belu", "belu", postpaid, ["belu", "kab belu"]),
  item("PDAM", "PDAM Kudus", "kudus", postpaid, ["kudus", "kab kudus"]),
  item("PDAM", "PDAM Lamongan", "lamongan", postpaid, ["lamongan", "kab lamongan"]),
  item("PDAM", "PDAM Madiun", "madiun", postpaid, ["madiun", "kota madiun"]),
  item("PDAM", "PDAM Magetan", "magetan", postpaid, ["magetan", "kab magetan"]),
  item("PDAM", "PDAM Nganjuk", "nganjuk", postpaid, ["nganjuk", "kab nganjuk"]),
  item("PDAM", "PDAM Pacitan", "pacitan", postpaid, ["pacitan", "kab pacitan"]),
  item("PDAM", "PDAM Pasuruan", "pasuruan", postpaid, ["pasuruan"]),
  item("PDAM", "PDAM Pemalang", "pemalang", postpaid, ["pemalang", "kab pemalang"]),
  item("PDAM", "PDAM Sragen", "sragen", postpaid, ["sragen", "kab sragen"]),
  item("PDAM", "PDAM Bengkulu", "bengkulu", postpaid, ["bengkulu"]),
  item("PDAM", "PDAM Bitung", "bitung", postpaid, ["bitung"]),
  item("PDAM", "PDAM Kendari", "kendari", postpaid, ["kendari"]),
  item("PDAM", "PDAM Magelang", "magelang", postpaid, ["magelang", "kab magelang", "kota magelang"]),
  item("PDAM", "PDAM Mojokerto", "mojokerto", postpaid, ["mojokerto", "kab mojokerto"]),
  item("PDAM", "PDAM Solo", "solo", postpaid, ["solo"]),
  item("PDAM", "PDAM Tegal", "tegal", postpaid, ["tegal", "kab tegal"]),
  item("PDAM", "PDAM Yogyakarta", "yoya", postpaid, ["yoya", "yogyakarta", "kota yogyakarta"]),

  item("HP Postpaid", "Telkomsel Halo", "halo", postpaid, ["halo", "tagihan halo"]),
  item("HP Postpaid", "Indosat Matrix", "matrix", postpaid, ["matrix", "indosat pascabayar", "indosat postpaid"]),
  item("HP Postpaid", "Smartfren", "smart", postpaid, ["smart", "smartfren pascabayar", "smartfren postpaid"]),
  item("HP Postpaid", "Three", "three", postpaid, ["three", "tri", "three pascabayar", "three postpaid"]),
  item("HP Postpaid", "XL", "xl", postpaid, ["xl", "xl pascabayar", "xl postpaid"]),

  item("Internet", "Biznet", "biz", postpaid),
  item("Internet", "BNEt", "bne", postpaid),
  item("Internet", "CBN", "cbn", postpaid),
  item("Internet", "First Media", "first", postpaid, ["firstmedia"]),
  item("Internet", "MyRepublic", "my", postpaid),
  item("Internet", "Oxygen", "oxy", postpaid),
  item("Internet", "Speedy", "speed", postpaid, ["speedy indihome", "indihome"]),
  item("Internet", "Telkom", "telk", postpaid, ["telkom pstn", "telepon"]),
  item("Internet", "XL Home", "xlhome", postpaid),

  item("BPJS", "BPJS Kesehatan", "bpjs", postpaid),

  item("by.U", "by.U", "by", postpaid),

  item("TV Postpaid", "Biznet", "biznet", postpaid),
  item("TV Postpaid", "Indovision", "indovi", postpaid),
  item("TV Postpaid", "Iconnet", "iconnet", postpaid),
  item("TV Postpaid", "Indosat HiFi", "indosathifi", postpaid),
  item("TV Postpaid", "K-Vision 50.000", "kvision50", postpaid),
  item("TV Postpaid", "K-Vision 75.000", "kvision75", postpaid),
  item("TV Postpaid", "K-Vision 100.000", "kvision100", postpaid),
  item("TV Postpaid", "K-Vision 125.000", "kvision125", postpaid),
  item("TV Postpaid", "K-Vision 150.000", "kvision150", postpaid),
  item("TV Postpaid", "K-Vision 200.000", "kvision200", postpaid),
  item("TV Postpaid", "K-Vision 300.000", "kvision300", postpaid),
  item("TV Postpaid", "K-Vision 500.000", "kvision500", postpaid),
  item("TV Postpaid", "Nexmedia", "nexmedia", postpaid),
  item("TV Postpaid", "TelkomVision", "telkomvision", postpaid, ["transvision"]),

  item("Lainnya", "Telkomsel Omni", "telkomselomni", postpaid),
  item("Lainnya", "Indosat Only4u", "indosatonly4u", postpaid),
];

export const BILLER_CATEGORIES = [...new Set(BILLER_CATALOG.map((entry) => entry.category))];

export function foldLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[._/,&()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\d)\s+(?=\d)/g, "$1");
}

export function isHiddenVariant(entry: CatalogItem) {
  return /\sB$/i.test(entry.label.trim()) || /^pln\d+b$/i.test(entry.sku);
}

export function faceValue(label: string) {
  const dotted = label.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (dotted) {
    const value = Number(dotted[1].replace(/\./g, ""));
    if (value >= 1000) return value;
  }
  const pas = label.match(/\bpas\s+(\d{1,3})\b/i);
  if (pas) {
    const value = Number(pas[1]) * 1000;
    if (value >= 1000) return value;
  }
  return 0;
}

export function productsFor(category: string) {
  return BILLER_CATALOG.filter((entry) => entry.category === category && !isHiddenVariant(entry)).map((entry) => entry.label);
}

function foldProduct(value: string) {
  return foldLabel(value).replace(/\bpascabayar\b/g, "postpaid");
}

export function resolveCollectiveProduct(category: string, product: string): { category: string; product: string } | null {
  const attempts = [
    [category, product],
    [product, category],
    [category, category],
    [product, product],
  ];
  for (const [group, name] of attempts) {
    const found = findCatalogItem(group, name);
    if (found) return { category: found.category, product: found.label };
  }
  const blob = foldLabel(`${category} ${product}`);
  if (blob.includes("pdam")) {
    const area = BILLER_CATALOG.find((entry) => entry.category === "PDAM" && (
      (entry.aliases ?? []).some((alias) => mentions(blob, alias))
      || foldLabel(entry.label).split(" ").some((word) => word !== "pdam" && mentions(blob, word))
    ));
    if (area) return { category: "PDAM", product: area.label };
    return null;
  }
  const billed = BILLER_CATALOG.find((entry) => (
    entry.category === "Internet" || entry.category === "TV Postpaid" || entry.category === "HP Postpaid" || entry.category === "Gas"
  ) && (
    mentions(blob, entry.label) || (entry.aliases ?? []).some((alias) => mentions(blob, alias))
  ));
  if (billed) return { category: billed.category, product: billed.label };
  const defaults: { test: RegExp; category: string; product: string }[] = [
    { test: /nontaglis/, category: "PLN", product: "Nontaglis" },
    { test: /\bpln\b/, category: "PLN", product: "Postpaid" },
    { test: /bpjs/, category: "BPJS", product: "BPJS Kesehatan" },
    { test: /pertagas|\bpgn\b|(^|\s)gas(\s|$)/, category: "Gas", product: "Pertagas 20.000" },
    { test: /telkom|pstn|speedy|indihome/, category: "Internet", product: "Telkom" },
    { test: /halo/, category: "HP Postpaid", product: "Telkomsel Halo" },
    { test: /indosat|matrix/, category: "HP Postpaid", product: "Indosat Matrix" },
    { test: /smartfren/, category: "HP Postpaid", product: "Smartfren" },
    { test: /\bthree\b|\btri\b/, category: "HP Postpaid", product: "Three" },
    { test: /\bxl\b/, category: "HP Postpaid", product: "XL" },
    { test: /\btelco\b/, category: "HP Postpaid", product: "Telkomsel Halo" },
  ];
  for (const rule of defaults) {
    if (!rule.test.test(blob)) continue;
    const found = findCatalogItem(rule.category, rule.product);
    if (found) return { category: found.category, product: found.label };
  }
  return null;
}

function mentions(blob: string, value: string) {
  const token = foldLabel(value);
  if (!token) return false;
  if (token.length < 4) return new RegExp(`(^|\\s)${token}(\\s|$)`).test(blob);
  return blob.includes(token);
}

export function collectiveTab(category: string, product: string) {
  const resolved = resolveCollectiveProduct(category, product);
  if (!resolved) return "";
  if (resolved.category === "PLN") return "PLN";
  if (resolved.category === "PDAM") return "PDAM";
  if (resolved.category === "Gas") return "GAS";
  if (resolved.category === "BPJS") return "BPJS";
  if (resolved.category === "HP Postpaid") return "TELCO";
  if (resolved.category === "TV Postpaid") return "INTERNET & TV";
  if (resolved.category === "Internet") {
    const label = foldLabel(resolved.product);
    if (label.includes("telkom") || label.includes("speedy")) return "TELKOM";
    return "INTERNET & TV";
  }
  return "";
}

export function collectiveProductChoices(tab: string) {
  const key = foldLabel(tab);
  if (key === "pln") return productsFor("PLN");
  if (key === "pdam") return productsFor("PDAM");
  if (key === "gas") return productsFor("Gas");
  if (key === "telkom") return ["Telkom", "Speedy"];
  if (key === "bpjs") return productsFor("BPJS");
  if (key === "telco") return productsFor("HP Postpaid");
  if (key.includes("internet")) return [...productsFor("Internet"), ...productsFor("TV Postpaid")];
  return [] as string[];
}

export function findCatalogItem(category: string, product: string) {
  const cat = foldProduct(category);
  const raw = foldLabel(product).replace(/\bpascabayar\b/g, "postpaid");
  const stripped = cat && raw.startsWith(`${cat} `) ? raw.slice(cat.length + 1) : raw;
  const matches = (entry: CatalogItem) => {
    const label = foldProduct(entry.label);
    const sku = entry.sku.toLowerCase();
    const aliases = (entry.aliases ?? []).map((alias) => foldProduct(alias));
    const prefixed = foldProduct(`${entry.category} ${entry.label}`);
    return stripped === label || raw === label || stripped === sku || raw === sku || raw === prefixed || aliases.includes(stripped) || aliases.includes(raw);
  };
  const inCategory = BILLER_CATALOG.filter((entry) => foldProduct(entry.category) === cat);
  return (inCategory.length ? inCategory : BILLER_CATALOG).find(matches) ?? BILLER_CATALOG.find(matches);
}
