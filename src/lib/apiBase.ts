const configured = import.meta.env.VITE_API_BASE;
// Produksi tidak lagi memanggil http://VPS langsung. Path relatif tetap di origin HTTPS,
// lalu Worker meneruskan /api ke backend.
const fallback = "";

export const apiBase = (typeof configured === "string" ? configured.trim() : fallback).replace(/\/$/, "");

export function apiUrl(path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase}${suffix}`;
}
