import { DEPOSIT_ACCOUNTS } from "@/lib/banks";

export function DepositInfo() {
  return (
    <section className="mt-10 bg-transparent text-left md:mt-14">
      <h2 className="text-base font-extrabold uppercase tracking-wide text-red-700">Informasi Rekening Deposit</h2>
      <p className="mt-1 text-sm text-slate-600">Silahkan Transfer ke salah satu rekening berikut</p>
      <div className="mt-3 flex flex-wrap gap-x-10 gap-y-4">
        {DEPOSIT_ACCOUNTS.map((account) => (
          <div key={account.accountNumber}>
            <div className="text-sm font-extrabold text-slate-900">{account.bank}</div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">No. Rekening</div>
            <div className="font-mono text-lg font-bold tracking-wide text-slate-900">{account.accountNumber}</div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Atas Nama</div>
            <div className="text-sm font-semibold text-slate-800">{account.holder}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
