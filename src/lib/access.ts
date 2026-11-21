import { canonicalRole } from "@/lib/auth";

export const MONITOR_HOME = "/dashboard";
export const MONITOR_LOGIN = "/login";
export const LOKET_HOME = "/meja";
export const LOKET_LOGIN = "/loket-login";

const LOKET = new Set([
  "/meja",
  "/meja/beli",
  "/meja/kolektif",
  "/meja/transfer",
  "/meja/riwayat",
  "/meja/transaksi",
  "/meja/laporan",
  "/meja/pengaturan",
  "/meja/deposit",
]);

const SUBMITRA = new Set([
  "/dashboard", "/mutasi", "/transaksi", "/riwayat", "/rekap", "/qris", "/deposit",
  "/setoran", "/deposit-approval", "/saldo", "/outstanding", "/loket", "/kolektif-admin",
  "/blokir", "/pengaturan", "/pengumuman", "/laporan", "/keamanan",
]);

const MITRA = new Set([...SUBMITRA, "/submitra", "/runtext"]);

const SUPER = new Set([...MITRA, "/mitra", "/harga", "/pembagian", "/produk", "/beli", "/setup-superadmin"]);

export function isLoketArea(path: string) {
  const base = path.split("?")[0] || "/";
  return base === LOKET_LOGIN || base === LOKET_HOME || base.startsWith(`${LOKET_HOME}/`);
}

export function homeForRole(role: string | null | undefined) {
  return canonicalRole(role) === "loket" ? LOKET_HOME : MONITOR_HOME;
}

export function pathAllowed(role: string | null | undefined, path: string) {
  const canonical = canonicalRole(role);
  const base = path.split("?")[0] || "/dashboard";
  const detail = base.match(/^\/(mitra|submitra|loket)\/detail\/.+$/);
  if (detail) {
    const area = detail[1];
    if (canonical === "super_admin") return true;
    if (canonical === "mitra") return area === "submitra" || area === "loket";
    if (canonical === "submitra") return area === "loket";
    return false;
  }
  const allowed = canonical === "super_admin" ? SUPER : canonical === "mitra" ? MITRA : canonical === "submitra" ? SUBMITRA : canonical === "loket" ? LOKET : new Set(["/dashboard"]);
  return allowed.has(base);
}
