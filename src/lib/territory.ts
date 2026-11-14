import { PLATFORM_NAME } from "@/lib/brand";
import { ROLE_LABELS } from "@/lib/nav";
import type { Role } from "@/lib/types";

export function territoryMarker(role: Role, city?: string | null) {
  const place = city?.trim();
  return place ? `${ROLE_LABELS[role]} ${place}` : ROLE_LABELS[role];
}

export function brandLine(role: Role, city?: string | null) {
  return `${PLATFORM_NAME} - ${territoryMarker(role, city)}`;
}
