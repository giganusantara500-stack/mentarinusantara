export const DEPOSIT_ACCOUNTS = [
  { bank: "BRI", accountNumber: "686601009504534", holder: "Aris Purwanto" },
] as const;

export type DepositBank = (typeof DEPOSIT_ACCOUNTS)[number]["bank"];
