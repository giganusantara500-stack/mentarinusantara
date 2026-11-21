import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, dbRoleToAppRole } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/brand";
import { useProfiles, useWallets, roleToUi } from "@/lib/hooks";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader, SearchInput } from "@/components/ui/Common";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { formatRupiah, formatTanggalSingkat } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/supabase";
import type { Role } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/nav";
import {
  Plus, Pencil, Power, Eye, AlertCircle, CheckCircle2,
  Trash2, Download, KeyRound, Copy, Ban, ShieldCheck,
} from "lucide-react";

interface Props {
  targetRole: Role;
  onNavigate: (path: string) => void;
}

const statusTone: Record<string, "success" | "warning" | "danger"> = {
  active: "success",
  pending: "warning",
  suspended: "danger",
};
const statusLabel: Record<string, string> = {
  active: "Aktif",
  pending: "Pending",
  suspended: "Nonaktif",
};

const loketTypeLabel: Record<string, string> = {
  konter: "Konter",
  minimarket: "Minimarket",
  agen: "Agen",
  lainnya: "Lainnya",
};

const ITEMS_PER_PAGE = 10;

interface CreatedAccount {
  name: string;
  username: string;
  email: string;
  userId: string;
  emailSent: boolean;
  emailError: string | null;
  tempPassword: string | null;
  loketCode: string | null;
  mfaActive: boolean;
}

function plainResetEmailError(value: unknown) {
  let text = typeof value === "string" ? value.trim() : "";
  if (/<!doctype|<html/i.test(text)) text = "Layanan email menolak pengiriman.";
  if (/\.env|belum ada di file/i.test(text)) text = "Pengiriman email ditolak oleh layanan email Supabase.";
  return text || "Email belum terkirim. Fungsi tidak memberi alasan.";
}

async function invokePayload(data: unknown, error: unknown) {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body && typeof body === "object") return body as Record<string, unknown>;
    } catch {
      // respons bukan JSON
    }
  }
  return null;
}

function isHtmlDocument(raw: string) {
  return /^\s*(<!doctype|<html)/i.test(raw);
}

function accountPayload(data: Record<string, unknown> | null) {
  if (!data || data.success !== true) return null;
  const userId = String(data.user_id || data.userId || data.id || "");
  if (!userId) return null;
  return { ...data, user_id: userId };
}

function readableApiError(status: number, data: { error?: string; message?: string; msg?: string } | null, raw: string) {
  const text = String(data?.error || data?.message || data?.msg || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!data || isHtmlDocument(raw)) {
    if (status === 404) return "Layanan belum dikonfigurasi. Username dan password tidak dapat dibuat saat ini.";
    return "Server tidak mengembalikan data akun. Coba lagi.";
  }
  return text || `HTTP ${status}`;
}

function emptyAddForm(parentId: string) {
  return {
    fullName: "",
    username: "",
    email: "",
    phone: "",
    businessName: "",
    address: "",
    city: "",
    status: "active" as "active" | "suspended",
    parentId,
    loketType: "konter" as string,
    tempPassword: "",
  };
}

function emptyEditForm() {
  return {
    fullName: "",
    username: "",
    email: "",
    phone: "",
    businessName: "",
    address: "",
    city: "",
    parentId: "",
    status: "active" as Profile["status"],
    loketType: "",
  };
}

