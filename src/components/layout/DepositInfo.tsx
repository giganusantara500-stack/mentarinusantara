import { DEPOSIT_ACCOUNTS } from "@/lib/banks";

export function DepositInfo() {
  return (
    <section className="mt-2 text-left leading-tight">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-red-700">Informasi Rekening Deposit</h2>
      <p className="mt-0.5 text-sm leading-tight text-slate-600">Silahkan Transfer ke salah satu rekening berikut</p>
      <div className="mt-2 flex flex-wrap gap-x-10">
        {DEPOSIT_ACCOUNTS.map((account) => (
          <div key={account.accountNumber} className="text-sm leading-tight text-slate-900">
            <div className="font-extrabold">{account.bank}</div>
            <div>No.Rekening : <span className="font-mono font-bold">{account.accountNumber}</span></div>
            <div>Atas Nama : <span className="font-semibold">{account.holder}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}
