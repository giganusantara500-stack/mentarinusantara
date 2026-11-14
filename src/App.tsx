import { useEffect, useState } from "react";
import { AuthProvider, useAuth, canonicalRole, roleUsesMfa } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { LoketShell } from "@/components/layout/LoketShell";
import { LoginPage } from "@/pages/LoginPage";
import { MFAVerifyPage } from "@/pages/MFAVerifyPage";
import { PendingPage } from "@/pages/PendingPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SetupSuperAdminPage } from "@/pages/SetupSuperAdminPage";
import { SecurityPage } from "@/pages/SecurityPage";
import { ForcePasswordChangePage } from "@/pages/ForcePasswordChangePage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoketHomePage } from "@/pages/LoketHomePage";
import { LoketKolektifPage, LoketReportPage, LoketSettingPage, LoketStatusPage, LoketTransaksiPage, LoketTransferPage } from "@/pages/loket/LoketDesk";
import { KolektifPage } from "@/pages/KolektifPage";
import { TransferPage } from "@/pages/TransferPage";
import { MitraDashboardPage } from "@/pages/MitraDashboardPage";
import { SuperAdminDashboardPage } from "@/pages/SuperAdminDashboardPage";
import { BuyPage } from "@/pages/BuyPage";
import { ManageUsersPage } from "@/pages/ManageUsersPage";
import { UserDetailPage } from "@/pages/UserDetailPage";
import { ProductsPage } from "@/pages/ProductsPage";
import { PricingPage } from "@/pages/PricingPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { MutationsPage } from "@/pages/MutationsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AnnouncementsPage } from "@/pages/AnnouncementsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { OpsDashboardPage } from "@/pages/OpsDashboardPage";
import {
  BalanceAllocationPage,
  BalanceMonitorPage,
  BlockLoketPage,
  CollectiveAdminPage,
  ManageSetoranPage,
  OutstandingPage,
  QrisReportPage,
  RecapPage,
  RunTextPage,
} from "@/pages/OperationsPages";

