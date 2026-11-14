import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import type { LucideIcon } from "lucide-react";

interface Props {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: "blue" | "emerald" | "amber" | "rose" | "slate" | "cyan";
  hint?: string;
}

const tones = {
  blue: "bg-blue-50 text-blue-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  slate: "bg-slate-100 text-slate-600",
  cyan: "bg-cyan-50 text-cyan-600",
};

export function StatCard({ label, value, icon: Icon, tone = "blue", hint }: Props) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5">{value}</div>
          {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
        </div>
        <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center", tones[tone])}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  );
}
