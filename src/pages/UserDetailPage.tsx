import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/ui/Common";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatRupiah, formatTanggal, formatTanggalSingkat, formatWaktu, initials } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import {
  ArrowLeft, User, Mail, Phone, MapPin, Building2, Calendar, Shield,
  Network, Users, Wallet, TrendingUp, Receipt, Coins, Clock, History,
  FileClock, LogIn, Store,
} from "lucide-react";
import type { Role } from "@/lib/types";

interface DetailData {
  profile: {
    id: string;
    email: string;
    full_name: string;
    username: string | null;
    phone: string | null;
    business_name: string | null;
    address: string | null;
    role: string;
    parent_id: string | null;
    status: string;
    must_change_password: boolean;
    loket_type: string | null;
    deleted_at: string | null;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
    created_by: string | null;
  };
  parent: {
    id: string;
    email: string;
    full_name: string;
    username: string | null;
    role: string;
    status: string;
    business_name: string | null;
  } | null;
  grandparent: {
    id: string;
    email: string;
    full_name: string;
    username: string | null;
    role: string;
    status: string;
    business_name: string | null;
  } | null;
  wallet: {
    id: string;
    balance: number;
    pending_balance: number;
    status: string;
  } | null;
  total_deposit: number;
  total_tx_count: number;
  total_tx_volume: number;
  total_cms: number;
  total_os: number;
  children: {
    id: string;
    full_name: string;
    email: string;
    username: string | null;
    role: string;
    status: string;
    business_name: string | null;
    phone: string | null;
    created_at: string;
    deleted_at: string | null;
  }[];
  recent_transactions: {
    id: string;
    invoice_code: string;
    product_name: string;
    category: string;
    customer_number: string;
    amount: number;
    profit: number;
    status: string;
    created_at: string;
    completed_at: string | null;
  }[];
  recent_mutations: {
    id: string;
    entry_type: string;
    amount: number;
    balance_after: number;
    reference_type: string | null;
    description: string | null;
    created_at: string;
  }[];
  account_changes: {
    id: string;
    action: string;
    actor_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
  }[];
}

const statusTone: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  pending: "warning",
  suspended: "danger",
};
const statusLabel: Record<string, string> = {
  active: "Aktif",
  pending: "Pending",
  suspended: "Ditangguhkan",
};

const loketTypeLabel: Record<string, string> = {
  konter: "Konter",
  minimarket: "Minimarket",
  agen: "Agen",
  lainnya: "Lainnya",
};

const actionLabels: Record<string, string> = {
  create_subuser: "Pembuatan akun",
  update_user_details: "Perubahan detail akun",
  toggle_user_status: "Perubahan status akun",
  soft_delete_user: "Penghapusan akun (soft delete)",
  restore_user: "Pemulihan akun",
  update_user_email: "Perubahan email",
  admin_password_reset_request: "Permintaan reset password",
  admin_topup_wallet: "Top up saldo",
  admin_adjust_wallet: "Penyesuaian saldo",
};

const roleColors: Record<string, string> = {
  super_admin: "#1e293b",
  mitra: "#0369a1",
  submitra: "#0f766e",
  loket: "#be185d",
};

interface Props {
  userId: string;
  onBack: () => void;
}

