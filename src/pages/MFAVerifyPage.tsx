import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { ShieldCheck, AlertCircle, KeyRound } from "lucide-react";

export function MFAVerifyPage() {
  const { signOut, challengeMFA, verifyMFAChallenge } = useAuth();
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      // Ambil factor verified pertama, buat challenge
      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
      if (fErr) { setError(fErr.message); return; }
      const totp = (factors?.totp ?? []).find((f) => f.status === "verified");
      if (!totp) { setError("Tidak ada faktor TOTP terdaftar."); return; }
      const { data, error: cErr } = await challengeMFA(totp.id);
      if (cErr) { setError(cErr); return; }
      setChallengeId(data!.challengeId);
    })();
  }, [challengeMFA]);

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!challengeId) { setError("Challenge belum siap."); return; }
    setLoading(true);
    const res = await verifyMFAChallenge(challengeId, code.trim());
    setLoading(false);
    if (res.error) setError(res.error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
            <ShieldCheck size={28} className="text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Verifikasi Dua Langkah</h1>
          <p className="text-sm text-slate-500 mt-1">Masukkan kode 6 digit dari aplikasi authenticator Anda.</p>
        </div>
        <form onSubmit={onVerify} className="space-y-4">
          <Field label="Kode Authenticator">
            <div className="relative">
              <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="pl-9 text-center text-lg tracking-widest font-mono"
                inputMode="numeric"
                autoFocus
                required
              />
            </div>
          </Field>
          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <Button type="submit" fullWidth size="lg" disabled={loading || code.length !== 6}>
            {loading ? "Memverifikasi..." : "Verifikasi"}
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