export function ManageUsersPage({ targetRole, onNavigate }: Props) {
  const { profile, isSuperAdmin } = useAuth();
  const { profiles, loading, error: profilesError, refresh } = useProfiles();
  const { wallets } = useWallets();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("semua");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [parentFilter, setParentFilter] = useState<string>("");
  const [loketTypeFilter, setLoketTypeFilter] = useState<string>("semua");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Confirm dialogs
  const [confirmSuspend, setConfirmSuspend] = useState<Profile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [confirmReset, setConfirmReset] = useState<Profile | null>(null);
  const [resetResult, setResetResult] = useState<{
    name: string;
    email: string;
    tempPassword: string | null;
    emailSent: boolean;
    emailError: string | null;
  } | null>(null);

  const editForm = useState(emptyEditForm());
  const addForm = useState(emptyAddForm(""));

  const myRole = profile ? dbRoleToAppRole(profile.role) : null;

  const allowedTargets: Role[] = useMemo(() => {
    if (myRole === "superadmin") return ["mitra", "loket"];
    if (myRole === "mitra") return ["submitra", "loket"];
    if (myRole === "submitra") return ["loket"];
    return [];
  }, [myRole]);

  const targetRoleDb =
    targetRole === "mitra" ? "mitra"
    : targetRole === "submitra" ? "submitra"
    : "loket";

  const parentRoleLabel =
    targetRole === "mitra" ? "Super Admin"
    : targetRole === "submitra" ? "Mitra"
    : "Mitra / Sub Mitra";

  const availableParents = useMemo(() => {
    if (!profile) return [];
    if (targetRole === "mitra") return myRole === "superadmin" ? [profile] : [];
    if (targetRole === "submitra") return myRole === "mitra" ? [profile] : [];
    if (targetRole === "loket") {
      if (myRole === "submitra") return [profile];
      if (myRole === "mitra") return [profile, ...profiles.filter((p) => (p.role as string) === "submitra" || (p.role as string) === "sub_mitra")];
      return [];
    }
    return [];
  }, [profiles, targetRole, profile, myRole]);

  useEffect(() => {
    if (!showAdd || !profile) return;
    if (addForm[0].parentId) return;
    const next = myRole === "mitra" || myRole === "submitra" || myRole === "superadmin"
      ? profile.id
      : availableParents[0]?.id;
    if (!next) return;
    addForm[1]((current) => (current.parentId ? current : { ...current, parentId: next }));
  }, [showAdd, profile, availableParents, addForm[0].parentId, addForm[1], myRole]);

  // Parent filter options (for filtering the table by parent relationship)
  const parentFilterOptions = useMemo(() => {
    if (targetRole === "mitra" || !profile) return [];
    if (targetRole === "submitra") return myRole === "mitra" ? [profile] : profiles.filter((p) => p.role === "mitra");
    const parents = profiles.filter((p) => (p.role as string) === "mitra" || (p.role as string) === "submitra" || (p.role as string) === "sub_mitra");
    if ((myRole === "mitra" || myRole === "submitra") && !parents.some((p) => p.id === profile.id)) {
      return [profile, ...parents];
    }
    return parents;
  }, [profiles, targetRole, profile, myRole]);

  const visibleTargets = useMemo(() => {
    return profiles.filter((p) => {
      const role = (p.role as string) === "sub_mitra" ? "submitra" : p.role;
      if (role !== targetRoleDb) return false;
      if (!profile || myRole === "superadmin") return true;
      return p.parent_id === profile.id || p.created_by === profile.id || p.mitra_id === profile.id || profiles.some((parent) => parent.id === p.parent_id && (parent.parent_id === profile.id || parent.created_by === profile.id || parent.id === profile.id));
    });
  }, [profiles, targetRoleDb, profile, myRole]);

  const filtered = useMemo(() => {
    return visibleTargets.filter((p) => {
      if (statusFilter !== "semua" && p.status !== statusFilter) return false;
      if (parentFilter && p.parent_id !== parentFilter) return false;
      if (targetRole === "loket" && loketTypeFilter !== "semua" && (p.loket_type ?? "lainnya") !== loketTypeFilter) return false;
      if (dateFilter) {
        const pDate = p.created_at.slice(0, 10);
        if (pDate !== dateFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          (p.full_name || "").toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          (p.username || "").toLowerCase().includes(q) ||
          (p.phone || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [visibleTargets, statusFilter, parentFilter, dateFilter, search, targetRole, loketTypeFilter]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const currentPage = Math.min(page, totalPages || 1);
  const paginated = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  // Reset page when filters change
  const onFilterChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  if (!profile) return null;

  const canCreate = allowedTargets.includes(targetRole);
  const canView = canCreate || (myRole === "superadmin" && targetRole === "loket");
  if (!canView) {
    return (
      <PageContainer>
        <Card className="p-8 text-center">
          <p className="text-sm text-slate-600">Anda tidak memiliki akses ke halaman ini.</p>
        </Card>
      </PageContainer>
    );
  }

  const getWalletBalance = (uid: string) => {
    const w = wallets.find((w) => w.user_id === uid);
    return w ? Number(w.balance) : 0;
  };

  const getParentName = (p: Profile) => {
    if (!p.parent_id) return "—";
    const parent = p.parent_id === profile.id ? profile : profiles.find((x) => x.id === p.parent_id);
    return parent ? (parent.full_name || parent.email) : "—";
  };

  const getMitraName = (p: Profile) => {
    if (!p.parent_id) return "—";
    const parent = p.parent_id === profile.id ? profile : profiles.find((x) => x.id === p.parent_id);
    if (!parent) return "—";
    if (parent.role === "mitra") return parent.full_name || parent.username || parent.email;
    if (parent.parent_id) {
      const grandparent = parent.parent_id === profile.id
        ? profile
        : profiles.find((x) => x.id === parent.parent_id);
      if (grandparent && grandparent.role === "mitra") return grandparent.full_name || grandparent.username || grandparent.email;
    }
    return "—";
  };

  const getChildCount = (uid: string) => {
    return profiles.filter((p) => p.parent_id === uid).length;
  };

  const openEdit = (p: Profile) => {
    setError("");
    setEditing(p);
    editForm[1]({
      fullName: p.full_name ?? "",
      username: p.username ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      businessName: p.business_name ?? "",
      address: p.address ?? "",
      city: p.city ?? "",
      parentId: p.parent_id ?? "",
      status: p.status,
      loketType: p.loket_type ?? "",
    });
  };

  const doCreate = async () => {
    const [af, setAf] = addForm;
    const parentId = af.parentId || profile.id;
    if (!af.fullName.trim()) { setError("Nama wajib diisi."); return; }
    if (!af.phone.trim()) { setError("Nomor HP wajib diisi."); return; }
    if (!af.city.trim()) { setError("Kota atau wilayah wajib diisi."); return; }
    if (!af.email.trim()) { setError("Email wajib diisi."); return; }
    if (targetRole !== "loket") {
      const required = [af.businessName, af.address];
      if (required.some((v) => !v.trim())) { setError("Nama usaha dan alamat wajib diisi."); return; }
    }
    if (!parentId) { setError("Atasan langsung belum ditentukan."); return; }

    setBusy(true);
    setError("");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) { setError("Sesi tidak valid. Silakan login ulang."); setBusy(false); return; }
    const payload = {
      role: targetRole === "submitra" ? "sub_mitra" : targetRoleDb,
      fullName: af.fullName,
      full_name: af.fullName,
      email: af.email,
      phone: af.phone,
      businessName: af.businessName,
      business_name: af.businessName,
      address: af.address,
      city: af.city,
      status: af.status,
      parentId,
      parent_id: parentId,
      loketType: targetRole === "loket" ? af.loketType : undefined,
      loket_type: targetRole === "loket" ? af.loketType : undefined,
    };
    const finish = (data: Record<string, unknown>) => {
      setCreated({
        name: af.fullName.trim(),
        username: String(data.username || af.username || "").trim().toLowerCase(),
        email: af.email.trim().toLowerCase(),
        userId: String(data.user_id),
        emailSent: !!data.email_sent,
        emailError: data.email_error && /<!doctype|<html/i.test(String(data.email_error))
          ? "Layanan email belum dikonfigurasi. Username dan password sementara tetap tersedia di layar."
          : (data.email_error as string | null) ?? null,
        tempPassword: (data.temp_password as string | null) ?? null,
        loketCode: (data.loket_code as string | null) ?? null,
        mfaActive: targetRole === "mitra" || targetRole === "submitra" || data.mfa_required === true,
      });
      setAf(emptyAddForm(profile.id));
      setShowAdd(false);
      setPage(1);
      setBusy(false);
      refresh();
    };
    const createWithFunction = async () => {
      const { data, error } = await supabase.functions.invoke("create-subuser", { body: payload });
      const body = await invokePayload(data, error);
      const account = accountPayload(body);
      if (account) return account;
      const message = String(body?.error || body?.message || (error as { message?: string } | null)?.message || "Fungsi pembuatan akun tidak mengembalikan data akun.");
      throw new Error(message.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    };
    try {
      const response = await fetch("/api/create-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const raw = await response.text();
      const data = raw ? (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; } })() : null;
      const account = accountPayload(data);
      if (response.ok && account) {
        finish(account);
        return;
      }
      if (!data || isHtmlDocument(raw)) {
        finish(await createWithFunction());
        return;
      }
      const detail = readableApiError(response.status, data as { error?: string; message?: string; msg?: string }, raw);
      console.error("Supabase/API tambah akun gagal:", { status: response.status, body: data });
      window.alert(detail);
      setError(detail);
      setBusy(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Koneksi ke server gagal.";
      console.error("Tambah akun gagal:", error);
      window.alert(message);
      setError(message);
      setBusy(false);
    }
  };

  const doEdit = async () => {
    if (!editing) return;
    const [ef] = editForm;
    setBusy(true);
    setError("");

    if (ef.email && ef.email.toLowerCase() !== (editing.email || "").toLowerCase() && !ef.email) {
      setError("Email tidak boleh kosong.");
      setBusy(false);
      return;
    }

    const session = await supabase.auth.getSession();
    const response = await fetch("/api/update-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        userId: editing.id,
        fullName: ef.fullName,
        username: ef.username,
        phone: ef.phone,
        businessName: ef.businessName,
        address: ef.address,
        city: ef.city,
        parentId: ef.parentId || null,
        status: ef.status,
        loketType: targetRole === "loket" ? (ef.loketType || null) : null,
        email: ef.email || null,
      }),
    });
    const saved = await response.json().catch(() => null);
    if (!response.ok) { setError(saved?.error || "Detail akun gagal disimpan."); setBusy(false); return; }
    setEditing(null);
    setBusy(false);
    refresh();
  };

  const doToggleStatus = async () => {
    if (!confirmSuspend) return;
    setBusy(true);
    const session = await supabase.auth.getSession();
    const response = await fetch("/api/account-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.data.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ userId: confirmSuspend.id, active: confirmSuspend.status !== "active" }),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { alert(body?.error || "Status akun gagal diubah."); return; }
    setConfirmSuspend(null);
    refresh();
  };

  const doSoftDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc("admin_soft_delete_user", { p_target_uid: confirmDelete.id });
    setBusy(false);
    if (rpcErr) { alert(rpcErr.message); return; }
    setConfirmDelete(null);
    refresh();
  };

  const doRestoreUser = async (p: Profile) => {
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc("admin_restore_user", { p_target_uid: p.id });
    setBusy(false);
    if (rpcErr) { alert(rpcErr.message); return; }
    refresh();
  };

  const doResetPassword = async () => {
    if (!confirmReset) return;
    const email = confirmReset.email.trim().toLowerCase();
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("reset-password-temp", {
      body: { email, user_id: confirmReset.id },
    });
    const payload = await invokePayload(data, error);
    setBusy(false);
    const tempPassword = typeof payload?.temp_password === "string" ? payload.temp_password : "";
    if (!tempPassword) {
      const detail = payload?.error
        ? plainResetEmailError(payload.error)
        : "Reset password gagal. Fungsi tidak mengembalikan password sementara.";
      console.error("Reset password gagal:", payload ?? error);
      alert(detail);
      return;
    }
    const sentTo = typeof payload?.email === "string" && payload.email.includes("@") ? payload.email : email;
    const emailSent = payload?.email_sent === true;
    setConfirmReset(null);
    setResetResult({
      name: confirmReset.full_name || sentTo,
      email: sentTo,
      tempPassword,
      emailSent,
      emailError: emailSent ? null : plainResetEmailError(payload?.email_error || payload?.message),
    });
  };

  const exportCSV = () => {
    const headers: string[] = [];
    const rows: string[][] = [];

    if (targetRole === "mitra") {
      headers.push("Nama", "Username", "Email", "Nomor HP", "Jumlah Jaringan", "Saldo", "Tanggal Daftar", "Status");
      filtered.forEach((p) => {
        rows.push([
          p.full_name || "",
          p.username || "",
          p.email,
          p.phone || "",
          String(getChildCount(p.id)),
          String(getWalletBalance(p.id)),
          formatTanggalSingkat(p.created_at),
          statusLabel[p.status] ?? p.status,
        ]);
      });
    } else if (targetRole === "submitra") {
      headers.push("Nama", "Username", ...(myRole === "superadmin" ? ["Mitra Induk"] : []), "Email", "Nomor HP", "Jumlah Loket", "Saldo", "Tanggal Daftar", "Status");
      filtered.forEach((p) => {
        rows.push([
          p.full_name || "",
          p.username || "",
          ...(myRole === "superadmin" ? [getParentName(p)] : []),
          p.email,
          p.phone || "",
          String(getChildCount(p.id)),
          String(getWalletBalance(p.id)),
          formatTanggalSingkat(p.created_at),
          statusLabel[p.status] ?? p.status,
        ]);
      });
    } else {
      headers.push("Kode Loket", "Nama Loket", "Username", ...(myRole === "superadmin" ? ["Sub Mitra", "Mitra Induk"] : []), "Nomor HP", "Jenis Loket", "Saldo", "Tanggal Daftar", "Status");
      filtered.forEach((p) => {
        rows.push([
          p.loket_code || "",
          p.full_name || "",
          p.username || "",
          ...(myRole === "superadmin" ? [getParentName(p), getMitraName(p)] : []),
          p.phone || "",
          loketTypeLabel[p.loket_type ?? "lainnya"] ?? "Lainnya",
          String(getWalletBalance(p.id)),
          formatTanggalSingkat(p.created_at),
          statusLabel[p.status] ?? p.status,
        ]);
      });
    }

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${targetRole}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pageTitle =
    targetRole === "mitra" ? "Manajemen Mitra"
    : targetRole === "submitra" ? "Manajemen Sub Mitra"
    : "Manajemen Loket";

  const pageDesc =
    targetRole === "mitra" ? `Kelola seluruh mitra di jaringan ${PLATFORM_NAME}.`
    : targetRole === "submitra" ? "Kelola Sub Mitra di bawah jaringan Anda."
    : myRole === "submitra"
      ? "Kelola loket yang berada langsung di bawah Anda. Transaksinya ikut tercatat di rekap Anda."
      : "Kelola loket langsung di bawah Anda atau di bawah Sub Mitra dalam jaringan Anda.";

  // Build columns based on target role
  const nameColumn: Column<Profile> = {
    key: "name",
    header: targetRole === "loket" ? "Nama Loket" : "Nama",
    render: (p) => (
      <div className="py-0.5">
        <div className="text-sm font-semibold leading-5 text-slate-900">{p.full_name || p.username || p.email}</div>
        {targetRole === "loket" && <div className="text-xs leading-4 text-slate-500">{p.loket_code ? `Kode ${p.loket_code}` : (p.username || "")}</div>}
        {p.business_name && <div className="text-xs leading-4 text-slate-500">{p.business_name}</div>}
      </div>
    ),
  };

  const usernameColumn: Column<Profile> = {
    key: "username",
    header: "Username",
    render: (p) => <span className="text-sm text-slate-600">{p.username || "—"}</span>,
  };

  const emailColumn: Column<Profile> = {
    key: "email",
    header: "Email",
    render: (p) => <span className="text-sm text-slate-600">{p.email}</span>,
  };

  const phoneColumn: Column<Profile> = {
    key: "phone",
    header: "Nomor HP",
    render: (p) => <span className="text-sm text-slate-600">{p.phone || "—"}</span>,
  };

  const saldoColumn: Column<Profile> = {
    key: "saldo",
    header: "Saldo",
    render: (p) => <span className="text-sm font-semibold text-slate-800">{formatRupiah(getWalletBalance(p.id))}</span>,
    className: "text-right",
  };

  const dateColumn: Column<Profile> = {
    key: "joinedAt",
    header: "Tanggal Daftar",
    render: (p) => <span className="text-xs text-slate-500">{formatTanggalSingkat(p.created_at)}</span>,
  };

  const statusColumn: Column<Profile> = {
    key: "status",
    header: "Status",
    render: (p) => targetRole === "mitra" ? <Badge tone={statusTone[p.status]}>{statusLabel[p.status]}</Badge> : (
      <button
        type="button"
        onClick={() => setConfirmSuspend(p)}
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
      >
        {p.status === "active" ? "Aktif" : "Nonaktif"}
      </button>
    ),
  };

  const actionsColumn: Column<Profile> = {
    key: "actions",
    header: "Aksi",
    render: (p) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onNavigate(`/${targetRole}/detail/${p.id}`)}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-600 transition"
          title="Lihat detail"
        >
          <Eye size={15} />
        </button>
        <button
          onClick={() => openEdit(p)}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-600 transition"
          title="Edit"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={() => setConfirmReset(p)}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-amber-600 transition"
          title="Reset password"
        >
          <KeyRound size={15} />
        </button>
        {p.status === "active" ? (
          <button
            onClick={() => setConfirmSuspend(p)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-rose-600 transition"
            title="Nonaktifkan"
          >
            <Power size={15} />
          </button>
        ) : (
          <button
            onClick={() => setConfirmSuspend(p)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-emerald-600 transition"
            title="Aktifkan kembali"
          >
            <Power size={15} />
          </button>
        )}
        <button
          onClick={() => setConfirmDelete(p)}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-rose-600 transition"
          title="Hapus (soft delete)"
        >
          <Trash2 size={15} />
        </button>
      </div>
    ),
  };

  // Role-specific columns
  const columns = useMemo<Column<Profile>[]>(() => {
    if (targetRole === "mitra") {
      return [
        nameColumn,
        usernameColumn,
        emailColumn,
        phoneColumn,
        {
          key: "network",
          header: "Jumlah Jaringan",
          render: (p) => <Badge tone="blue">{getChildCount(p.id)} bawahan</Badge>,
        },
        saldoColumn,
        dateColumn,
        statusColumn,
        actionsColumn,
      ];
    }
    if (targetRole === "submitra") {
      return [
        nameColumn,
        usernameColumn,
        ...(myRole === "superadmin" ? [{
          key: "parent",
          header: "Mitra Induk",
          render: (p: Profile) => <span className="text-sm text-slate-600">{getParentName(p)}</span>,
        } satisfies Column<Profile>] : []),
        emailColumn,
        phoneColumn,
        {
          key: "loketCount",
          header: "Jumlah Loket",
          render: (p) => <Badge tone="blue">{getChildCount(p.id)} loket</Badge>,
        },
        saldoColumn,
        dateColumn,
        statusColumn,
        actionsColumn,
      ];
    }
    // loket — structured like pocer.shop: No, Mitra, Loket, Telepon, Jenis, Tanggal, Status, Blokir, Aksi
    const noColumn: Column<Profile> = {
      key: "no",
      header: "No",
      render: (_p, idx) => <span className="text-sm text-slate-400 font-mono">{(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}</span>,
    };
    const mitraColumn: Column<Profile> = {
      key: "mitra",
      header: "Mitra",
      render: (p) => (
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-700 truncate">{getMitraName(p)}</div>
          <div className="text-xs text-slate-400 truncate">{getParentName(p)}</div>
        </div>
      ),
    };
    const loketColumn: Column<Profile> = {
      key: "loket",
      header: "Loket",
      render: (p) => (
        <div className="py-0.5">
          <div className="text-sm font-semibold leading-5 text-slate-900">{p.full_name || p.username || "Loket"}</div>
          <div className="text-xs leading-4 text-slate-500">{p.loket_code ? `Kode ${p.loket_code}` : (p.username || "")}</div>
        </div>
      ),
    };
    const blokirColumn: Column<Profile> = {
      key: "blokir",
      header: "Blokir",
      render: (p) => {
        const blocked = p.status === "suspended";
        return (
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
            blocked
              ? "bg-rose-50 border-rose-200 text-rose-700"
              : "bg-slate-50 border-slate-200 text-slate-600")}>
            {blocked ? <Ban size={12} /> : <ShieldCheck size={12} />}
            {blocked ? "Diblokir" : "Normal"}
          </span>
        );
      },
    };
    return [
      noColumn,
      ...(myRole === "superadmin" ? [mitraColumn] satisfies Column<Profile>[] : []),
      loketColumn,
      phoneColumn,
      {
        key: "loketType",
        header: "Jenis",
        render: (p) => <Badge tone="info">{loketTypeLabel[p.loket_type ?? "lainnya"] ?? "Lainnya"}</Badge>,
      },
      dateColumn,
      statusColumn,
      blokirColumn,
      actionsColumn,
    ];
  }, [targetRole, profiles, wallets, myRole]);

  return (
    <PageContainer>
      <PageHeader title={pageTitle} description={pageDesc}>
        <Button variant="outline" onClick={exportCSV} disabled={filtered.length === 0}>
          <Download size={16} /> Ekspor
        </Button>
        {canCreate && (
        <Button
          onClick={() => {
            const parentId = profile.id;
            addForm[1](emptyAddForm(parentId));
            setError("");
            setShowAdd(true);
          }}
          disabled={targetRole !== "loket" && availableParents.length === 0}
        >
          <Plus size={16} /> Tambah {ROLE_LABELS[targetRole]}
        </Button>
        )}
      </PageHeader>
      {profilesError && <p className="mb-3 text-sm text-rose-600">{profilesError}</p>}

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <SearchInput value={search} onChange={onFilterChange(setSearch)} placeholder="Cari nama, email, username, HP..." />
          <div className="flex gap-2 flex-wrap">
            <Select value={statusFilter} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)} className="w-auto">
              <option value="semua">Semua status</option>
              <option value="active">Aktif</option>
              <option value="suspended">Nonaktif</option>
              {isSuperAdmin && <option value="pending">Pending</option>}
            </Select>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => onFilterChange(setDateFilter)(e.target.value)}
              className="w-auto"
              placeholder="Tanggal daftar"
            />
            {targetRole === "loket" && (
              <Select value={loketTypeFilter} onChange={(e) => onFilterChange(setLoketTypeFilter)(e.target.value)} className="w-auto">
                <option value="semua">Semua jenis</option>
                <option value="konter">Konter</option>
                <option value="minimarket">Minimarket</option>
                <option value="agen">Agen</option>
                <option value="lainnya">Lainnya</option>
              </Select>
            )}
            {parentFilterOptions.length > 0 && (
              <Select value={parentFilter} onChange={(e) => onFilterChange(setParentFilter)(e.target.value)} className="w-auto">
                <option value="">Semua {parentRoleLabel}</option>
                {parentFilterOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                ))}
              </Select>
            )}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader
          title={`Daftar ${ROLE_LABELS[targetRole]}`}
          subtitle={loading ? "Memuat..." : `${filtered.length} dari ${visibleTargets.length} ${ROLE_LABELS[targetRole].toLowerCase()}`}
        />
        <Table columns={columns} data={paginated} rowKey={(p) => p.id} empty={loading ? "Memuat data..." : "Belum ada data."} />
        <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      {/* Add modal */}
      <Modal
        open={showAdd}
        onClose={() => { setShowAdd(false); setError(""); }}
        title={`Tambah ${ROLE_LABELS[targetRole]}`}
        subtitle="Username diambil dari nama (huruf kecil tanpa spasi). Jika sudah ada, nomor urut ditambahkan. Password sementara 6 digit angka dibuat otomatis."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setShowAdd(false); setError(""); }}>Batal</Button>
            <Button onClick={doCreate} disabled={busy}>{busy ? "Memproses..." : "Buat Akun"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          {targetRole === "loket" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nama Loket"><Input value={addForm[0].fullName} onChange={(e) => addForm[1]({ ...addForm[0], fullName: e.target.value })} placeholder="cth: Loket Maju Jaya" /></Field>
                <Field label="Email"><Input type="email" value={addForm[0].email} onChange={(e) => addForm[1]({ ...addForm[0], email: e.target.value })} placeholder="nama@perusahaan.id" /></Field>
                <Field label="No HP"><Input type="tel" value={addForm[0].phone} onChange={(e) => addForm[1]({ ...addForm[0], phone: e.target.value })} placeholder="cth: 081234567890" /></Field>
                <Field label="Kota / Wilayah"><Input value={addForm[0].city} onChange={(e) => addForm[1]({ ...addForm[0], city: e.target.value })} placeholder="cth: Sragen" /></Field>
                <Field label="Jenis">
                  <Select value={addForm[0].loketType} onChange={(e) => addForm[1]({ ...addForm[0], loketType: e.target.value })}>
                    <option value="konter">Konter</option>
                    <option value="minimarket">Minimarket</option>
                    <option value="agen">Agen</option>
                    <option value="lainnya">Lainnya</option>
                  </Select>
                </Field>
              </div>
              {myRole === "mitra" && (
                <Field label="Penempatan loket" hint="Loket bisa langsung di bawah Mitra, atau di bawah Sub Mitra dalam jaringan Anda.">
                  <Select value={addForm[0].parentId} onChange={(e) => addForm[1]({ ...addForm[0], parentId: e.target.value })}>
                    {availableParents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id === profile.id ? "Langsung di bawah Anda" : (p.full_name || p.username || p.email)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {myRole === "superadmin" && (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  Loket ini tercatat langsung di bawah Super Admin. Kode unik 7 digit dibuat otomatis dan permanen.
                </p>
              )}
              {myRole === "submitra" && (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  Loket ini tercatat langsung di bawah akun Sub Mitra Anda.
                </p>
              )}
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Username mengikuti nama loket tanpa spasi. Jika nama itu sudah dipakai, sistem menambahkan nomor urut. Password sementara 6 digit angka.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nama Lengkap"><Input value={addForm[0].fullName} onChange={(e) => addForm[1]({ ...addForm[0], fullName: e.target.value })} placeholder="cth: Budi Santoso" /></Field>
                <Field label="Email"><Input type="email" value={addForm[0].email} onChange={(e) => addForm[1]({ ...addForm[0], email: e.target.value })} placeholder="nama@perusahaan.id" /></Field>
                <Field label="Nomor HP"><Input type="tel" value={addForm[0].phone} onChange={(e) => addForm[1]({ ...addForm[0], phone: e.target.value })} placeholder="cth: 081234567890" /></Field>
                <Field label="Nama Usaha"><Input value={addForm[0].businessName} onChange={(e) => addForm[1]({ ...addForm[0], businessName: e.target.value })} placeholder="cth: Toko Maju Jaya" /></Field>
                <Field label="Kota / Wilayah"><Input value={addForm[0].city} onChange={(e) => addForm[1]({ ...addForm[0], city: e.target.value })} placeholder="cth: Sragen" /></Field>
                <Field label="Status Akun">
                  <Select value={addForm[0].status} onChange={(e) => addForm[1]({ ...addForm[0], status: e.target.value as "active" | "suspended" })}>
                    <option value="active">Aktif</option>
                    <option value="suspended">Nonaktif</option>
                  </Select>
                </Field>
              </div>
              <Field label="Alamat"><Textarea rows={2} value={addForm[0].address} onChange={(e) => addForm[1]({ ...addForm[0], address: e.target.value })} placeholder="Alamat lengkap usaha" /></Field>
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Username mengikuti nama, misalnya Aris menjadi aris. Nama yang sama menjadi aris1, aris2, dan seterusnya. Password sementara selalu 6 digit angka.
              </p>
            </>
          )}
        </div>
      </Modal>

      {/* Created modal */}
      <Modal
        open={!!created}
        onClose={() => { setCreated(null); setError(""); }}
        title="Akun berhasil dibuat"
        subtitle={created?.name}
        footer={<Button variant="outline" onClick={() => { setCreated(null); setError(""); }}>Tutup</Button>}
      >
        {created && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
              <DetailRow label="Nama" value={created.name} />
              {created.loketCode && <DetailRow label="Kode Loket" value={created.loketCode} />}
              <DetailRow label="Email" value={created.email} />
            </div>
            <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Kredensial Login</div>
              <CopyableCredential label="Username" value={created.username || "—"} />
              <CopyableCredential label="Password Sementara" value={created.tempPassword || "—"} mono />
              <p className="text-xs text-slate-500">
                Password sementara berupa 6 digit angka. Berikan username dan password ini kepada pengguna, lalu minta diganti saat login pertama.
              </p>
              {created.mfaActive && (
                <p className="text-xs font-semibold text-amber-800">Login pertama wajib mengganti password, lalu mengaktifkan 2FA dengan memindai QR atau memasukkan kunci rahasia dan kode OTP.</p>
              )}
            </div>
            {created.emailSent ? (
              <div className="flex items-start gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                <span>Email berisi username dan password sementara sudah dikirim ke {created.email}.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{created.emailError || "Email belum terkirim. Salin password sementara di atas."}</span>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={() => { setEditing(null); setError(""); }}
        title={`Edit ${ROLE_LABELS[targetRole]}`}
        subtitle={editing?.email}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setEditing(null); setError(""); }}>Batal</Button>
            <Button onClick={doEdit} disabled={busy}>{busy ? "Memproses..." : "Simpan"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nama Lengkap"><Input value={editForm[0].fullName} onChange={(e) => editForm[1]({ ...editForm[0], fullName: e.target.value })} /></Field>
            <Field label="Username" hint="Huruf kecil, angka, titik, atau garis bawah."><Input value={editForm[0].username} onChange={(e) => editForm[1]({ ...editForm[0], username: e.target.value })} /></Field>
            <Field label="Email" hint="Jika email diubah, pengguna harus login dengan email baru."><Input type="email" value={editForm[0].email} onChange={(e) => editForm[1]({ ...editForm[0], email: e.target.value })} /></Field>
            <Field label="Nomor HP"><Input type="tel" value={editForm[0].phone} onChange={(e) => editForm[1]({ ...editForm[0], phone: e.target.value })} /></Field>
            <Field label="Nama Usaha"><Input value={editForm[0].businessName} onChange={(e) => editForm[1]({ ...editForm[0], businessName: e.target.value })} /></Field>
            <Field label="Kota / Wilayah"><Input value={editForm[0].city} onChange={(e) => editForm[1]({ ...editForm[0], city: e.target.value })} placeholder="cth: Sragen" /></Field>
            {targetRole === "loket" && (
              <Field label="Jenis Loket">
                <Select value={editForm[0].loketType} onChange={(e) => editForm[1]({ ...editForm[0], loketType: e.target.value })}>
                  <option value="">— Pilih —</option>
                  <option value="konter">Konter</option>
                  <option value="minimarket">Minimarket</option>
                  <option value="agen">Agen</option>
                  <option value="lainnya">Lainnya</option>
                </Select>
              </Field>
            )}
          </div>
          <Field label="Alamat"><Textarea rows={2} value={editForm[0].address} onChange={(e) => editForm[1]({ ...editForm[0], address: e.target.value })} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={`Atasan: ${parentRoleLabel}`}>
              <Select value={editForm[0].parentId} onChange={(e) => editForm[1]({ ...editForm[0], parentId: e.target.value })}>
                <option value="">— Pilih —</option>
                {availableParents.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                ))}
              </Select>
            </Field>
            <Field label="Status" hint="Tanpa transaksi atau aktivitas selama 30 hari, akun menjadi Nonaktif. Pilih Aktif untuk menghidupkan kembali.">
              <Select value={editForm[0].status} onChange={(e) => editForm[1]({ ...editForm[0], status: e.target.value as Profile["status"] })}>
                <option value="active">Aktif</option>
                <option value="suspended">Nonaktif</option>
                {isSuperAdmin && <option value="pending">Pending</option>}
              </Select>
            </Field>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            Untuk mengubah password pengguna, gunakan tombol Reset Password (ikon kunci) pada baris data.
          </div>
        </div>
      </Modal>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={!!confirmSuspend}
        title={confirmSuspend?.status === "active" ? "Nonaktifkan Akun" : "Aktifkan Kembali Akun"}
        message={
          confirmSuspend?.status === "active"
            ? `Yakin ingin menonaktifkan akun "${confirmSuspend?.full_name || confirmSuspend?.email}"? Akun tidak dapat login hingga diaktifkan kembali.`
            : `Yakin ingin mengaktifkan kembali akun "${confirmSuspend?.full_name || confirmSuspend?.email}"?`
        }
        confirmLabel={confirmSuspend?.status === "active" ? "Nonaktifkan" : "Aktifkan"}
        variant={confirmSuspend?.status === "active" ? "danger" : "primary"}
        onConfirm={doToggleStatus}
        onClose={() => setConfirmSuspend(null)}
        busy={busy}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Hapus Akun"
        message={`Yakin ingin menghapus akun "${confirmDelete?.full_name || confirmDelete?.email}"? Akun akan disembunyikan dari daftar, tetapi seluruh riwayat transaksi dan mutasi saldo tetap dipertahankan. Akun dapat dipulihkan kembali.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={doSoftDelete}
        onClose={() => setConfirmDelete(null)}
        busy={busy}
      />

      <ConfirmDialog
        open={!!confirmReset}
        title="Reset Password"
        message={`Reset password "${confirmReset?.full_name || confirmReset?.username || confirmReset?.email}"? Password sementara 6 digit akan tampil di layar ini. Email tetap dikirim jika alamatnya bisa menerima pesan.`}
        confirmLabel="Reset Password"
        variant="warning"
        onConfirm={doResetPassword}
        onClose={() => setConfirmReset(null)}
        busy={busy}
      />

      {/* Reset password result modal */}
      <Modal
        open={!!resetResult}
        onClose={() => setResetResult(null)}
        title="Password Sementara"
        subtitle={resetResult?.name}
        size="lg"
        footer={<Button variant="outline" onClick={() => setResetResult(null)}>Tutup</Button>}
      >
        {resetResult && (
          <div className="space-y-5">
            <LargeCopyField label="Email terdaftar" value={resetResult.email} />
            <LargeCopyField label="Password sementara 6 digit" value={resetResult.tempPassword || ""} emphasis />
            <p className="text-base leading-relaxed text-slate-600">Simpan password ini untuk petugas yang tidak membuka email. Minta diganti setelah berhasil login.</p>
            {resetResult.emailSent ? (
              <div className="flex items-start gap-3 text-base text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0" />
                <span>Email terkirim ke {resetResult.email}.</span>
              </div>
            ) : (
              <div className="flex items-start gap-3 text-base text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <AlertCircle size={22} className="mt-0.5 shrink-0" />
                <span>Email gagal dikirim. {resetResult.emailError || "Fungsi tidak memberi alasan."}</span>
              </div>
            )}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

function LargeCopyField({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // salin manual tetap bisa dari teks yang tampil
    }
  };
  return (
    <div className={`rounded-2xl border-2 p-4 ${emphasis ? "border-blue-700 bg-blue-50" : "border-slate-200 bg-white"}`}>
      <div className="text-base font-semibold text-slate-600">{label}</div>
      <div className="mt-2 flex items-center gap-3">
        <div className={`min-w-0 flex-1 text-slate-900 ${emphasis ? "overflow-x-auto whitespace-nowrap font-mono text-4xl font-black tracking-[0.25em]" : "break-all text-2xl font-bold"}`}>{value}</div>
        <button type="button" onClick={copy} className="shrink-0 rounded-xl bg-slate-900 px-4 py-3 text-base font-bold text-white">
          {copied ? "Tersalin" : "Salin"}
        </button>
      </div>
    </div>
  );
}

function CopyableCredential({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-36 shrink-0">{label}</span>
      <div className="flex-1 flex items-center gap-2">
        <span className={`text-sm font-semibold text-slate-800 ${mono ? "font-mono tracking-wider" : ""}`}>{value}</span>
        <button onClick={copy} className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Salin">
          {copied ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
