import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { PLATFORM_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import {
  Zap, Lock, AlertCircle, CheckCircle2, Eye, EyeOff,
  Shield, ArrowLeft,
} from "lucide-react";

interface PasswordCheck {
  label: string;
  passed: boolean;
}

function checkPasswordStrength(pw: string): PasswordCheck[] {
  return [
    { label: "Minimal 6 karakter", passed: pw.length >= 6 },
    { label: "Mengandung angka", passed: /[0-9]/.test(pw) },
  ];
}

function strengthScore(pw: string): { score: number; label: string; color: string } {
  const checks = checkPasswordStrength(pw);
  const score = checks.filter((c) => c.passed).length;
  if (score <= 0) return { score, label: "Sangat lemah", color: "bg-rose-500" };
  if (score === 1) return { score, label: "Cukup", color: "bg-amber-400" };
  return { score, label: "Kuat", color: "bg-emerald-500" };
}

export function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [validSession, setValidSession] = useState(false);

  // Verify that the recovery session is valid before allowing password change
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setValidSession(!!data.session);
      setVerifying(false);
    })();
    return () => { active = false; };
  }, []);

  const checks = checkPasswordStrength(password);
  const strength = strengthScore(password);
  const allPassed = checks.every((c) => c.passed);
  const matchError = confirm.length > 0 && password !== confirm;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!allPassed) {
      setError("Kata sandi minimal 6 karakter dan harus mengandung angka.");
      return;
    }
    if (password !== confirm) {
      setError("Konfirmasi kata sandi tidak cocok.");
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    // Sign out so user must log in with the new password
    setTimeout(() => {
      supabase.auth.signOut();
      window.location.hash = "#/login";
    }, 2500);
  };

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Shield size={24} className="text-slate-400" />
          </div>
          <p className="text-sm text-slate-500">Memverifikasi sesi pemulihan...</p>
        </div>
      </div>
    );
  }

  if (!validSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Zap size={20} className="text-white" fill="white" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-900">{PLATFORM_NAME}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">Reset Kata Sandi</div>
            </div>
          </div>
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-3">
              <AlertCircle size={28} className="text-rose-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Tautan Tidak Valid</h2>
            <p className="text-sm text-slate-500 mt-1 mb-5">
              Tautan reset kata sandi sudah kedaluwarsa atau telah digunakan. Silakan minta tautan baru.
            </p>
            <a href="/#/login" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <ArrowLeft size={14} /> Ke halaman login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <Zap size={20} className="text-white" fill="white" />
          </div>
          <div>
            <div className="text-base font-bold text-slate-900">{PLATFORM_NAME}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest">Reset Kata Sandi</div>
          </div>
        </div>

        {done ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={28} className="text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Kata Sandi Diperbarui</h2>
            <p className="text-sm text-slate-500 mt-1">
              Kata sandi berhasil diubah. Anda akan diarahkan ke halaman login.
            </p>
            <a href="/#/login" className="inline-block mt-4 text-sm text-blue-600 hover:underline">
              Ke halaman login sekarang
            </a>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Buat Kata Sandi Baru</h1>
            <p className="text-sm text-slate-500 mb-5">
              Masukkan kata sandi baru. Minimal 6 karakter dan harus mengandung angka.
            </p>

            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Kata Sandi Baru">
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-10"
                    required
                    autoFocus
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={showPw ? "Sembunyikan" : "Tampilkan"}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${strength.color}`}
                        style={{ width: `${(strength.score / 2) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-slate-600 w-24 text-right">{strength.label}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {checks.map((c) => (
                      <div key={c.label} className="flex items-center gap-2 text-xs">
                        {c.passed ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border border-slate-300 shrink-0" />
                        )}
                        <span className={c.passed ? "text-slate-700" : "text-slate-400"}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Field label="Konfirmasi Kata Sandi">
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="pl-9 pr-10"
                    required
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={showConfirm ? "Sembunyikan" : "Tampilkan"}
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              {matchError && (
                <div className="flex items-center gap-2 text-xs text-rose-600">
                  <AlertCircle size={13} /> Kata sandi tidak cocok.
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                fullWidth
                size="lg"
                disabled={loading || !allPassed || !!matchError || !confirm}
              >
                {loading ? "Menyimpan..." : "Simpan Kata Sandi Baru"}
              </Button>
            </form>

            <div className="mt-5 text-center">
              <a href="/#/login" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
                <ArrowLeft size={14} /> Kembali ke login
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
