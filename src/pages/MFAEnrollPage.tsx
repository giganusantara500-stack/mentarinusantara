import { useEffect, useState } from "react";
import { mfaIssuer, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { AlertCircle, KeyRound, ShieldCheck } from "lucide-react";

export function MFAEnrollPage() {
  const { enrollMFA, verifyMFAEnroll, signOut, profile } = useAuth();
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const issuer = mfaIssuer(profile?.role);

  useEffect(() => {
    let stop = false;
    (async () => {
      const listed = await supabase.auth.mfa.listFactors();
      const pending = (listed.data?.totp ?? []).filter((factor) => factor.status !== "verified");
      await Promise.all(pending.map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })));
      const enrolled = await enrollMFA();
      if (stop) return;
      if (enrolled.error || !enrolled.data) {
        setError(enrolled.error || "Kode QR 2FA gagal dibuat.");
        return;
      }
      setQrCode(enrolled.data.qrCode);
      setSecret(enrolled.data.secret);
      setFactorId(enrolled.data.id);
    })();
    return () => { stop = true; };
  }, [enrollMFA]);

  const onVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!factorId) {
      setError("Kode QR belum siap.");
      return;
    }
    setLoading(true);
    const result = await verifyMFAEnroll(factorId, code.trim());
    setLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
            <ShieldCheck size={28} className="text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Aktifkan 2FA</h1>
          <p className="mt-1 text-sm text-slate-500">Pindai QR atau masukkan kunci rahasia di aplikasi authenticator, lalu verifikasi kode OTP sebelum membuka dashboard.</p>
        </div>
        {qrCode ? (
          <form onSubmit={onVerify} className="space-y-4">
            <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-4">
              <img src={qrCode} alt="QR code authenticator" className="h-56 w-56" />
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">Kunci rahasia {issuer ? `untuk penerbit ${issuer}` : ""}</div>
              <div className="select-all break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm">{secret}</div>
            </div>
            <Field label="Kode OTP">
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="pl-9 text-center font-mono text-lg tracking-widest"
                  inputMode="numeric"
                  autoFocus
                  required
                />
              </div>
            </Field>
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" fullWidth size="lg" disabled={loading || code.length !== 6}>
              {loading ? "Memverifikasi..." : "Verifikasi dan lanjutkan"}
            </Button>
          </form>
        ) : (
          <p className="text-center text-sm text-slate-500">{error || "Menyiapkan kode QR..."}</p>
        )}
        <div className="mt-5 text-center">
          <button type="button" onClick={() => signOut()} className="text-sm text-slate-500 hover:text-slate-700">Keluar</button>
        </div>
      </div>
    </div>
  );
}
