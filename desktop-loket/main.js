const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");

const APP_URL = "https://mentarinusantara.giganusantara500.workers.dev/#/loket-login";
const APP_ORIGIN = "https://mentarinusantara.giganusantara500.workers.dev";
const WINDOW_TITLE = "Mentari Nusantara - Meja Loket";

const pageOptions = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  devTools: false,
  webSecurity: true,
};

let mainWindow = null;

function isAllowedUrl(raw) {
  if (!raw || raw === "about:blank" || raw.startsWith("about:blank")) return true;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol === "about:" || parsed.protocol === "blob:" || parsed.protocol === "data:") return true;
  return parsed.origin === APP_ORIGIN;
}

function ownWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || win !== mainWindow) return null;
  return win;
}

function sendMaximized(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("window-maximized", win.isMaximized());
}

function blockDevTools(contents) {
  contents.on("devtools-opened", () => contents.closeDevTools());
  contents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const chord = input.control && input.shift && (key === "i" || key === "j" || key === "c");
    if (key === "f12" || chord || (input.control && key === "u")) event.preventDefault();
  });
}

function harden(contents) {
  contents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUrl(url)) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        title: WINDOW_TITLE,
        autoHideMenuBar: true,
        fullscreen: false,
        frame: true,
        width: 980,
        height: 760,
        webPreferences: pageOptions,
      },
    };
  });
  contents.on("did-create-window", (child) => {
    child.setAutoHideMenuBar(true);
    child.setMenuBarVisibility(false);
    child.setTitle(WINDOW_TITLE);
    child.show();
    child.focus();
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      mainWindow.maximize();
    }
  });
  blockDevTools(contents);
}

function createWindow() {
  const win = new BrowserWindow({
    title: WINDOW_TITLE,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      ...pageOptions,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow = win;
  win.setMenuBarVisibility(false);
  win.on("maximize", () => sendMaximized(win));
  win.on("unmaximize", () => sendMaximized(win));
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
    sendMaximized(win);
  });
  win.webContents.on("did-finish-load", () => sendMaximized(win));
  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(WINDOW_TITLE);
  });
  win.webContents.on("did-fail-load", (_event, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (!isAllowedUrl(url) && url !== APP_URL) return;
    setTimeout(() => {
      if (!win.isDestroyed()) win.loadURL(APP_URL);
    }, 4000);
  });
  win.loadURL(APP_URL);
  win.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("window-minimize", (event) => {
  ownWindow(event)?.minimize();
});

ipcMain.on("window-maximize-toggle", (event) => {
  const win = ownWindow(event);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  sendMaximized(win);
});

ipcMain.on("window-close", (event) => {
  ownWindow(event)?.close();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.on("web-contents-created", (_event, contents) => harden(contents));
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
