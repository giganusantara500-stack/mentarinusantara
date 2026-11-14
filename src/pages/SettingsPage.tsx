import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useMyWallet, roleToUi } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { formatRupiah, formatTanggal, initials } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import { User, Mail, Calendar, Save, CheckCircle2 } from "lucide-react";

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { wallet } = useMyWallet();
  const [name, setName] = useState(profile?.full_name || "");
  const [city, setCity] = useState(profile?.city || "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!profile) return null;
  const role = roleToUi(profile.role);
  const displayName = profile.full_name || profile.email;
  const balance = wallet ? Number(wallet.balance) : 0;

  const save = async () => {
    setBusy(true);
    setError("");
    const updated = await supabase.auth.updateUser({ data: { city: city.trim() } });
    if (updated.error) {
      setBusy(false);
      setError(updated.error.message);
      return;
    }
    if (name.trim() && name.trim() !== profile.full_name) {
      const { error: rpcErr } = await supabase.rpc("admin_update_own_profile", { p_full_name: name.trim() });
      if (rpcErr) setError("Kota tersimpan. Nama belum berubah.");
    }
    setBusy(false);
    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <PageContainer>
      <PageHeader title="Pengaturan Akun" description="Kelola profil dan informasi akun Anda." />

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardBody className="text-center">
            <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center text-white text-xl font-bold bg-slate-900">
              {initials(displayName)}
            </div>
            <h3 className="text-base font-semibold text-slate-900 mt-3">{displayName}</h3>
            <div className="mt-1"><Badge tone="blue">{ROLE_LABELS[role]}</Badge></div>
            <div className="mt-5 space-y-2 text-left">
              <InfoRow icon={Mail} label="Email" value={profile.email} />
              <InfoRow icon={Calendar} label="Bergabung" value={formatTanggal(profile.created_at)} />
            </div>
            <div className="mt-4 p-3 rounded-xl bg-slate-50 text-center">
              <div className="text-xs text-slate-500">Saldo</div>
              <div className="text-lg font-bold text-slate-900">{formatRupiah(balance)}</div>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Edit Profil" subtitle="Perubahan disimpan ke database." />
          <CardBody className="space-y-4">
            {error && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
            <Field label="Nama Lengkap">
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={name} onChange={(e) => setName(e.target.value)} className="pl-9" />
              </div>
            </Field>
            <Field label="Kota / Wilayah" hint="Muncul di bawah nama platform, misalnya Mitra Sragen.">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="cth: Sragen" />
            </Field>
            <Field label="Email">
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={profile.email} disabled className="pl-9 bg-slate-50 text-slate-500" />
              </div>
            </Field>
            <p className="text-xs text-slate-400">Email tidak dapat diubah. Hubungi Super Admin jika perlu mengubah email.</p>
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={save} disabled={busy}><Save size={16} /> {busy ? "Menyimpan..." : "Simpan Perubahan"}</Button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                  <CheckCircle2 size={16} /> Tersimpan
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <Icon size={15} className="text-slate-400 shrink-0" />
      <span className="text-slate-500 w-20 text-xs">{label}</span>
      <span className="text-slate-800 font-medium truncate">{value}</span>
    </div>
  );
}
