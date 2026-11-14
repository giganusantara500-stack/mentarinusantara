import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { ShieldCheck, AlertCircle, CheckCircle2, KeyRound, Lock, User as UserIcon, Mail, ArrowLeft } from "lucide-react";
import { supabase } from "../lib/supabase";

const SETUP_EMAIL = "gigamentarinusantara@gmail.com";

export function SetupSuperAdminPage() {
  const [token, setToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signUp({
        email: SETUP_EMAIL,
        password,
        options: {
          data: { 
            full_name: fullName, 
            role: 'super_admin' 
          }
        }
      });

      if (authError) throw authError;

      setSuccess("Akun Super Admin berhasil dibuat! Silakan kembali ke halaman masuk.");
      setToken("");
      setPassword("");
      setConfirm("");
    } catch (err: any) {
      setError(err.message || "Terjadi kesalahan saat penyiapan akun.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
            <ShieldCheck size={28} className="text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Penyiapan Super Admin Pertama</h1>
          <p className="text-sm text-slate-500 mt-1">Halaman ini hanya berfungsi satu kali, sebelum akun Super Admin dibuat.</p>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-3">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
            <a href="#/" className="flex items-center justify-center gap-1.5 text-sm text-blue-600 hover:underline">
              <ArrowLeft size={14} /> Lanjut ke halaman masuk
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Email">
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={SETUP_EMAIL} readOnly className="pl-9 bg-slate-50" />
              </div>
            </Field>
            <Field label="Nama Lengkap">
              <div className="relative">
                <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nama Super Admin" className="pl-9" required />
              </div>
            </Field>
            <Field label="Token Bootstrap">
              <div className="relative">
                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="pl-9" autoComplete="off" placeholder="Bebas (di-bypass lokal)" required />
              </div>
            </Field>
            <Field label="Kata Sandi">
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" autoComplete="new-password" required />
              </div>
            </Field>
            <Field label="Konfirmasi Kata Sandi">
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="pl-9" autoComplete="new-password" required />
              </div>
            </Field>
            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" fullWidth size="lg" disabled={loading}>
              {loading ? "Memproses..." : "Buat Akun Super Admin"}
            </Button>
            <a href="#/" className="flex items-center justify-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
              <ArrowLeft size={14} /> Kembali ke halaman masuk
            </a>
          </form>
        )}
      </div>
    </div>
  );
}