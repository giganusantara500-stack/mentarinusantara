import { canonicalRole } from "@/lib/auth";

const LOKET = new Set(["/dashboard", "/beli", "/kolektif", "/transfer", "/riwayat", "/transaksi", "/laporan", "/pengaturan", "/deposit"]);

const SUBMITRA = new Set([
  "/dashboard", "/mutasi", "/transaksi", "/riwayat", "/rekap", "/qris", "/deposit",
  "/setoran", "/deposit-approval", "/saldo", "/outstanding", "/loket", "/kolektif-admin",
  "/blokir", "/pengaturan", "/pengumuman", "/laporan", "/keamanan",
]);

const MITRA = new Set([...SUBMITRA, "/submitra", "/runtext"]);

const SUPER = new Set([...MITRA, "/mitra", "/harga", "/pembagian", "/produk", "/beli", "/setup-superadmin"]);

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
