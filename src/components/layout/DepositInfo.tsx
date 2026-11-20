import { DEPOSIT_ACCOUNTS } from "@/lib/banks";

export function DepositInfo() {
  return (
    <section className="mt-3 text-left leading-none">
      <h2 className="text-lg font-black uppercase leading-none tracking-wide text-red-700">Informasi Rekening Deposit</h2>
      <p className="mt-1 text-sm font-bold leading-none text-slate-700">Silahkan Transfer ke salah satu rekening berikut</p>
      <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
        {DEPOSIT_ACCOUNTS.map((account) => (
          <div key={account.accountNumber} className="text-base font-bold leading-tight text-slate-950">
            <div className="font-black">{account.bank}</div>
            <div>No.Rekening : <span className="font-mono text-lg font-black">{account.accountNumber}</span></div>
            <div>Atas Nama : <span className="font-black">{account.holder}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}
