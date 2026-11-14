import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Form";

export function KolektifPage() {
  const [numbers, setNumbers] = useState("");
  const [saved, setSaved] = useState<string[]>([]);

  const save = () => {
    const rows = numbers.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    setSaved(rows);
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm space-y-4">
      <div>
        <h1 className="text-base font-semibold text-slate-900">Kolektif</h1>
        <p className="text-sm text-slate-500 mt-1">Catat beberapa nomor pelanggan sekaligus untuk tagihan kolektif di loket ini.</p>
      </div>
      <Field label="Nomor pelanggan" hint="Satu nomor tiap baris.">
        <Textarea rows={6} value={numbers} onChange={(event) => setNumbers(event.target.value)} placeholder={"081234567890\n12345678901"} />
      </Field>
      <Button onClick={save}>Simpan Daftar Kolektif</Button>
      {saved.length > 0 && (
        <div className="text-sm text-slate-600">{saved.length} nomor tersimpan di sesi loket ini.</div>
      )}
    </div>
  );
}
