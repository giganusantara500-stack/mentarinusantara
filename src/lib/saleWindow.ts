export const LIVE_PENDING_MS = 15 * 60 * 1000;

export function isProductionSuccess(status?: string | null) {
  return status === "success";
}

export function isLivePending(status: string | undefined, createdAt: string | undefined, now = Date.now()) {
  if (status !== "pending" || !createdAt) return false;
  const at = new Date(createdAt).getTime();
  return Number.isFinite(at) && now - at >= 0 && now - at < LIVE_PENDING_MS;
}