function ProtectedApp() {
  const { user, profile, loading, mfaState, isSuperAdmin, signOut } = useAuth();
  const [path, setPath] = useState<string>(() => {
    const h = window.location.hash.replace(/^#/, "");
    return h || "/dashboard";
  });

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      setPath(h || "/dashboard");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (p: string) => {
    window.location.hash = p;
    setPath(p);
    window.scrollTo({ top: 0 });
  };

  // Halaman reset password berdiri sendiri (tidak butuh login)
  if (path === "/reset-password") {
    return <ResetPasswordPage />;
  }

  if (path === "/setup-superadmin") {
    return <SetupSuperAdminPage />;
  }

  // Loading awal
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 animate-pulse" />
          <div className="text-sm text-slate-500">Memuat...</div>
        </div>
      </div>
    );
  }

  // Belum login -> LoginPage
  if (!user) {
    return <LoginPage />;
  }

  const mfaRequired = roleUsesMfa(profile?.role);

  // 2FA wajib untuk Super Admin dan Mitra jika sudah terdaftar tetapi sesi belum AAL2.
  if (mfaRequired && mfaState === "required") {
    return <MFAVerifyPage />;
  }

  // Peran yang sudah dikenali, termasuk loket, langsung masuk. Akun nonaktif atau tanpa peran tetap tertahan.
  if (!profile || canonicalRole(profile.role) === "pending" || profile.status === "suspended") {
    return <PendingPage />;
  }

  // Password sementara wajib diganti sebelum dashboard dibuka.
  // Super Admin yang sudah aktif masuk ke dashboard utama.
  if (profile?.must_change_password && !isSuperAdmin) {
    return <ForcePasswordChangePage />;
  }

  // Super Admin dan Mitra wajib memasang 2FA sebelum membuka dashboard.
  if (mfaRequired && mfaState === "none") {
    return (
      <AppShell current="/keamanan" onNavigate={navigate} onLogout={() => signOut()} onSecurity={() => navigate("/keamanan")}>
        <SecurityPage />
      </AppShell>
    );
  }

  const render = () => {
    // Detail pages: /mitra/detail/:id, /submitra/detail/:id, /loket/detail/:id
    const detailMatch = path.match(/^\/(mitra|submitra|loket)\/detail\/(.+)$/);
    if (detailMatch) {
      const [, role, userId] = detailMatch;
      return <UserDetailPage userId={userId} onBack={() => navigate(`/${role}`)} />;
    }

    switch (path) {
      case "/dashboard":
        if (isSuperAdmin || profile?.role === "mitra" || profile?.role === "submitra") return <OpsDashboardPage />;
        if (profile?.role === "loket") return <LoketHomePage />;
        return <DashboardPage onNavigate={navigate} />;
      case "/keamanan": return <SecurityPage />;
      case "/beli": return profile?.role === "loket" ? <LoketTransaksiPage /> : <BuyPage />;
      case "/mitra": return <ManageUsersPage targetRole="mitra" onNavigate={navigate} />;
      case "/submitra": return <ManageUsersPage targetRole="submitra" onNavigate={navigate} />;
      case "/loket": return <ManageUsersPage targetRole="loket" onNavigate={navigate} />;
      case "/produk": return <ProductsPage />;
      case "/harga": return <PricingPage />;
      case "/transaksi": return <TransactionsPage />;
      case "/riwayat": return profile?.role === "loket" ? <LoketStatusPage /> : <TransactionsPage riwayat />;
      case "/mutasi": return <MutationsPage />;
      case "/deposit":
        return profile.role === "loket" ? null : <ManageSetoranPage />;
      case "/kolektif":
        return profile.role === "loket" ? <LoketKolektifPage /> : <DashboardPage onNavigate={navigate} />;
      case "/transfer":
        return profile.role === "loket" ? <LoketTransferPage /> : <DashboardPage onNavigate={navigate} />;
      case "/setoran":
      case "/deposit-approval":
        return profile.role === "loket" ? <LoketHomePage /> : <ManageSetoranPage />;
      case "/saldo":
        return profile.role === "loket" ? <LoketHomePage /> : <BalanceMonitorPage />;
      case "/pembagian":
        return isSuperAdmin ? <BalanceAllocationPage /> : <BalanceMonitorPage />;
      case "/outstanding":
        return profile.role === "loket" ? <LoketHomePage /> : <OutstandingPage />;
      case "/rekap":
        return profile.role === "loket" ? <LoketHomePage /> : <RecapPage />;
      case "/qris":
        return profile.role === "loket" ? <LoketHomePage /> : <QrisReportPage />;
      case "/kolektif-admin":
        return profile.role === "loket" ? <KolektifPage /> : <CollectiveAdminPage />;
      case "/runtext":
        return profile.role === "loket" ? <LoketHomePage /> : <RunTextPage />;
      case "/blokir":
        return profile.role === "loket" ? <LoketHomePage /> : <BlockLoketPage />;
      case "/laporan": return profile?.role === "loket" ? <LoketReportPage /> : <ReportsPage />;
      case "/pengumuman": return <AnnouncementsPage />;
      case "/pengaturan": return profile?.role === "loket" ? <LoketSettingPage /> : <SettingsPage />;
      default:
        if (isSuperAdmin || profile?.role === "mitra" || profile?.role === "submitra") return <OpsDashboardPage />;
        if (profile?.role === "loket") return <LoketHomePage />;
        return <DashboardPage onNavigate={navigate} />;
    }
  };

  if (profile.role === "loket") {
    return (
      <LoketShell current={path} onNavigate={navigate} onLogout={() => signOut()}>
        {render()}
      </LoketShell>
    );
  }

  return (
    <AppShell current={path} onNavigate={navigate} onLogout={() => signOut()} onSecurity={() => navigate("/keamanan")}>
      {render()}
    </AppShell>
  );
}

export default function App() {
  // Handle recovery flow dari email: Supabase redirect ke /#/reset-password
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("access_token")) {
      // Biarkan Supabase memproses token, lalu arahkan ke reset-password
      const t = setTimeout(() => {
        if (window.location.hash && window.location.hash.includes("access_token")) {
          window.location.hash = "#/reset-password";
        }
      }, 300);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <AuthProvider>
        <ProtectedApp />
    </AuthProvider>
  );
}
