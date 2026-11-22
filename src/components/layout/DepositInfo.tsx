import { CopyChip } from "@/components/deposit/CopyChip";
import { DEPOSIT_ACCOUNTS } from "@/lib/banks";

export function DepositInfo() {
  return (
    <section className="mt-3 text-left">
      <h2 className="text-lg font-black uppercase leading-tight tracking-wide text-red-700">Informasi Rekening Deposit</h2>
      <p className="mt-1 text-sm font-bold leading-snug text-slate-700">Silahkan transfer ke rekening berikut</p>
      <div className="mt-2 grid gap-3">
        {DEPOSIT_ACCOUNTS.map((account) => (
          <div key={account.accountNumber} className="min-w-0 text-base font-bold leading-tight text-slate-950">
            <div className="font-black">{account.bank}</div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">No. Rekening : <span className="break-all font-mono text-lg font-black">{account.accountNumber}</span></div>
              <CopyChip value={account.accountNumber} done="Nomor rekening tersalin." />
            </div>
            <div className="mt-1 break-words">Atas Nama : <span className="font-black">{account.holder}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}
