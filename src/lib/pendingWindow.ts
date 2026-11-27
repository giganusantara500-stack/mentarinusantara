export const PENDING_HOLD_MS = 60_000;

export function pendingIsLive(createdAt: string | undefined, now = Date.now()) {
  if (!createdAt) return false;
  const at = new Date(createdAt).getTime();
  return Number.isFinite(at) && now - at >= 0 && now - at < PENDING_HOLD_MS;
}
