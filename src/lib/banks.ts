// Rekening tujuan deposit. Ganti entri ini bila rekening resmi Mentari Nusantara berubah.
// Fungsi database own_deposit_request menyimpan nomor yang sama saat tiket dibuat.
export const DEPOSIT_ACCOUNTS = [
  { bank: "BRI", accountNumber: "686601009504534", holder: "Aris Purwanto" },
] as const;

export type DepositBank = (typeof DEPOSIT_ACCOUNTS)[number]["bank"];
