const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loketDesktop", {
  minimize() {
    ipcRenderer.send("window-minimize");
  },
  maximizeToggle() {
    ipcRenderer.send("window-maximize-toggle");
  },
  close() {
    ipcRenderer.send("window-close");
  },
  onMaximized(callback) {
    const listener = (_event, maximized) => callback(Boolean(maximized));
    ipcRenderer.on("window-maximized", listener);
    return () => ipcRenderer.removeListener("window-maximized", listener);
  },
  notifyChrome() {
    ipcRenderer.send("window-chrome-ready");
  },
  notifyChromeHidden() {
    ipcRenderer.send("window-chrome-hidden");
  },
});

const SLOT_ID = "loket-caption-slot";
const BAR_ID = "loket-injected-bar";

function svg(paths) {
  return `<svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">${paths}</svg>`;
}

function captionButton(label, markup, onClick, extra) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = markup;
  button.style.cssText = "width:48px;height:48px;border:0;padding:0;background:transparent;color:#fff;display:grid;place-items:center;cursor:pointer;-webkit-app-region:no-drag;" + (extra || "");
  button.addEventListener("mouseenter", () => {
    button.style.background = label === "Close" ? "#e11d48" : "rgba(255,255,255,0.14)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "transparent";
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function buildSlot() {
  const slot = document.createElement("div");
  slot.id = SLOT_ID;
  slot.setAttribute("data-loket-caption", "injected");
  slot.style.cssText = "display:flex;height:48px;flex:0 0 auto;margin-left:auto;-webkit-app-region:no-drag;";
  const max = captionButton("Maximize", svg('<rect x="3.2" y="3.4" width="6.2" height="6.2" rx="0.4"/><path d="M4.6 3.4V2.4a.6.6 0 0 1 .6-.6H9.6a.6.6 0 0 1 .6.6V6.8a.6.6 0 0 1-.6.6H8.8"/>'), () => {
    ipcRenderer.send("window-maximize-toggle");
  });
  slot.append(
    captionButton("Minimize", svg('<path d="M2 6h8"/>'), () => ipcRenderer.send("window-minimize")),
    max,
    captionButton("Close", svg('<path d="M3 3l6 6M9 3L3 9"/>'), () => ipcRenderer.send("window-close")),
  );
  return slot;
}

function removeFullscreenButtons() {
  document.querySelectorAll("button").forEach((button) => {
    const text = (button.textContent || "").replace(/\s+/g, " ").trim();
    if (text === "Layar penuh" || text === "Keluar") button.remove();
  });
}

function pageOwnsCaption() {
  return Boolean(document.querySelector("[data-loket-caption='login'], [data-loket-caption='desk'], [data-loket-caption='controls']"));
}

function removeInjected() {
  document.getElementById(BAR_ID)?.remove();
  document.getElementById(SLOT_ID)?.remove();
  document.documentElement.style.paddingTop = "";
}

function injectLoginBar() {
  if (document.getElementById(BAR_ID)) return;
  const bar = document.createElement("header");
  bar.id = BAR_ID;
  bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:100000;display:flex;align-items:center;height:48px;background:#0a0a0a;color:#fff;font:700 16px 'Segoe UI',sans-serif;-webkit-app-region:drag;";
  const brand = document.createElement("div");
  brand.textContent = "Mentari Nusantara";
  brand.style.cssText = "padding-left:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  bar.append(brand, buildSlot());
  document.documentElement.style.paddingTop = "48px";
  document.body.prepend(bar);
}

function attachToDesk(header) {
  if (header.querySelector("#" + SLOT_ID)) return;
  const logout = [...header.querySelectorAll("button")].find((button) => /logout/i.test(button.textContent || ""));
  const host = logout?.parentElement || header;
  host.style.flexWrap = "nowrap";
  host.style.alignItems = "center";
  host.appendChild(buildSlot());
}

function ensureChrome() {
  if (!document.body) return;
  if (pageOwnsCaption()) {
    removeInjected();
    return;
  }
  removeFullscreenButtons();
  const desk = [...document.querySelectorAll("header")].find((header) => {
    const text = header.textContent || "";
    return /Deposit/.test(text) && /Logout/.test(text);
  });
  if (desk) {
    document.getElementById(BAR_ID)?.remove();
    document.documentElement.style.paddingTop = "";
    attachToDesk(desk);
    return;
  }
  if (!document.getElementById(SLOT_ID)) injectLoginBar();
}

window.addEventListener("DOMContentLoaded", () => {
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(ensureChrome, 50);
  };
  schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
});
