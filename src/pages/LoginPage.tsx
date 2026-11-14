import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/brand";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Zap, User, Lock, AlertCircle, ArrowLeft, KeyRound, CheckCircle2 } from "lucide-react";

export function LoginPage() {
  const { signIn, recoverPassword } = useAuth();
  const [loginInput, setLoginInput] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "recover">("login");
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState("");

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const input = loginInput.trim();
    let loginEmail = input;

    if (input && !isEmail(input)) {
      const username = input.toLowerCase();
      const { data: lookupRows, error: lookupErr } = await supabase.rpc("lookup_email_by_username", { p_username: username });
      const row = Array.isArray(lookupRows) ? lookupRows[0] : lookupRows;
      if (!lookupErr && row?.email) {
        if (row.status === "suspended") {
          setError("Akun Anda dinonaktifkan. Hubungi administrator.");
          setLoading(false);
          return;
        }
        loginEmail = row.email;
      } else if (!lookupErr) {
        setError("Username tidak ditemukan.");
        setLoading(false);
        return;
      } else {
        const { data, error: profileErr } = await supabase
          .from("profiles")
          .select("username, role, is_active")
          .eq("username", username)
          .maybeSingle();
        if (profileErr) {
          setError("Gagal memverifikasi pengguna. Coba lagi.");
          setLoading(false);
          return;
        }
        if (!data) {
          setError("Username tidak ditemukan.");
          setLoading(false);
          return;
        }
        if (data.is_active === false) {
          setError("Akun Anda dinonaktifkan. Hubungi administrator.");
          setLoading(false);
          return;
        }
        loginEmail = data.username === "giganusantara"
          ? "gigamentarinusantara@gmail.com"
          : `${data.username}@gigamentarinusantara.id`;
      }
    }

    const res = await signIn(loginEmail, password);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    window.location.hash = "/dashboard";
  };

  const onRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await recoverPassword(recoverEmail.trim());
    setLoading(false);
    if (res.error) setError(res.error);
    else setRecoverSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-950 via-violet-900 to-purple-800 p-4 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl -translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-violet-400/10 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

      <div className="relative w-full max-w-md">
        {/* Logo header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-400 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-900/50 mb-3">
            <Zap size={26} className="text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight text-center">{PLATFORM_NAME}</h1>
          <p className="text-xs text-purple-300 uppercase tracking-widest mt-1">Platform PPOB</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {mode === "login" ? (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-xl font-bold text-slate-900">Masuk Akun</h2>
                <p className="text-sm text-slate-500 mt-1">Gunakan username dan kata sandi Anda.</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="Username">
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input type="text" value={loginInput} onChange={(e) => setLoginInput(e.target.value)} placeholder="Masukkan username" className="pl-9" required autoFocus />
                  </div>
                </Field>
                <Field label="Kata Sandi">
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-9" required />
                  </div>
                </Field>
                {error && (
                  <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 text-white font-semibold text-base shadow-lg shadow-purple-200 hover:from-purple-700 hover:to-violet-700 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? "Memproses..." : "Masuk"}
                </button>
              </form>

              <div className="mt-5 text-center">
                <button onClick={() => { setMode("recover"); setError(""); setRecoverSent(false); }} className="text-sm text-purple-600 hover:text-purple-700 hover:underline">
                  Lupa kata sandi?
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-xl font-bold text-slate-900">Pemulihan Kata Sandi</h2>
                <p className="text-sm text-slate-500 mt-1">Kami akan mengirim kode sandi sementara ke email Anda.</p>
              </div>
              {recoverSent ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
                  <div className="flex items-center gap-2 mb-1">
                    <KeyRound size={16} />
                    <b>Kode sandi sementara terkirim</b>
                  </div>
                  <p className="text-emerald-700">Kode sandi sementara telah dikirim ke email Anda. Login dengan kode sandi tersebut, lalu ganti dengan kata sandi baru Anda.</p>
                </div>
              ) : (
                <form onSubmit={onRecover} className="space-y-4">
                  <Field label="Email">
                    <div className="relative">
                      <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input type="email" value={recoverEmail} onChange={(e) => setRecoverEmail(e.target.value)} placeholder="nama@gigamentarinusantara.id" className="pl-9" required autoFocus />
                    </div>
                  </Field>
                  {error && (
                    <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}
                  <Button type="submit" fullWidth size="lg" disabled={loading}>
                    {loading ? "Mengirim..." : "Kirim Kode Sandi Sementara"}
                  </Button>
                </form>
              )}
              <div className="mt-5 text-center">
                <button onClick={() => { setMode("login"); setError(""); }} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
                  <ArrowLeft size={14} /> Kembali ke login
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-purple-400 mt-6">&copy; 2026 {PLATFORM_NAME}. Semua hak dilindungi.</p>
      </div>
    </div>
  );
}
