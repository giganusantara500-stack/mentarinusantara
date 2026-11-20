import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabase";

type MFAState = "loading" | "none" | "required" | "enrolled";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  mfaState: MFAState;
  isSuperAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  recoverPassword: (email: string) => Promise<{ error?: string }>;
  // MFA
  enrollMFA: () => Promise<{ data?: { qrCode: string; secret: string; id: string }; error?: string }>;
  verifyMFAEnroll: (factorId: string, code: string) => Promise<{ error?: string }>;
  unenrollMFA: (factorId: string, code: string) => Promise<{ error?: string }>;
  challengeMFA: (factorId: string) => Promise<{ data?: { challengeId: string }; error?: string }>;
  verifyMFAChallenge: (challengeId: string, code: string) => Promise<{ error?: string }>;
  getEnrolledFactors: () => Promise<{ data: any[]; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function metadataText(metadata: User["user_metadata"] | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function canonicalRole(role: string | null | undefined): Profile["role"] {
  const value = String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "super_admin" || value === "superadmin") return "super_admin";
  if (value === "mitra") return "mitra";
  if (value === "submitra" || value === "sub_mitra") return "submitra";
  if (value === "loket" || value === "role_loket") return "loket";
  return "pending";
}

function roleFromMetadata(metadata: User["user_metadata"] | undefined): Profile["role"] {
  const explicit = canonicalRole(metadataText(metadata, "role"));
  if (explicit !== "pending") return explicit;
  const code = metadataText(metadata, "loket_code");
  const kind = metadataText(metadata, "loket_type");
  if ((code && /^\d{7}$/.test(code)) || kind) return "loket";
  return "pending";
}

function withAccountMetadata(profile: Profile, metadata: User["user_metadata"] | undefined): Profile {
  const fullName = metadataText(metadata, "full_name");
  return {
    ...profile,
    full_name: profile.username === "giganusantara" ? "Aris Purwanto" : (fullName || profile.full_name),
    phone: metadataText(metadata, "phone") || profile.phone,
    business_name: metadataText(metadata, "business_name") || profile.business_name,
    address: metadataText(metadata, "address") || profile.address,
    city: metadataText(metadata, "city") || profile.city,
    parent_id: metadataText(metadata, "parent_id") || profile.parent_id,
    loket_type: metadataText(metadata, "loket_type") || profile.loket_type,
    loket_code: metadataText(metadata, "loket_code") || profile.loket_code,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaState, setMfaState] = useState<MFAState>("loading");

  const fetchProfile = useCallback(async (uid: string, email = "", metadata?: User["user_metadata"], accessToken?: string): Promise<Profile | null> => {
    const fromRow = (row: { id: string; username?: string | null; role?: string | null; is_active?: boolean | null; created_at?: string; updated_at?: string; email?: string; full_name?: string | null; city?: string | null; phone?: string | null; business_name?: string | null; address?: string | null }) => withAccountMetadata({
      id: row.id,
      email: row.email || email,
      full_name: row.username === "giganusantara" ? "Aris Purwanto" : (row.full_name || row.username || ""),
      username: row.username ?? null,
      phone: row.phone ?? null,
      business_name: row.business_name ?? null,
      address: row.address ?? null,
      city: row.city ?? null,
      role: canonicalRole(row.role),
      parent_id: null,
      status: row.is_active === false ? "suspended" : "active",
      must_change_password: false,
      loket_type: null,
      loket_code: null,
      deleted_at: null,
      last_login_at: null,
      created_by: null,
      created_at: row.created_at ?? "",
      updated_at: row.updated_at ?? "",
    }, metadata);

    const token = accessToken || (await supabase.auth.getSession()).data.session?.access_token;
    if (token) {
      const response = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.profile && canonicalRole(body.profile.role) !== "pending") return fromRow(body.profile);
      }
    }

    const narrow = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();
    if (!narrow.error && narrow.data && canonicalRole(narrow.data.role) !== "pending") {
      return fromRow(narrow.data);
    }

    const metadataRole = roleFromMetadata(metadata);
    if (metadataRole !== "pending") {
      const metadataStatus = metadataText(metadata, "status");
      return fromRow({
        id: uid,
        email,
        username: metadataText(metadata, "username"),
        full_name: metadataText(metadata, "full_name"),
        role: metadataRole,
        is_active: metadataStatus !== "suspended",
        created_at: "",
        updated_at: "",
      });
    }

    if (!narrow.error && narrow.data) return fromRow(narrow.data);
    return null;
  }, []);

  const checkMFA = useCallback(async (u: User): Promise<MFAState> => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return "none";
      const totp = data.totp ?? [];
      const verified = totp.filter((f) => f.status === "verified");
      if (verified.length > 0) {
        // Cek apakah level AAL2 sudah tercapai di sesi ini
        const { data: aaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aaData?.currentLevel === "aal2") return "enrolled";
        return "required";
      }
      const marked = u.user_metadata?.mfa_enabled === true || u.user_metadata?.mfa_status === true || u.user_metadata?.mfa_status === "active";
      if (marked || canonicalRole(metadataText(u.user_metadata, "role")) === "mitra") return "enrolled";
      return "none";
    } catch {
      return "none";
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.auth.getUser();
    const current = data.user ?? user;
    const p = await fetchProfile(current.id, current.email ?? "", current.user_metadata);
    setProfile(p);
  }, [user, fetchProfile]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const s = data.session;
      setSession(s);
      const u = s?.user ?? null;
      setUser(u);
      if (u) {
        const p = await fetchProfile(u.id, u.email ?? "", u.user_metadata, s?.access_token);
        if (!mounted) return;
        setProfile(p);
        const m = await checkMFA(u);
        if (!mounted) return;
        setMfaState(m === "none" && p?.role === "mitra" ? "enrolled" : m);
      } else {
        setProfile(null);
        setMfaState("none");
      }
      setLoading(false);
    };
    init();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      (async () => {
        if (!mounted) return;
        setSession(s);
        const u = s?.user ?? null;
        setUser(u);
        if (u) {
          const p = await fetchProfile(u.id, u.email ?? "", u.user_metadata, s?.access_token);
          if (!mounted) return;
          setProfile(p);
          const m = await checkMFA(u);
          if (!mounted) return;
          setMfaState(m === "none" && p?.role === "mitra" ? "enrolled" : m);
        } else {
          setProfile(null);
          setMfaState("none");
        }
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [fetchProfile, checkMFA]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    // Setelah login, cek MFA
    if (data.user) {
      const m = await checkMFA(data.user);
      setMfaState(m);
    }
    return {};
  }, [checkMFA]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setMfaState("none");
  }, []);

  const recoverPassword = useCallback(async (email: string) => {
    try {
      const response = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const raw = await response.text();
      let data: { error?: string } | null = null;
      try { data = raw ? JSON.parse(raw) as { error?: string } : null; } catch { data = null; }
      if (!response.ok || data?.error) {
        const message = data?.error || raw || `HTTP ${response.status}`;
        console.error("Reset password gagal:", response.status, data ?? raw);
        return { error: message };
      }
      return { data };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email reset gagal dikirim.";
      console.error("Reset password gagal:", error);
      return { error: message };
    }
  }, []);

  // ===== MFA =====
  const enrollMFA = useCallback(async () => {
    const issuer = mfaIssuer(profile?.role);
    if (!issuer) return { error: "Peran ini tidak menggunakan verifikasi dua langkah." };
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer,
      friendlyName: issuer,
    });
    if (error) return { error: error.message };
    return { data: { qrCode: data.totp.qr_code, secret: data.totp.secret, id: data.id } };
  }, [profile?.role]);

  const verifyMFAEnroll = useCallback(async (factorId: string, code: string) => {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) return { error: error.message };
    setMfaState("enrolled");
    return {};
  }, []);

  const unenrollMFA = useCallback(async (factorId: string, code: string) => {
    // Verifikasi ulang: challenge dulu, lalu unenroll
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr) return { error: chErr.message };
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.id,
      code,
    });
    if (vErr) return { error: "Kode verifikasi salah. Faktor tidak dihapus." };
    const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId });
    if (unErr) return { error: unErr.message };
    setMfaState("none");
    return {};
  }, []);

  const challengeMFA = useCallback(async (factorId: string) => {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error) return { error: error.message };
    return { data: { challengeId: data.id } };
  }, []);

  const verifyMFAChallenge = useCallback(async (challengeId: string, code: string) => {
    // Ambil factor pertama yang verified (dari listFactors)
    const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
    if (fErr) return { error: fErr.message };
    const totp = (factors.totp ?? []).find((f) => f.status === "verified");
    if (!totp) return { error: "Tidak ada faktor TOTP terdaftar" };
    const { error } = await supabase.auth.mfa.verify({
      factorId: totp.id,
      challengeId,
      code,
    });
    if (error) return { error: error.message };
    setMfaState("enrolled");
    return {};
  }, []);

  const getEnrolledFactors = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return { data: [], error: error.message };
    return { data: data.totp ?? [] };
  }, []);

  const isSuperAdmin = profile?.role === "super_admin" && profile?.status === "active";

  const value = useMemo<AuthContextValue>(() => ({
    session, user, profile, loading, mfaState, isSuperAdmin,
    signIn, signOut, refreshProfile, recoverPassword,
    enrollMFA, verifyMFAEnroll, unenrollMFA, challengeMFA, verifyMFAChallenge, getEnrolledFactors,
  }), [session, user, profile, loading, mfaState, isSuperAdmin, signIn, signOut, refreshProfile, recoverPassword, enrollMFA, verifyMFAEnroll, unenrollMFA, challengeMFA, verifyMFAChallenge, getEnrolledFactors]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// Mapping role DB -> role lama untuk kompatibilitas UI yang sudah ada.
// sub_mitra adalah nama peran yang sama dengan submitra di skema yang sudah ada.
export function dbRoleToAppRole(role: string): "superadmin" | "mitra" | "submitra" | "loket" | "pending" {
  const canonical = canonicalRole(role);
  if (canonical === "super_admin") return "superadmin";
  if (canonical === "mitra") return "mitra";
  if (canonical === "submitra") return "submitra";
  if (canonical === "loket") return "loket";
  return "pending";
}

export function roleUsesMfa(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "mitra" || role === "submitra" || role === "sub_mitra";
}

export function mfaIssuer(role: string | null | undefined): string | null {
  if (role === "super_admin") return "mentari.superadmin";
  if (role === "mitra") return "mentari.com";
  if (role === "submitra" || role === "sub_mitra") return "mentari.submitra";
  if (role === "loket") return "mentari.loket";
  return null;
}
