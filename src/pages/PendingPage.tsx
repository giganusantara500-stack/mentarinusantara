import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Form";
import { ShieldCheck, Clock, XCircle, Mail } from "lucide-react";

export function PendingPage() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const [roleChoice, setRoleChoice] = useState("mitra");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const status = profile?.status ?? "pending";
  const role = profile?.role ?? "pending";
  const needsRole = status !== "suspended" && (role === "pending" || !profile);

  const saveRole = async () => {
    setError("");
    setBusy(true);
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      setError("Sesi tidak valid. Silakan masuk ulang.");
      setBusy(false);
      return;
    }
    const response = await fetch("/api/assign-role", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: roleChoice }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error || "Peran gagal disimpan.");
      setBusy(false);
      return;
    }
    await refreshProfile();
    setBusy(false);
  };

  const icon = status === "suspended"
    ? <XCircle size={28} className="text-rose-600" />
    : needsRole
      ? <ShieldCheck size={28} className="text-violet-600" />
      : <Clock size={28} className="text-amber-600" />;

  const title = status === "suspended"
    ? "Akun Dinonaktifkan"
    : needsRole
      ? "Tentukan Peran Akun"
      : "Akses Terbatas";

  const desc = status === "suspended"
    ? "Akun Anda telah dinonaktifkan oleh administrator. Hubungi Super Admin untuk informasi."
    : needsRole
      ? "Peran akun ini belum tersimpan. Pilih Mitra, Sub Mitra, atau Loket agar akun langsung aktif."
      : "Akun Anda aktif tetapi perannya belum dapat dibuka. Hubungi Super Admin.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
          {icon}
        </div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500 mt-2">{desc}</p>
        {user?.email && (
          <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg">
            <Mail size={13} /> {user.email}
          </div>
        )}
        {needsRole && (
          <form
            className="mt-6 space-y-4 text-left"
            onSubmit={(event) => {
              event.preventDefault();
              void saveRole();
            }}
          >
            <Field label="Peran">
              <Select value={roleChoice} onChange={(event) => setRoleChoice(event.target.value)}>
                <option value="mitra">Mitra</option>
                <option value="submitra">Sub Mitra</option>
                <option value="loket">Loket</option>
              </Select>
            </Field>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <Button type="submit" fullWidth disabled={busy}>{busy ? "Menyimpan..." : "Aktifkan akun"}</Button>
          </form>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="outline" onClick={() => signOut()}>Keluar</Button>
        </div>
      </div>
    </div>
  );
}
