import { collectiveTab, foldLabel } from "@/lib/billerCatalog";

export const ADMIN_FEES = [4800, 4900, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 10000, 11000, 12000, 13000, 14000, 15000];

export const BILLER_ADMIN: Record<string, number> = {
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

const STORAGE_KEY = "mentari-admin-bank";
export const ADMIN_BANK_EVENT = "mentari-admin-bank";

export function loadPlnAdmin() {
  if (typeof localStorage === "undefined") return 4800;
  const fee = Number(localStorage.getItem(STORAGE_KEY));
  return ADMIN_FEES.includes(fee) ? fee : 4800;
}

export function savePlnAdmin(fee: number) {
  if (!ADMIN_FEES.includes(fee) || typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, String(fee));
  window.dispatchEvent(new Event(ADMIN_BANK_EVENT));
}

export function adminForProduct(category: string, product = "", plnChoice = loadPlnAdmin()) {
  const tab = collectiveTab(category, product) || collectiveTab(product, category);
  const key = foldLabel(`${tab} ${category} ${product}`);
  if (tab === "PLN" || /\bpln\b/.test(key)) return plnChoice;
  if (tab === "PDAM" || key.includes("pdam")) return BILLER_ADMIN.PDAM;
  if (tab === "GAS" || key.includes("gas") || key.includes("pertagas") || key.includes("pgn")) return BILLER_ADMIN.Gas;
  if (tab === "BPJS" || key.includes("bpjs")) return BILLER_ADMIN.BPJS;
  if (tab === "TELCO" || key.includes("halo") || key.includes("hp postpaid")) return BILLER_ADMIN["HP Postpaid"];
  if (tab === "TELKOM") return BILLER_ADMIN.Internet;
  if (tab === "INTERNET & TV") {
    if (key.includes("k vision") || key.includes("indovision") || key.includes("transvision") || key.includes("nexmedia")) return BILLER_ADMIN["TV Postpaid"];
    return BILLER_ADMIN.Internet;
  }
  if (BILLER_ADMIN[category] != null) return BILLER_ADMIN[category];
  return BILLER_ADMIN.Lainnya;
}
