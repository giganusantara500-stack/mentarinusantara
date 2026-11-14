import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: Props) {
  return <div className={cn("w-full min-w-0", className)}>{children}</div>;
}
