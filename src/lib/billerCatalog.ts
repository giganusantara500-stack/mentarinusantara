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
  item("PLN", "Pascabayar", "pln", postpaid, ["postpaid", "pascabayar"]),
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

  item("HP Pascabayar", "Telkomsel Halo", "halo", postpaid, ["halo", "tagihan halo"]),
  item("HP Pascabayar", "Indosat Matrix", "matrix", postpaid, ["matrix", "indosat pascabayar"]),
  item("HP Pascabayar", "Smartfren", "smart", postpaid, ["smart", "smartfren pascabayar"]),
  item("HP Pascabayar", "Three", "three", postpaid, ["three", "tri", "three pascabayar"]),
  item("HP Pascabayar", "XL", "xl", postpaid, ["xl", "xl pascabayar"]),

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

  item("TV Pascabayar", "Biznet", "biznet", postpaid),
  item("TV Pascabayar", "Indovision", "indovi", postpaid),
  item("TV Pascabayar", "Iconnet", "iconnet", postpaid),
  item("TV Pascabayar", "Indosat HiFi", "indosathifi", postpaid),
  item("TV Pascabayar", "K-Vision 50.000", "kvision50", postpaid),
  item("TV Pascabayar", "K-Vision 75.000", "kvision75", postpaid),
  item("TV Pascabayar", "K-Vision 100.000", "kvision100", postpaid),
  item("TV Pascabayar", "K-Vision 125.000", "kvision125", postpaid),
  item("TV Pascabayar", "K-Vision 150.000", "kvision150", postpaid),
  item("TV Pascabayar", "K-Vision 200.000", "kvision200", postpaid),
  item("TV Pascabayar", "K-Vision 300.000", "kvision300", postpaid),
  item("TV Pascabayar", "K-Vision 500.000", "kvision500", postpaid),
  item("TV Pascabayar", "Nexmedia", "nexmedia", postpaid),
  item("TV Pascabayar", "TelkomVision", "telkomvision", postpaid, ["transvision"]),

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

export function productsFor(category: string) {
  return BILLER_CATALOG.filter((entry) => entry.category === category).map((entry) => entry.label);
}

export function findCatalogItem(category: string, product: string) {
  const cat = foldLabel(category);
  const raw = foldLabel(product);
  const stripped = cat && raw.startsWith(`${cat} `) ? raw.slice(cat.length + 1) : raw;
  const matches = (entry: CatalogItem) => {
    const label = foldLabel(entry.label);
    const sku = entry.sku.toLowerCase();
    const aliases = (entry.aliases ?? []).map((alias) => foldLabel(alias));
    const prefixed = foldLabel(`${entry.category} ${entry.label}`);
    return stripped === label || raw === label || stripped === sku || raw === sku || raw === prefixed || aliases.includes(stripped) || aliases.includes(raw);
  };
  const inCategory = BILLER_CATALOG.filter((entry) => foldLabel(entry.category) === cat);
  return (inCategory.length ? inCategory : BILLER_CATALOG).find(matches) ?? BILLER_CATALOG.find(matches);
}
