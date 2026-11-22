const { app, BaseWindow, WebContentsView, Menu, ipcMain } = require("electron");
const path = require("path");

const APP_URL = process.env.LOKET_APP_URL || "https://mentarinusantara.giganusantara500.workers.dev/#/loket-login";
const APP_ORIGIN = new URL(APP_URL).origin;
const WINDOW_TITLE = "Mentari Nusantara";
const BAR_HEIGHT = 36;

const pageOptions = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  devTools: false,
  webSecurity: true,
};

let mainWindow = null;
let titlebarContents = null;
let contentView = null;
let titlebarView = null;
let chromeAttached = false;
let barVisible = false;
let fallbackTimer = null;

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

function isTitlebar(contents) {
  return Boolean(titlebarContents && contents === titlebarContents);
}

function pageContents() {
  return contentView && !contentView.webContents.isDestroyed() ? contentView.webContents : null;
}

function sendMaximized() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  if (titlebarContents && !titlebarContents.isDestroyed()) titlebarContents.send("window-maximized", maximized);
  const page = pageContents();
  if (page) page.send("window-maximized", maximized);
}

function layout() {
  if (!mainWindow || mainWindow.isDestroyed() || !titlebarView || !contentView) return;
  const [width, height] = mainWindow.getContentSize();
  const bar = barVisible ? Math.min(BAR_HEIGHT, Math.max(0, height)) : 0;
  titlebarView.setBounds({ x: 0, y: 0, width, height: bar });
  contentView.setBounds({ x: 0, y: bar, width, height: Math.max(0, height - bar) });
}

function setBarVisible(visible) {
  barVisible = visible;
  layout();
}

function armChromeFallback(delay) {
  if (chromeAttached) return;
  if (fallbackTimer) clearTimeout(fallbackTimer);
  setBarVisible(false);
  fallbackTimer = setTimeout(() => {
    if (!chromeAttached) setBarVisible(true);
  }, delay);
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
    if (isTitlebar(contents) || !isAllowedUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (isTitlebar(contents) || !isAllowedUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  if (isTitlebar(contents)) {
    blockDevTools(contents);
    return;
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUrl(url)) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        title: WINDOW_TITLE,
        parent: undefined,
        modal: false,
        frame: true,
        fullscreen: false,
        autoHideMenuBar: true,
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
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      mainWindow.maximize();
    }
  });
  blockDevTools(contents);
}

function createWindow() {
  const win = new BaseWindow({
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
  });
  mainWindow = win;

  titlebarView = new WebContentsView({
    webPreferences: {
      ...pageOptions,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  contentView = new WebContentsView({
    webPreferences: {
      ...pageOptions,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  titlebarContents = titlebarView.webContents;
  titlebarView.setBackgroundColor("#0f172a");
  contentView.setBackgroundColor("#0f172a");

  win.contentView.addChildView(contentView);
  win.contentView.addChildView(titlebarView);
  layout();

  const relayout = () => {
    layout();
    sendMaximized();
  };
  win.on("resize", relayout);
  win.on("maximize", relayout);
  win.on("unmaximize", relayout);
  win.on("enter-full-screen", relayout);
  win.on("leave-full-screen", relayout);
  win.on("show", relayout);

  titlebarView.webContents.on("did-finish-load", () => {
    relayout();
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      win.maximize();
      relayout();
    }
  });
  contentView.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(WINDOW_TITLE);
  });
  contentView.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace) return;
    chromeAttached = false;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    setBarVisible(false);
  });
  contentView.webContents.on("did-finish-load", () => {
    armChromeFallback(2500);
    sendMaximized();
  });
  contentView.webContents.on("did-fail-load", (_event, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (!isAllowedUrl(url) && url !== APP_URL) return;
    setTimeout(() => {
      if (!contentView.webContents.isDestroyed()) contentView.webContents.loadURL(APP_URL);
    }, 4000);
  });

  titlebarView.webContents.loadFile(path.join(__dirname, "titlebar.html"));
  contentView.webContents.loadURL(APP_URL);
  win.on("closed", () => {
    mainWindow = null;
    titlebarContents = null;
    titlebarView = null;
    contentView = null;
  });
}

function shellWindow(event) {
  const page = pageContents();
  const allowed = event.sender === titlebarContents || event.sender === page;
  if (!mainWindow || mainWindow.isDestroyed() || !allowed) return null;
  return mainWindow;
}

ipcMain.on("window-minimize", (event) => {
  shellWindow(event)?.minimize();
});

ipcMain.on("window-maximize-toggle", (event) => {
  const win = shellWindow(event);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  sendMaximized();
});

ipcMain.on("window-close", (event) => {
  shellWindow(event)?.close();
});

ipcMain.on("window-chrome-ready", (event) => {
  if (event.sender !== pageContents()) return;
  chromeAttached = true;
  if (fallbackTimer) clearTimeout(fallbackTimer);
  setBarVisible(false);
  sendMaximized();
});

ipcMain.on("window-chrome-hidden", (event) => {
  if (event.sender !== pageContents()) return;
  chromeAttached = false;
  if (fallbackTimer) clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => {
    if (!chromeAttached) setBarVisible(true);
  }, 200);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.on("web-contents-created", (_event, contents) => harden(contents));
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
