import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}

export function Field({ label, children, hint, className }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-xs font-medium text-slate-600 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition",
        props.className
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition",
        props.className
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition",
        props.className
      )}
    />
  );
}
