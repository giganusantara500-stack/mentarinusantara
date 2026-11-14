import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "blue";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
  info: "bg-cyan-100 text-cyan-700",
  blue: "bg-blue-100 text-blue-700",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
