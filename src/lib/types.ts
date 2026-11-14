export type Role = "superadmin" | "mitra" | "submitra" | "loket";

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  parentId: string | null;
  status: "aktif" | "nonaktif";
  saldo: number;
  city: string;
  joinedAt: string;
  avatarColor: string;
}

export type ProductCategory =
  | "pulsa"
  | "paket_data"
  | "token_listrik"
  | "tagihan_pln"
  | "tagihan_pdam"
  | "emoney";

export interface Product {
  id: string;
  category: ProductCategory;
  name: string;
  provider: string;
  basePrice: number;
  defaultSellPrice: number;
  editableByMitra: boolean;
  status: "aktif" | "nonaktif";
  description?: string;
}

export type TxStatus = "berhasil" | "gagal" | "pending";
export type TxType = "pembelian" | "topup" | "refund" | "penyesuaian";

export interface Transaction {
  id: string;
  invoice: string;
  userId: string;
  productName: string;
  category: ProductCategory;
  customerNumber: string;
  amount: number;
  status: TxStatus;
  createdAt: string;
  note?: string;
}

export interface Mutation {
  id: string;
  userId: string;
  type: TxType;
  amount: number;
  direction: "masuk" | "keluar";
  description: string;
  balanceAfter: number;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: Role | "semua";
  createdAt: string;
  pinned: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Super Admin",
  mitra: "Mitra",
  submitra: "Sub Mitra",
  loket: "Loket",
};

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  pulsa: "Pulsa",
  paket_data: "Paket Data",
  token_listrik: "Token Listrik",
  tagihan_pln: "Tagihan PLN",
  tagihan_pdam: "Tagihan PDAM",
  emoney: "E-Money",
};

export const CATEGORY_COLORS: Record<ProductCategory, string> = {
  pulsa: "bg-blue-100 text-blue-700",
  paket_data: "bg-cyan-100 text-cyan-700",
  token_listrik: "bg-amber-100 text-amber-700",
  tagihan_pln: "bg-emerald-100 text-emerald-700",
  tagihan_pdam: "bg-sky-100 text-sky-700",
  emoney: "bg-rose-100 text-rose-700",
};
