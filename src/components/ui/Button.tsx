import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-purple-600 to-violet-600 text-white hover:from-purple-700 hover:to-violet-700 active:from-purple-800 active:to-violet-800 shadow-sm",
  secondary: "bg-slate-800 text-white hover:bg-slate-900 active:bg-slate-950 shadow-sm",
  outline: "border border-slate-300 text-slate-700 bg-white hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm rounded-lg",
  md: "px-4 py-2 text-sm rounded-lg",
  lg: "px-5 py-2.5 text-base rounded-xl",
};

interface Props {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  onClick,
  type = "button",
  disabled,
  className,
  fullWidth,
}: Props) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
    >
      {children}
    </button>
  );
}