export function UserDetailPage({ userId, onBack }: Props) {
  const { profile: currentUser } = useAuth();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      const session = await supabase.auth.getSession();
      const response = await fetch(`/api/user-detail?id=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}` },
      });
      const body = await response.json().catch(() => null);
      if (!active) return;
      if (!response.ok) {
        setError(body?.error || "Detail akun gagal dimuat.");
        setData(null);
      } else {
        setData(body as DetailData);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [userId]);

  if (loading) {
    return (
      <PageContainer>
        <div className="py-20 text-center text-sm text-slate-500">Memuat detail pengguna...</div>
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer>
        <PageHeader title="Detail Pengguna" />
        <Card className="p-8 text-center">
          <p className="text-sm text-rose-600">{error || "Data tidak ditemukan."}</p>
          <Button variant="outline" onClick={onBack} className="mt-4">
            <ArrowLeft size={16} /> Kembali
          </Button>
        </Card>
      </PageContainer>
    );
  }

  const p = data.profile;
  const roleUi = dbRoleToAppRole(p.role as any) as Role;
  const isDeleted = p.deleted_at !== null;

  return (
    <PageContainer>
      <div className="mb-4">
        <Button variant="ghost" onClick={onBack} size="sm">
          <ArrowLeft size={16} /> Kembali ke daftar
        </Button>
      </div>

      <PageHeader
        title={p.full_name || p.email}
        description={`Detail lengkap ${ROLE_LABELS[roleUi]}`}
      >
        <Badge tone={statusTone[p.status] ?? "neutral"}>
          <Shield size={11} /> {statusLabel[p.status] ?? p.status}
        </Badge>
        {isDeleted && <Badge tone="danger">Dihapus</Badge>}
      </PageHeader>

      {/* Section 1-4: Identitas, Akun, Kontak, Status */}
      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader title="Identitas & Profil" />
          <CardBody>
            <div className="flex items-center gap-4 mb-5">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-white text-lg font-semibold shrink-0"
                style={{ backgroundColor: roleColors[p.role] || "#1e293b" }}
              >
                {initials(p.full_name || p.email)}
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold text-slate-900 truncate">{p.full_name || "Tanpa nama"}</div>
                <div className="text-sm text-slate-500">{ROLE_LABELS[roleUi]}</div>
                {p.role === "loket" && p.loket_type && (
                  <div className="mt-1">
                    <Badge tone="info">
                      <Store size={11} /> {loketTypeLabel[p.loket_type] ?? p.loket_type}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <InfoRow icon={User} label="Nama Lengkap" value={p.full_name || "—"} />
              <InfoRow icon={Building2} label="Nama Usaha" value={p.business_name || "—"} />
              <InfoRow icon={MapPin} label="Alamat" value={p.address || "—"} />
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader title="Akun & Kontak" />
          <CardBody>
            <div className="space-y-3">
              <InfoRow icon={Mail} label="Email" value={p.email} />
              <InfoRow icon={User} label="Username" value={p.username || "—"} />
              <InfoRow icon={Phone} label="Nomor HP" value={p.phone || "—"} />
              <InfoRow
                icon={Shield}
                label="Status Akun"
                value={
                  <Badge tone={statusTone[p.status] ?? "neutral"}>
                    {statusLabel[p.status] ?? p.status}
                  </Badge>
                }
              />
              <InfoRow
                icon={Shield}
                label="Password Sementara"
                value={p.must_change_password ? "Wajib diganti" : "Sudah diganti"}
              />
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader title="Jaringan & Akun Induk" />
          <CardBody>
            <div className="space-y-3">
              {data.parent ? (
                <InfoRow
                  icon={Network}
                  label={`Induk: ${ROLE_LABELS[dbRoleToAppRole(data.parent.role) as Role]}`}
                  value={
                    <div>
                      <div className="font-medium text-slate-800">{data.parent.full_name || data.parent.email}</div>
                      {data.parent.business_name && (
                        <div className="text-xs text-slate-500">{data.parent.business_name}</div>
                      )}
                    </div>
                  }
                />
              ) : (
                <InfoRow icon={Network} label="Akun Induk" value="—" />
              )}
              {data.grandparent && (
                <InfoRow
                  icon={Network}
                  label={`Induk Atas: ${ROLE_LABELS[dbRoleToAppRole(data.grandparent.role) as Role]}`}
                  value={
                    <div>
                      <div className="font-medium text-slate-800">{data.grandparent.full_name || data.grandparent.email}</div>
                      {data.grandparent.business_name && (
                        <div className="text-xs text-slate-500">{data.grandparent.business_name}</div>
                      )}
                    </div>
                  }
                />
              )}
              <InfoRow
                icon={Users}
                label="Jumlah Bawahan Langsung"
                value={`${data.children.length} akun`}
              />
              <InfoRow
                icon={Calendar}
                label="Tanggal Pendaftaran"
                value={formatTanggal(p.created_at)}
              />
              <InfoRow
                icon={LogIn}
                label="Login Terakhir"
                value={p.last_login_at ? formatWaktu(p.last_login_at) : "Belum pernah login"}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Section 7-11: Saldo, Deposit, Transaksi, CMS, OS */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <SummaryCard
          icon={Wallet}
          tone="blue"
          label="Saldo Saat Ini"
          value={formatRupiah(data.wallet?.balance ?? 0)}
          hint={data.wallet ? `Pending: ${formatRupiah(data.wallet.pending_balance)}` : "Wallet belum dibuat"}
        />
        <SummaryCard
          icon={TrendingUp}
          tone="emerald"
          label="Total Deposit"
          value={formatRupiah(data.total_deposit)}
        />
        <SummaryCard
          icon={Receipt}
          tone="slate"
          label="Total Transaksi"
          value={String(data.total_tx_count)}
          hint={`Volume: ${formatRupiah(data.total_tx_volume)}`}
        />
        <SummaryCard
          icon={Coins}
          tone="amber"
          label="Total CMS"
          value={formatRupiah(data.total_cms)}
          hint="Keuntungan dari transaksi sukses"
        />
        <SummaryCard
          icon={Clock}
          tone="rose"
          label="Total OS"
          value={formatRupiah(data.total_os)}
          hint="Outstanding (transaksi pending)"
        />
      </div>

      {/* Section 6: Daftar akun bawahan */}
      <Card className="mb-6">
        <CardHeader
          title="Daftar Akun Bawahan"
          subtitle={`${data.children.length} akun langsung di bawah ${p.full_name || p.email}`}
        />
        {data.children.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Belum ada akun bawahan.</div>
        ) : (
          <div className="w-full max-w-full">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-y border-slate-100">
                  <th className="px-2.5 py-2 font-semibold break-words">Nama</th>
                  <th className="px-2.5 py-2 font-semibold break-words">Peran</th>
                  <th className="px-2.5 py-2 font-semibold break-words">Email</th>
                  <th className="px-2.5 py-2 font-semibold break-words">Telepon</th>
                  <th className="px-2.5 py-2 font-semibold break-words">Bergabung</th>
                  <th className="px-2.5 py-2 font-semibold break-words">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.children.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="px-2.5 py-2 break-words">
                      <div className="font-medium text-slate-800">{c.full_name || c.email}</div>
                      {c.business_name && <div className="text-xs text-slate-500">{c.business_name}</div>}
                    </td>
                    <td className="px-2.5 py-2">
                      <Badge tone="blue">{ROLE_LABELS[dbRoleToAppRole(c.role) as Role]}</Badge>
                    </td>
                    <td className="px-2.5 py-2 break-words text-slate-600">{c.email}</td>
                    <td className="px-2.5 py-2 text-slate-600">{c.phone || "—"}</td>
                    <td className="px-2.5 py-2 text-xs text-slate-500">{formatTanggalSingkat(c.created_at)}</td>
                    <td className="px-2.5 py-2">
                      <Badge tone={statusTone[c.status] ?? "neutral"}>
                        {statusLabel[c.status] ?? c.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Section 12-13: Riwayat transaksi & mutasi */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader
            title="Riwayat Transaksi"
            subtitle="10 transaksi terakhir"
          />
          {data.recent_transactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Belum ada transaksi.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recent_transactions.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold bg-slate-100 text-slate-600 shrink-0">
                    {t.product_name.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{t.product_name}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {t.invoice_code} • {t.customer_number}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-slate-800">{formatRupiah(t.amount)}</div>
                    <div className="text-[11px] text-slate-400">{formatWaktu(t.created_at)}</div>
                  </div>
                  <Badge tone={t.status === "success" ? "success" : t.status === "pending" ? "warning" : "danger"}>
                    {t.status === "success" ? "Sukses" : t.status === "pending" ? "Pending" : "Gagal"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Riwayat Mutasi Saldo"
            subtitle="10 mutasi saldo terakhir"
          />
          {data.recent_mutations.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Belum ada mutasi saldo.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recent_mutations.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      m.entry_type === "credit" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                    }`}
                  >
                    {m.entry_type === "credit" ? <TrendingUp size={16} /> : <ArrowLeft size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {m.description || (m.entry_type === "credit" ? "Kredit" : "Debit")}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{formatWaktu(m.created_at)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-semibold ${m.entry_type === "credit" ? "text-emerald-600" : "text-rose-600"}`}>
                      {m.entry_type === "credit" ? "+" : "-"}{formatRupiah(m.amount)}
                    </div>
                    <div className="text-[11px] text-slate-400">Saldo: {formatRupiah(m.balance_after)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Section 16: Riwayat perubahan akun */}
      <Card className="mb-6">
        <CardHeader
          title="Riwayat Perubahan Akun"
          subtitle="10 perubahan terakhir yang tercatat di audit log"
        />
        {data.account_changes.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Belum ada perubahan tercatat.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.account_changes.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50/60">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100 text-slate-600 shrink-0">
                  <FileClock size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">
                    {actionLabels[a.action] ?? a.action}
                  </div>
                  {a.details && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      {Object.entries(a.details).slice(0, 4).map(([k, v]) => (
                        <span key={k} className="mr-3">
                          <span className="text-slate-400">{k}:</span>{" "}
                          {typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "…"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-400 shrink-0">{formatWaktu(a.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Section 14-15: Tanggal daftar & login terakhir (sudah di kartu atas, ringkas di sini) */}
      <Card>
        <CardHeader title="Informasi Waktu" />
        <CardBody>
          <div className="grid sm:grid-cols-3 gap-4">
            <InfoRow icon={Calendar} label="Tanggal Pendaftaran" value={formatTanggal(p.created_at)} />
            <InfoRow icon={LogIn} label="Login Terakhir" value={p.last_login_at ? formatWaktu(p.last_login_at) : "Belum pernah"} />
            <InfoRow icon={History} label="Update Terakhir" value={formatWaktu(p.updated_at)} />
          </div>
        </CardBody>
      </Card>
    </PageContainer>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof User; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-sm font-medium text-slate-800 mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: string;
  tone: "blue" | "emerald" | "amber" | "rose" | "slate";
}) {
  const tones: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
          <div className="text-lg font-bold text-slate-900 mt-1 truncate">{value}</div>
          {hint && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{hint}</div>}
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
          <Icon size={17} />
        </div>
      </div>
    </Card>
  );
}
