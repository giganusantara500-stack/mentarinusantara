import { useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { canonicalRole, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { KeyRound, Lock, AlertCircle, ShieldCheck } from "lucide-react";

export function ForcePasswordChangePage() {
  const { signOut, refreshProfile, profile } = useAuth();
  const needsMfa = canonicalRole(profile?.role) === "mitra" || canonicalRole(profile?.role) === "submitra";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }
    if (password !== confirm) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }
    setLoading(true);
    const { data: fnData, error: fnErr } = await supabase.functions.invoke("change-password", {
      body: { password },
    });
    if (fnErr) {
      let msg = fnErr.message;
      if (fnErr instanceof FunctionsHttpError) {
        try {
          const errBody = await fnErr.context.json();
          msg = errBody?.error || msg;
        } catch { /* keep default */ }
      }
      setLoading(false);
      setError(msg);
      return;
    }
    if (!fnData || fnData.success !== true) {
      setLoading(false);
      setError(typeof fnData?.error === "string" ? fnData.error : "Server tidak mengonfirmasi penggantian password.");
      return;
    }
    await refreshProfile();
    setLoading(false);
    setError("Password tersimpan, tetapi aplikasi belum berpindah. Muat ulang halaman.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-purple-50 flex items-center justify-center mb-3">
            <KeyRound size={28} className="text-purple-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Ganti Password Awal</h1>
          <p className="text-sm text-slate-500 mt-1">
            Anda masuk dengan password sementara. Buat password baru sebelum melanjutkan{needsMfa ? ", lalu aktifkan 2FA dengan QR dan kode OTP." : " ke dashboard."}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Password Baru" hint="Minimal 6 karakter.">
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" autoComplete="new-password" minLength={6} required autoFocus />
            </div>
          </Field>
          <Field label="Konfirmasi Password Baru" hint="Harus sama dengan password baru.">
            <div className="relative">
              <ShieldCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="pl-9" autoComplete="new-password" minLength={6} required />
            </div>
          </Field>
          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <Button type="submit" fullWidth size="lg" disabled={loading}>
            {loading ? "Menyimpan..." : "Simpan Password Baru"}
          </Button>
        </form>
        <div className="mt-5 text-center">
          <button onClick={() => signOut()} className="text-sm text-slate-500 hover:text-slate-700">
            Keluar
          </button>
        </div>
      </div>
    </div>
  );
}
