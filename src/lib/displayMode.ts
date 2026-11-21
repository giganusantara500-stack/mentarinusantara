import { canonicalRole } from "@/lib/auth";

const BROWSER_MANIFEST = "/manifest.webmanifest";
const LOKET_MANIFEST = "/loket.webmanifest";
const LOKET_WORKER = "/loket-sw.js";
const PLATFORM_TITLE = "Giga Mentari Nusantara PPOB Platform";

function setMeta(name: string, content: string) {
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function setManifest(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.href = href;
}

function installedLoketApp() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

async function registerLoketWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.some((item) => item.active?.scriptURL.includes("loket-sw.js") || item.installing?.scriptURL.includes("loket-sw.js") || item.waiting?.scriptURL.includes("loket-sw.js"))) return;
  await navigator.serviceWorker.register(LOKET_WORKER, { scope: "/" }).catch(() => undefined);
}

async function unregisterLoketWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter((item) => {
    const script = item.active?.scriptURL || item.installing?.scriptURL || item.waiting?.scriptURL || "";
    return script.includes("loket-sw.js");
  }).map((item) => item.unregister()));
}

export function applyDisplayMode(role: string | null | undefined, known: boolean) {
  const loket = canonicalRole(role) === "loket";
  const fullscreen = loket || (!known && installedLoketApp());
  setManifest(fullscreen ? LOKET_MANIFEST : BROWSER_MANIFEST);
  setMeta("mobile-web-app-capable", fullscreen ? "yes" : "no");
  setMeta("apple-mobile-web-app-capable", fullscreen ? "yes" : "no");
  setMeta("apple-mobile-web-app-title", "Mentari Nusantara");
  setMeta("apple-mobile-web-app-status-bar-style", fullscreen ? "black-translucent" : "default");
  setMeta("theme-color", fullscreen ? "#f59e0b" : "#0f172a");
  document.documentElement.classList.toggle("loket-app", fullscreen);
  if (fullscreen && (document.title === PLATFORM_TITLE || document.title === "")) document.title = "Mentari Nusantara";
  if (!fullscreen && document.title === "Mentari Nusantara") document.title = PLATFORM_TITLE;
  if (!known) return;
  if (loket) void registerLoketWorker();
  else void unregisterLoketWorker();
}
