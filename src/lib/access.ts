import { canonicalRole } from "@/lib/auth";

export const MONITOR_HOME = "/dashboard";
export const MONITOR_LOGIN = "/login";
export const MONITOR_DOOR = "/masuk-dashboard";
export const LOKET_HOME = "/meja";
export const LOKET_LOGIN = "/loket-login";
export const LOKET_DOOR = "/masuk-loket";

const LOKET_DOORS = new Set([LOKET_LOGIN, LOKET_DOOR]);
const MONITOR_DOORS = new Set([MONITOR_LOGIN, MONITOR_DOOR]);

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
  "/saldo", "/outstanding", "/loket", "/kolektif-admin",
  "/blokir", "/pengaturan", "/pengumuman", "/laporan", "/keamanan",
]);

const MITRA = new Set([...SUBMITRA, "/submitra", "/runtext"]);

const SUPER = new Set([...MITRA, "/mitra", "/harga", "/pembagian", "/audit-fee", "/laporan-fee", "/produk", "/beli", "/setup-superadmin", "/setoran", "/deposit-approval"]);

export function routeBase(path: string) {
  const base = (path.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return base.startsWith("/") ? base : `/${base}`;
}

export function isLoketArea(path: string) {
  const base = routeBase(path);
  return LOKET_DOORS.has(base) || base === LOKET_HOME || base.startsWith(`${LOKET_HOME}/`);
}

export function isMonitorDoor(path: string) {
  return MONITOR_DOORS.has(routeBase(path));
}

export function homeForRole(role: string | null | undefined) {
  return canonicalRole(role) === "loket" ? LOKET_HOME : MONITOR_HOME;
}

export function resolvePath(role: string | null | undefined, path: string) {
  const base = routeBase(path);
  const home = homeForRole(role);
  if (LOKET_DOORS.has(base) || MONITOR_DOORS.has(base)) return home;
  if (canonicalRole(role) === "loket") return pathAllowed(role, base) ? base : LOKET_HOME;
  if (isLoketArea(base) || !pathAllowed(role, base)) return home;
  return base;
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
