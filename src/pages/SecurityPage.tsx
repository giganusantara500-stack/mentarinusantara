import { useEffect, useState } from "react";
import { useAuth, mfaIssuer, roleUsesMfa } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { ShieldCheck, KeyRound, QrCode, AlertCircle, Trash2, Plus, CheckCircle2, Mail, User as UserIcon, Lock } from "lucide-react";

export function SecurityPage() {
  const { enrollMFA, verifyMFAEnroll, unenrollMFA, getEnrolledFactors, user, profile, signOut } = useAuth();
  const [factors, setFactors] = useState<any[]>([]);
  const [loadingFactors, setLoadingFactors] = useState(true);

  // Setup modal state
  const [showSetup, setShowSetup] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupStep, setSetupStep] = useState<"qr" | "verify">("qr");

  // Unenroll modal
  const [unrollFactor, setUnrollFactor] = useState<any | null>(null);
  const [unrollCode, setUnrollCode] = useState("");
  const [unrollError, setUnrollError] = useState("");

  const loadFactors = async () => {
    setLoadingFactors(true);
    const { data } = await getEnrolledFactors();
    setFactors(data);
    setLoadingFactors(false);
  };

  useEffect(() => { loadFactors(); }, []);

  const startEnroll = async () => {
    setSetupError("");
    setCode("");
    setSetupStep("qr");
    const res = await enrollMFA();
    if (res.error) { setSetupError(res.error); return; }
    setQrCode(res.data!.qrCode);
    setSecret(res.data!.secret);
    setFactorId(res.data!.id);
    setShowSetup(true);
  };

  const confirmEnroll = async () => {
    setSetupError("");
    const res = await verifyMFAEnroll(factorId, code.trim());
    if (res.error) { setSetupError(res.error); return; }
    setShowSetup(false);
    setCode("");
    loadFactors();
  };

  const doUnenroll = async () => {
    if (!unrollFactor) return;
    setUnrollError("");
    const res = await unenrollMFA(unrollFactor.id, unrollCode.trim());
    if (res.error) { setUnrollError(res.error); return; }
    setUnrollFactor(null);
    setUnrollCode("");
    loadFactors();
  };

  const issuer = mfaIssuer(profile?.role);
  const showMfa = roleUsesMfa(profile?.role);
  const verified = factors.filter((f) => f.status === "verified");

  // Ganti password state
  const [showPwd, setShowPwd] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  const changePassword = async () => {
    setPwdError("");
    setPwdSuccess(false);
    if (newPwd.length < 6) { setPwdError("Password minimal 6 karakter."); return; }
    if (newPwd !== confirmPwd) { setPwdError("Konfirmasi password tidak cocok."); return; }
    setPwdLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setPwdLoading(false);
    if (error) {
      setPwdError(error.message);
    } else {
      setPwdSuccess(true);
      setNewPwd(""); setConfirmPwd("");
      setTimeout(() => setPwdSuccess(false), 3000);
    }
  };

  return (
    <div className="w-full min-w-0">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-blue-600" /> Profil &amp; Keamanan
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {showMfa
            ? "Kelola profil, verifikasi dua langkah (2FA), dan password akun Anda."
            : "Kelola profil dan password akun Anda. Peran ini masuk hanya dengan username dan password."}
        </p>
      </div>

      {/* Profil ringkas */}
      <Card className="mb-5">
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-lg font-bold">
              {(profile?.full_name || user?.email || "SA").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-slate-900">{profile?.full_name || profile?.username || "Akun"}</div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><Mail size={12} /> {user?.email}</span>
                {user?.email_confirmed_at
                  ? <Badge tone="success">Email terverifikasi</Badge>
                  : <Badge tone="warning">Email belum terverifikasi</Badge>}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {showMfa && (
      <Card className="mb-5">
        <CardBody>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${verified.length > 0 ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                <KeyRound size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Verifikasi Dua Langkah (TOTP)</h3>
                  {verified.length > 0 ? <Badge tone="success"><CheckCircle2 size={11} /> Aktif</Badge> : <Badge tone="warning">Belum aktif</Badge>}
                </div>
                <p className="text-sm text-slate-500 mt-1 max-w-md">
                  Wajib untuk peran ini. Aplikasi authenticator menampilkan penerbit <b>{issuer}</b> dan kode OTP 6 digit.
                </p>
              </div>
            </div>
            <Button onClick={startEnroll} disabled={verified.length >= 1}>
              <Plus size={16} /> {verified.length >= 1 ? "Sudah Aktif" : "Aktifkan 2FA"}
            </Button>
          </div>
          {setupError && !showSetup && (
            <div className="mt-3 flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{setupError}</span>
            </div>
          )}
        </CardBody>
      </Card>
      )}

      {showMfa && (
      <Card>
        <CardHeader title="Faktor Keamanan Terdaftar" subtitle="Daftar perangkat authenticator yang terhubung" />
        <div className="divide-y divide-slate-100">
          {loadingFactors && <div className="p-6 text-sm text-slate-500">Memuat...</div>}
          {!loadingFactors && factors.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">Belum ada faktor keamanan terdaftar.</div>
          )}
          {factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                  <KeyRound size={16} className="text-slate-500" />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-800">{f.friendly_name || "Mentari"}</div>
                  <div className="text-xs text-slate-500">
                    {f.friendly_name ?? "Perangkat authenticator"} • Dibuat {new Date(f.created_at).toLocaleDateString("id-ID")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={f.status === "verified" ? "success" : "warning"}>
                  {f.status === "verified" ? "Terverifikasi" : "Belum verifikasi"}
                </Badge>
                <button
                  onClick={() => { setUnrollFactor(f); setUnrollCode(""); setUnrollError(""); }}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  title="Hapus faktor"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      )}

      {/* Ganti password */}
      <Card className="mt-6">
        <CardHeader title="Ganti Password" subtitle="Password baru minimal 6 karakter" />
        <CardBody>
          <div className="grid w-full gap-4 sm:grid-cols-2">
            <Field label="Password Baru">
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="pl-9" />
              </div>
            </Field>
            <Field label="Konfirmasi Password Baru">
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className="pl-9" />
              </div>
            </Field>
          </div>
          {pwdError && (
            <div className="mt-3 flex w-full items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{pwdError}</span>
            </div>
          )}
          {pwdSuccess && (
            <div className="mt-3 flex w-full items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} /> Password berhasil diperbarui.
            </div>
          )}
          <div className="mt-4">
            <Button onClick={changePassword} disabled={pwdLoading}>
              {pwdLoading ? "Menyimpan..." : "Perbarui Password"}
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="mt-6">
        <Button variant="outline" onClick={() => signOut()}>Keluar dari akun</Button>
      </div>

      {/* Setup modal */}
      <Modal
        open={showSetup}
        onClose={() => setShowSetup(false)}
        title="Aktifkan Verifikasi Dua Langkah"
        subtitle={issuer ? `Aplikasi authenticator akan menampilkan penerbit ${issuer} dan kode 6 digit` : "Pindai QR code dengan aplikasi authenticator Anda"}
        footer={
          setupStep === "qr" ? (
            <Button onClick={() => setSetupStep("verify")}>Saya sudah pindai</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setShowSetup(false)}>Batal</Button>
              <Button onClick={confirmEnroll} disabled={code.length !== 6}>Verifikasi & Aktifkan</Button>
            </>
          )
        }
      >
        {setupStep === "qr" ? (
          <div className="text-center">
            <div className="flex justify-center mb-4 bg-white p-4 rounded-xl border border-slate-200">
              <img src={qrCode} alt="QR Code TOTP" className="w-56 h-56" />
            </div>
            <p className="text-sm text-slate-600 mb-3">
              Pindai QR code ini. Di aplikasi authenticator, akun akan tercatat sebagai <b>{issuer}</b> dan menampilkan kode OTP 6 digit.
            </p>
            <div className="text-left">
              <div className="text-xs text-slate-500 mb-1">Atau masukkan kode manual ini:</div>
              <div className="font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 break-all select-all">
                {secret}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Masukkan kode 6 digit yang muncul di aplikasi authenticator Anda untuk mengaktifkan 2FA.</p>
            <Field label="Kode Verifikasi">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="text-center text-lg tracking-widest font-mono"
                inputMode="numeric"
                autoFocus
              />
            </Field>
            {setupError && (
              <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{setupError}</span>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Unenroll modal */}
      <Modal
        open={!!unrollFactor}
        onClose={() => setUnrollFactor(null)}
        title="Hapus Faktor Keamanan"
        subtitle="Verifikasi ulang untuk menghapus"
        footer={
          <>
            <Button variant="outline" onClick={() => setUnrollFactor(null)}>Batal</Button>
            <Button variant="danger" onClick={doUnenroll} disabled={unrollCode.length !== 6}>Hapus</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>Menghapus 2FA akan membuat akun Anda kurang aman. Masukkan kode authenticator saat ini untuk konfirmasi.</span>
          </div>
          <Field label="Kode Authenticator Saat Ini">
            <Input
              value={unrollCode}
              onChange={(e) => setUnrollCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="text-center text-lg tracking-widest font-mono"
              inputMode="numeric"
              autoFocus
            />
          </Field>
          {unrollError && (
            <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{unrollError}</span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
