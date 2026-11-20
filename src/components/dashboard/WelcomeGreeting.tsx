import { useEffect, useState } from "react";
import { canonicalRole, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function greeting(role: string, name: string, city: string) {
  const who = name || "Pengguna";
  const located = city ? `${who} (${city})` : who;
  if (role === "super_admin") return "Halo lagi, Mas Aris! Semoga harimu berjalan lancar dan penuh energi positif.";
  if (role === "mitra") return `Selamat datang kembali, Mitra ${located}! Semoga harimu menyenangkan dan selalu dalam kondisi prima.`;
  if (role === "submitra") return `Halo Sub Mitra ${located}! Siap beraktivitas hari ini? Semoga semua urusanmu dilancarkan.`;
  if (role === "loket") return `Halo Kak ${located}! Selamat beraktivitas, semoga transaksi hari ini lancar dan penuh berkah.`;
  return "";
}

export function WelcomeGreeting({ className }: { className?: string }) {
  const { profile, user } = useAuth();
  const [shown, setShown] = useState(true);
  const [gone, setGone] = useState(false);
  const metadata = user?.user_metadata;
  const role = canonicalRole(profile?.role || textOf(metadata?.role));
  const name = textOf(profile?.full_name) || textOf(metadata?.full_name) || textOf(profile?.username) || textOf(metadata?.username);
  const city = textOf(profile?.city) || textOf(metadata?.city);
  const text = greeting(role, name, city);

  useEffect(() => {
    if (!text) return;
    setShown(true);
    setGone(false);
    const hide = window.setTimeout(() => setShown(false), 8000);
    const remove = window.setTimeout(() => setGone(true), 8700);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(remove);
    };
  }, [text]);

  if (!text || gone) return null;

  return (
    <div className={cn("pointer-events-none absolute inset-x-0 z-50 flex justify-center px-4", className)}>
      <p className={cn(
        "max-w-3xl rounded-xl bg-violet-50 px-5 py-2.5 text-center text-base font-bold leading-snug text-slate-900 shadow-md ring-1 ring-violet-200 transition-opacity duration-700",
        shown ? "opacity-100" : "opacity-0",
      )}>
        {text}
      </p>
    </div>
  );
}
