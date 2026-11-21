import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { LOKET_VERSION_LABEL, PLATFORM_NAME } from "@/lib/brand";
import { LOKET_HOME, MONITOR_HOME } from "@/lib/access";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Zap, User, Lock, AlertCircle, ArrowLeft, KeyRound, Eye, EyeOff } from "lucide-react";

export function LoginPage({ variant }: { variant: "monitor" | "loket" }) {
  const { signIn, recoverPassword } = useAuth();
  const [loginInput, setLoginInput] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "recover">("login");
  const [recoverSent, setRecoverSent] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState("");
  const loketWindow = variant === "loket";

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const input = loginInput.trim();
    let loginEmail = input;

    if (input && !isEmail(input)) {
      const username = input.toLowerCase();
      const { data: found, error: lookupErr } = await supabase.rpc("lookup_email_by_username", { p_username: username });
      const usernameExists = found === true || (Array.isArray(found) && found.length > 0);
      if (lookupErr || !usernameExists) {
        setError(lookupErr ? "Gagal memverifikasi pengguna. Coba lagi." : "Username tidak ditemukan.");
        setLoading(false);
        return;
      }
      loginEmail = username === "giganusantara"
        ? "gigamentarinusantara@gmail.com"
        : `${username}@gigamentarinusantara.id`;
    }

    const res = await signIn(loginEmail, password);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    window.location.hash = variant === "loket" ? LOKET_HOME : MONITOR_HOME;
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

  const errorBox = error ? (
    <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
      <AlertCircle size={14} className="shrink-0 mt-0.5" />
      <span>{error}</span>
    </div>
  ) : null;

  const recoverBlock = recoverSent ? (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={16} />
        <b>Password baru terkirim</b>
      </div>
      <p className="text-emerald-700">Buka email dari Mentari Nusantara. Gunakan password sementara untuk masuk, lalu segera ganti setelah login.</p>
    </div>
  ) : (
    <form onSubmit={onRecover} className="space-y-4">
      <Field label="Email">
        <div className="relative">
          <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input type="email" value={recoverEmail} onChange={(e) => setRecoverEmail(e.target.value)} placeholder="nama@gigamentarinusantara.id" className="pl-9" required autoFocus />
        </div>
      </Field>
      {errorBox}
      <Button type="submit" fullWidth size="lg" disabled={loading}>
        {loading ? "Mengirim..." : "Kirim Password Baru"}
      </Button>
    </form>
  );

  if (loketWindow) {
    return (
      <div className="min-h-screen bg-neutral-100 lg:grid lg:grid-cols-[minmax(280px,42%)_1fr]">
        <aside className="flex flex-col justify-between bg-neutral-950 px-8 py-10 text-white">
          <div>
            <div className="mb-8 h-1.5 w-24 rounded-full bg-amber-400" />
            <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-300">Loket</p>
            <h1 className="mt-3 text-4xl font-black leading-tight">Selamat Datang</h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-amber-50/80">Meja kasir untuk transaksi, kolektif, dan saldo loket.</p>
            <p className="mt-4 text-xs font-semibold text-amber-200">{LOKET_VERSION_LABEL}</p>
          </div>
        </aside>
        <main className="flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-8 shadow-xl">
            {mode === "login" ? (
              <>
                <h2 className="text-lg font-black text-neutral-950">Masuk Loket</h2>
                <p className="mt-1 text-sm text-slate-500">Username dan password meja loket.</p>
                <form onSubmit={onSubmit} className="mt-6 space-y-4">
                  <Field label="Username">
                    <div className="relative">
                      <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input type="text" value={loginInput} onChange={(e) => setLoginInput(e.target.value)} placeholder="Username" className="h-11 pl-9" required autoFocus />
                    </div>
                  </Field>
                  <Field label="Password">
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <Input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="h-11 pl-9 pr-11" required />
                      <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" aria-label={showPassword ? "Sembunyikan password" : "Lihat password"}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </Field>
                  {errorBox}
                  <button type="submit" disabled={loading} className="h-12 w-full rounded-lg bg-neutral-950 text-sm font-black tracking-wide text-amber-300 disabled:opacity-60">
                    {loading ? "MEMPROSES" : "LOGIN"}
                  </button>
                </form>
                <div className="mt-5 text-sm">
                  <button type="button" onClick={() => { setMode("recover"); setError(""); setRecoverSent(false); }} className="text-slate-500 hover:text-slate-800">Lupa kata sandi?</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-black text-neutral-950">Pemulihan Kata Sandi</h2>
                <div className="mt-6">{recoverBlock}</div>
                <button type="button" onClick={() => { setMode("login"); setError(""); }} className="mt-5 inline-flex items-center gap-1.5 text-sm text-slate-600">
                  <ArrowLeft size={14} /> Kembali ke login
                </button>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-purple-950 via-violet-900 to-purple-800 p-4">
      <div className="absolute left-0 top-0 h-96 w-96 -translate-x-1/3 -translate-y-1/3 rounded-full bg-purple-500/10 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-96 w-96 translate-x-1/3 translate-y-1/3 rounded-full bg-violet-400/10 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-400 to-violet-500 shadow-lg shadow-purple-900/50">
            <Zap size={26} className="text-white" fill="white" />
          </div>
          <h1 className="text-center text-2xl font-bold tracking-tight text-white">{PLATFORM_NAME}</h1>
          <p className="mt-1 text-xs uppercase tracking-widest text-purple-300">Monitoring</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-2xl">
          {mode === "login" ? (
            <>
              <div className="mb-6 text-center">
                <h2 className="text-xl font-bold text-slate-900">Dashboard</h2>
                <p className="mt-1 text-sm text-slate-500">Monitoring & Management System</p>
              </div>
              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="Username">
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input type="text" value={loginInput} onChange={(e) => setLoginInput(e.target.value)} placeholder="Masukkan username" className="pl-9" required autoFocus />
                  </div>
                </Field>
                <Field label="Password">
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-9" required />
                  </div>
                </Field>
                {errorBox}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 py-3 text-base font-semibold text-white shadow-lg shadow-purple-200 transition-all hover:from-purple-700 hover:to-violet-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
                <p className="mt-1 text-sm text-slate-500">Kami mengirim password sementara ke email terdaftar Anda.</p>
              </div>
              {recoverBlock}
              <div className="mt-5 text-center">
                <button onClick={() => { setMode("login"); setError(""); }} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
                  <ArrowLeft size={14} /> Kembali ke login
                </button>
              </div>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-purple-400">&copy; 2026 {PLATFORM_NAME}. Semua hak dilindungi.</p>
      </div>
    </div>
  );
}
