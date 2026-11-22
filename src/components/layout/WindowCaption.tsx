import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

interface LoketDesktopApi {
  minimize: () => void;
  maximizeToggle: () => void;
  close: () => void;
  onMaximized: (callback: (maximized: boolean) => void) => (() => void) | void;
  notifyChrome?: () => void;
  notifyChromeHidden?: () => void;
}

declare global {
  interface Window {
    loketDesktop?: LoketDesktopApi;
  }
}

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const drag = { WebkitAppRegion: "drag" } as CSSProperties;

function useWindowCaption() {
  const desktop = typeof window !== "undefined" && Boolean(window.loketDesktop);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const api = window.loketDesktop;
    if (!api) return;
    const stop = api.onMaximized((value) => setMaximized(value));
    api.notifyChrome?.();
    return () => {
      if (typeof stop === "function") stop();
      api.notifyChromeHidden?.();
    };
  }, []);
  return {
    desktop,
    maximized,
    toggle: () => window.loketDesktop?.maximizeToggle(),
  };
}

function CaptionIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
      {children}
    </svg>
  );
}

export function WindowCaptionButtons() {
  const { desktop, maximized, toggle } = useWindowCaption();
  if (!desktop) return null;
  const button = "grid h-12 w-12 shrink-0 place-items-center text-white hover:bg-white/15";
  return (
    <div className="flex h-12 shrink-0" style={noDrag}>
      <button type="button" className={button} aria-label="Minimize" title="Minimize" onClick={() => window.loketDesktop?.minimize()}>
        <CaptionIcon><path d="M2 6h8" /></CaptionIcon>
      </button>
      <button type="button" className={button} aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={toggle}>
        {maximized ? (
          <CaptionIcon>
            <rect x="3.4" y="1.8" width="6.2" height="6.2" rx="0.5" />
            <path d="M2.2 4.1V9.4a.6.6 0 0 0 .6.6H8" />
          </CaptionIcon>
        ) : (
          <CaptionIcon><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="0.6" /></CaptionIcon>
        )}
      </button>
      <button type="button" className="grid h-12 w-12 shrink-0 place-items-center text-white hover:bg-rose-600" aria-label="Close" title="Tutup" onClick={() => window.loketDesktop?.close()}>
        <CaptionIcon><path d="M3 3l6 6M9 3L3 9" /></CaptionIcon>
      </button>
    </div>
  );
}

export function LoketDesktopBar() {
  if (typeof window === "undefined" || !window.loketDesktop) return null;
  return (
    <header className="flex h-12 shrink-0 items-center bg-neutral-950 text-white">
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-3" style={drag} onDoubleClick={() => window.loketDesktop?.maximizeToggle()}>
        <img src="/icons/icon-512.png" alt="" className="h-7 w-7 rounded-md" />
        <span className="truncate text-base font-black tracking-tight">Mentari Nusantara</span>
      </div>
      <WindowCaptionButtons />
    </header>
  );
}
