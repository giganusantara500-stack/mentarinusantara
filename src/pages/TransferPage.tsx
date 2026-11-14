import { useState } from "react";
import { useMyWallet } from "@/lib/hooks";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";

export function TransferPage() {
  const { wallet, loading } = useMyWallet();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm space-y-4">
      <div>
        <h1 className="text-base font-semibold text-slate-900">Transfer Uang</h1>
        <p className="text-sm text-slate-500 mt-1">Saldo loket {loading ? "—" : formatRupiah(Number(wallet?.balance ?? 0))}.</p>
      </div>
      <Field label="Rekening atau akun tujuan">
        <Input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Nomor tujuan" />
      </Field>
      <Field label="Nominal">
        <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))} placeholder="50000" />
      </Field>
      <Button
        onClick={() => setNote("Permintaan transfer tercatat di layar ini. Saldo belum berpindah karena kanal transfer provider belum terhubung.")}
        disabled={!destination.trim() || Number(amount) < 10000}
      >
        Buat Permintaan Transfer
      </Button>
      {note && <p className="text-sm text-slate-600">{note}</p>}
    </div>
  );
}
