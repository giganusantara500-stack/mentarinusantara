const { contextBridge, ipcRenderer } = require("electron");

const BAR_HEIGHT = 36;

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
});

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  });
  (children || []).forEach((child) => node.appendChild(child));
  return node;
}

function svg(paths) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 12 12");
  icon.setAttribute("aria-hidden", "true");
  paths.forEach((spec) => {
    const part = document.createElementNS("http://www.w3.org/2000/svg", spec.tag);
    Object.entries(spec.attrs).forEach(([key, value]) => part.setAttribute(key, value));
    icon.appendChild(part);
  });
  return icon;
}

function installBar() {
  if (!document.documentElement || document.getElementById("loket-window-bar")) return;

  const style = el("style", { id: "loket-window-style" });
  style.textContent = `
    #loket-window-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: ${BAR_HEIGHT}px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      background: #0f172a;
      color: #f8fafc;
      font-family: "Segoe UI", sans-serif;
      user-select: none;
      -webkit-app-region: drag;
      box-shadow: inset 0 -1px 0 rgba(251, 191, 36, 0.45);
    }
    #loket-window-bar .brand { display: flex; align-items: center; gap: 8px; min-width: 0; padding-left: 12px; }
    #loket-window-bar .mark { width: 18px; height: 18px; display: block; -webkit-app-region: no-drag; }
    #loket-window-bar .name { font-size: 13px; font-weight: 700; white-space: nowrap; }
    #loket-window-bar .role { margin-left: 8px; color: #fbbf24; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    #loket-window-bar .spacer { flex: 1; height: 100%; }
    #loket-window-bar .controls { display: flex; height: 100%; -webkit-app-region: no-drag; }
    #loket-window-bar button {
      width: 46px;
      height: 100%;
      border: 0;
      background: transparent;
      color: #f8fafc;
      display: grid;
      place-items: center;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    #loket-window-bar button[hidden] { display: none !important; }
    #loket-window-bar button svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.6; }
    #loket-window-bar button:hover { background: rgba(255, 255, 255, 0.12); }
    #loket-window-bar button.close:hover { background: #e11d48; }
    html.loket-desktop-shell, html.loket-desktop-shell body { box-sizing: border-box !important; }
    html.loket-desktop-shell body {
      padding-top: ${BAR_HEIGHT}px !important;
      min-height: 100vh !important;
    }
    html.loket-desktop-shell body > #root,
    html.loket-desktop-shell body > #root > * {
      min-height: calc(100vh - ${BAR_HEIGHT}px) !important;
      height: calc(100vh - ${BAR_HEIGHT}px) !important;
      max-height: calc(100vh - ${BAR_HEIGHT}px) !important;
    }
    @media print {
      #loket-window-bar { display: none !important; }
      html.loket-desktop-shell body { padding-top: 0 !important; }
      html.loket-desktop-shell body > #root,
      html.loket-desktop-shell body > #root > * {
        min-height: auto !important;
        height: auto !important;
        max-height: none !important;
      }
    }
  `;
  document.documentElement.appendChild(style);
  document.documentElement.classList.add("loket-desktop-shell");

  const mark = svg([
    { tag: "rect", attrs: { width: "12", height: "12", rx: "3", fill: "#0f172a", stroke: "none" } },
    { tag: "circle", attrs: { cx: "6", cy: "6", r: "3.1", fill: "#f59e0b", stroke: "none" } },
    { tag: "circle", attrs: { cx: "6", cy: "6", r: "1.3", fill: "#fffbeb", stroke: "none" } },
  ]);
  mark.setAttribute("class", "mark");

  const minimize = el("button", { type: "button", id: "loket-min", title: "Minimize", "aria-label": "Minimize" }, [
    svg([{ tag: "path", attrs: { d: "M2 6h8" } }]),
  ]);
  const maximize = el("button", { type: "button", id: "loket-max", title: "Maximize", "aria-label": "Maximize" }, [
    svg([{ tag: "rect", attrs: { x: "2.2", y: "2.2", width: "7.6", height: "7.6", rx: "0.6" } }]),
  ]);
  const restore = el("button", { type: "button", id: "loket-restore", title: "Restore", "aria-label": "Restore", hidden: "" }, [
    svg([
      { tag: "rect", attrs: { x: "3.4", y: "1.8", width: "6.2", height: "6.2", rx: "0.5" } },
      { tag: "path", attrs: { d: "M2.2 4.1V9.4a.6.6 0 0 0 .6.6H8" } },
    ]),
  ]);
  const close = el("button", { type: "button", id: "loket-close", class: "close", title: "Tutup", "aria-label": "Close" }, [
    svg([{ tag: "path", attrs: { d: "M3 3l6 6M9 3L3 9" } }]),
  ]);

  const bar = el("div", { id: "loket-window-bar" }, [
    el("div", { class: "brand" }, [
      mark,
      el("span", { class: "name", text: "Mentari Nusantara" }),
      el("span", { class: "role", text: "Meja Loket" }),
    ]),
    el("div", { class: "spacer" }),
    el("div", { class: "controls" }, [minimize, maximize, restore, close]),
  ]);

  minimize.addEventListener("click", () => ipcRenderer.send("window-minimize"));
  maximize.addEventListener("click", () => ipcRenderer.send("window-maximize-toggle"));
  restore.addEventListener("click", () => ipcRenderer.send("window-maximize-toggle"));
  close.addEventListener("click", () => ipcRenderer.send("window-close"));
  bar.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    ipcRenderer.send("window-maximize-toggle");
  });

  document.documentElement.appendChild(bar);
}

function setMaximized(maximized) {
  const maximize = document.getElementById("loket-max");
  const restore = document.getElementById("loket-restore");
  if (!maximize || !restore) return;
  maximize.hidden = maximized;
  restore.hidden = !maximized;
}

ipcRenderer.on("window-maximized", (_event, maximized) => setMaximized(Boolean(maximized)));

window.addEventListener("DOMContentLoaded", installBar);
window.addEventListener("load", installBar);
