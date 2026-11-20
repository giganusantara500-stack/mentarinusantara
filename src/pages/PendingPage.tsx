import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { XCircle, Mail } from "lucide-react";

export function PendingPage() {
  const { profile, user, signOut } = useAuth();
  if (profile?.status !== "suspended") return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
          <XCircle size={28} className="text-rose-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Akun Dinonaktifkan</h1>
        <p className="text-sm text-slate-500 mt-2">
          Akun Anda telah dinonaktifkan oleh administrator. Hubungi Super Admin untuk informasi.
        </p>
        {user?.email && (
          <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg">
            <Mail size={13} /> {user.email}
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="outline" onClick={() => signOut()}>Keluar</Button>
        </div>
      </div>
    </div>
  );
}
