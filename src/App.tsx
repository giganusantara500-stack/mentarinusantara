import { useEffect, useState } from "react";
import { AuthProvider, canonicalRole, useAuth } from "@/lib/auth";
import { pathAllowed } from "@/lib/access";
import { applyDisplayMode } from "@/lib/displayMode";
import { AppShell } from "@/components/layout/AppShell";
import { LoketShell } from "@/components/layout/LoketShell";
import { LoginPage } from "@/pages/LoginPage";
import { MFAEnrollPage } from "@/pages/MFAEnrollPage";
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
import { PusatDepositPage } from "@/pages/DepositPage";
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

function ensureHashRoute() {
  if (window.location.hash && window.location.hash !== "#") return;
  const path = window.location.pathname.replace(/\/index\.html$/, "") || "/";
  if (path === "/") return;
  window.history.replaceState(null, "", `/#${path}${window.location.search}`);
}

ensureHashRoute();

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

  useEffect(() => {
    if (!profile || path === "/reset-password") return;
    if (!pathAllowed(profile.role, path)) window.location.hash = "/dashboard";
  }, [profile, path]);

  const navigate = (p: string) => {
    window.location.hash = p;
    setPath(p);
    window.scrollTo({ top: 0 });
  };

  // Halaman reset password berdiri sendiri (tidak butuh login)
  if (path === "/reset-password") {
    return <ResetPasswordPage />;
  }

  if (path === "/setup-superadmin" && !user && !loading) {
    return <LoginPage />;
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

  const role = canonicalRole(profile?.role);
  const requiresMfa = role === "super_admin" || role === "mitra" || role === "submitra";

  if (profile?.status === "suspended") {
    return <PendingPage />;
  }

  if (profile?.must_change_password && !isSuperAdmin) {
    return <ForcePasswordChangePage />;
  }

  if (requiresMfa && mfaState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Memeriksa verifikasi dua langkah...</div>
    );
  }

  if (requiresMfa && mfaState === "required") {
    return <MFAVerifyPage />;
  }

  if (requiresMfa && mfaState === "none") {
    return <MFAEnrollPage />;
  }

  if (!profile) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white text-sm text-slate-500">Memuat profil akun...</div>
    );
  }

  const visiblePath = pathAllowed(profile.role, path) ? path : "/dashboard";

  const render = () => {
    // Detail pages: /mitra/detail/:id, /submitra/detail/:id, /loket/detail/:id
    const detailMatch = visiblePath.match(/^\/(mitra|submitra|loket)\/detail\/(.+)$/);
    if (detailMatch) {
      const [, role, userId] = detailMatch;
      return <UserDetailPage userId={userId} onBack={() => navigate(`/${role}`)} />;
    }

    switch (visiblePath) {
      case "/dashboard":
        if (isSuperAdmin || canonicalRole(profile?.role) === "mitra" || canonicalRole(profile?.role) === "submitra") return <OpsDashboardPage />;
        if (canonicalRole(profile?.role) === "loket") return <LoketHomePage />;
        return <DashboardPage onNavigate={navigate} />;
      case "/keamanan": return role === "loket" ? <LoketHomePage /> : <SecurityPage />;
      case "/setup-superadmin": return isSuperAdmin ? <SetupSuperAdminPage /> : <OpsDashboardPage />;
      case "/beli": return profile?.role === "loket" ? <LoketTransaksiPage /> : <BuyPage />;
      case "/mitra": return <ManageUsersPage targetRole="mitra" onNavigate={navigate} />;
      case "/submitra": return <ManageUsersPage targetRole="submitra" onNavigate={navigate} />;
      case "/loket": return <ManageUsersPage targetRole="loket" onNavigate={navigate} />;
      case "/produk": return <ProductsPage />;
      case "/harga": return <PricingPage />;
      case "/transaksi": return canonicalRole(profile?.role) === "loket" ? <LoketStatusPage /> : <TransactionsPage />;
      case "/riwayat": return profile?.role === "loket" ? <LoketStatusPage /> : <TransactionsPage riwayat />;
      case "/mutasi": return <MutationsPage />;
      case "/deposit":
        if (profile.role === "loket") return null;
        return <PusatDepositPage />;
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
        if (isSuperAdmin || canonicalRole(profile?.role) === "mitra" || canonicalRole(profile?.role) === "submitra") return <OpsDashboardPage />;
        if (canonicalRole(profile?.role) === "loket") return <LoketHomePage />;
        return <DashboardPage onNavigate={navigate} />;
    }
  };

  if (canonicalRole(profile.role) === "loket") {
    return (
      <LoketShell current={visiblePath} onNavigate={navigate} onLogout={() => signOut()}>
        {render()}
      </LoketShell>
    );
  }

  return (
    <AppShell current={visiblePath} onNavigate={navigate} onLogout={() => signOut()} onSecurity={() => navigate("/keamanan")}>
      {render()}
    </AppShell>
  );
}

function RoleDisplay() {
  const { user, profile, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    applyDisplayMode(user ? profile?.role : null, Boolean(user && profile));
  }, [loading, user, profile]);
  return null;
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
        <RoleDisplay />
        <ProtectedApp />
    </AuthProvider>
  );
}
