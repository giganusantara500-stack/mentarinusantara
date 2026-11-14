import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: Props) {
  return <div className={cn("max-w-7xl mx-auto", className)}>{children}</div>;
}
