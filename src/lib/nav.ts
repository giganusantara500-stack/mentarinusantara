import type { Role } from "@/lib/types";
import {
  LayoutDashboard,
  Users,
  Store,
  Package,
  ShoppingCart,
  Wallet,
  Landmark,
  FileBarChart,
  Megaphone,
  Settings,
  Network,
  Layers,
  ScrollText,
  Ban,
  BadgeAlert,
  ShieldCheck,
  QrCode,
  History,
  Percent,
  Share2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  group?: string;
}

export interface NavSection {
  category: string;
  icon?: LucideIcon;
  items: NavItem[];
}

const dashboard: NavItem = { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard };

function managementNav(role: Role): NavSection[] {
  const reporting: NavItem[] = [
    { path: "/mutasi", label: "Mutasi Saldo", icon: History },
    { path: "/transaksi", label: "Detail Transaksi", icon: ShoppingCart },
    { path: "/rekap", label: "Rekap Transaksi", icon: FileBarChart },
    { path: "/qris", label: "Laporan QRIS", icon: QrCode },
  ];
  const monitoring: NavItem[] = [
    ...(role === "mitra" || role === "submitra" || role === "superadmin" ? [{ path: "/deposit", label: "Tiket Deposit", icon: Landmark }] : []),
    ...(role === "superadmin" ? [{ path: "/setoran", label: "Persetujuan Deposit", icon: Landmark }] : []),
    { path: "/saldo", label: "Saldo Mitra/Loket", icon: Wallet },
    { path: "/outstanding", label: "Monitoring OS", icon: BadgeAlert },
  ];
  const admin: NavItem[] = [];
  if (role === "superadmin") admin.push({ path: "/mitra", label: "Kelola Mitra", icon: Users });
  if (role === "mitra") admin.push({ path: "/submitra", label: "Kelola Sub Mitra", icon: Network });
  admin.push(
    { path: "/loket", label: "Kelola Loket", icon: Store },
    { path: "/kolektif-admin", label: "Manajemen Kolektif", icon: Layers },
  );
  if (role === "superadmin" || role === "mitra") admin.push({ path: "/runtext", label: "Kelola RunText", icon: ScrollText });
  admin.push({ path: "/blokir", label: "Blokir Loket", icon: Ban });
  if (role === "superadmin") {
    admin.push(
      { path: "/harga", label: "Prepare Fee", icon: Percent },
      { path: "/pembagian", label: "Share Fee", icon: Share2 },
    );
  }
  if (role === "superadmin" || role === "mitra" || role === "submitra") admin.push({ path: "/keamanan", label: "Keamanan (2FA)", icon: ShieldCheck });
  admin.push({ path: "/pengaturan", label: "Pengaturan", icon: Settings });
  return [
    { category: "Dashboard", icon: LayoutDashboard, items: [dashboard] },
    { category: "Reporting", icon: FileBarChart, items: reporting },
    { category: "Monitoring", icon: BadgeAlert, items: monitoring },
    { category: "Administrasi", icon: Settings, items: admin },
  ];
}

export const NAV_CONFIG: Record<Role, NavSection[]> = {
  superadmin: managementNav("superadmin"),
  mitra: managementNav("mitra"),
  submitra: managementNav("submitra"),
  loket: [
    { category: "Utama", items: [{ path: "/meja", label: "Beranda", icon: LayoutDashboard }] },
    {
      category: "Transaksi",
      items: [
        { path: "/meja/beli", label: "Beli Produk", icon: ShoppingCart },
        { path: "/meja/transaksi", label: "Riwayat Transaksi", icon: History },
      ],
    },
    {
      category: "Keuangan",
      items: [
        { path: "/meja/transfer", label: "Transfer Uang", icon: Wallet },
        { path: "/meja/deposit", label: "Deposit", icon: Landmark },
      ],
    },
    {
      category: "Informasi",
      items: [
        { path: "/meja/laporan", label: "Laporan", icon: FileBarChart },
        { path: "/meja/pengaturan", label: "Pengaturan", icon: Settings },
      ],
    },
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Super Admin",
  mitra: "Mitra",
  submitra: "Sub Mitra",
  loket: "Loket",
};
