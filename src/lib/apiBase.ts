const configured = import.meta.env.VITE_API_BASE;
const fallback = import.meta.env.PROD ? "http://139.190.102.196:8787" : "";

export const apiBase = (typeof configured === "string" ? configured : fallback).replace(/\/$/, "");

export function apiUrl(path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase}${suffix}`;
}
