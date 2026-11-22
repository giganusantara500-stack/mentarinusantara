const { app, BaseWindow, WebContentsView, Menu, ipcMain } = require("electron");
const path = require("path");

const APP_URL = "https://mentarinusantara.giganusantara500.workers.dev/#/loket-login";
const APP_ORIGIN = "https://mentarinusantara.giganusantara500.workers.dev";
const WINDOW_TITLE = "Mentari Nusantara - Meja Loket";
const TITLEBAR_HEIGHT = 42;

const pageOptions = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  devTools: false,
  webSecurity: true,
};

let mainWindow = null;
let titlebarContents = null;

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

function blockDevTools(contents) {
  contents.on("devtools-opened", () => {
    contents.closeDevTools();
  });
  contents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const chord = input.control && input.shift && (key === "i" || key === "j" || key === "c");
    if (key === "f12" || chord || (input.control && key === "u")) event.preventDefault();
  });
}

function harden(contents) {
  contents.on("will-navigate", (event, url) => {
    if (contents === titlebarContents) {
      event.preventDefault();
      return;
    }
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
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

function sendChromeState() {
  if (!mainWindow || mainWindow.isDestroyed() || !titlebarContents || titlebarContents.isDestroyed()) return;
  titlebarContents.send("loket-maximized", mainWindow.isMaximized());
}

function layout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const titlebar = mainWindow.contentView.children[0];
  const content = mainWindow.contentView.children[1];
  if (!titlebar || !content) return;
  titlebar.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
  content.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: Math.max(0, height - TITLEBAR_HEIGHT) });
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

  const titlebar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload-titlebar.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  const content = new WebContentsView({ webPreferences: pageOptions });
  titlebarContents = titlebar.webContents;

  win.contentView.addChildView(titlebar);
  win.contentView.addChildView(content);
  win.on("resize", layout);
  win.on("maximize", sendChromeState);
  win.on("unmaximize", sendChromeState);
  layout();

  titlebar.webContents.on("did-finish-load", () => {
    sendChromeState();
    if (!win.isDestroyed() && !win.isVisible()) {
      layout();
      win.maximize();
      win.show();
      setTimeout(sendChromeState, 120);
    }
  });
  content.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(WINDOW_TITLE);
  });
  content.webContents.on("did-fail-load", (_event, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (!isAllowedUrl(url) && url !== APP_URL) return;
    setTimeout(() => {
      if (!content.webContents.isDestroyed()) content.webContents.loadURL(APP_URL);
    }, 4000);
  });

  titlebar.webContents.loadFile(path.join(__dirname, "titlebar.html"));
  content.webContents.loadURL(APP_URL);
  win.on("closed", () => {
    mainWindow = null;
    titlebarContents = null;
  });
}

ipcMain.on("loket-window", (event, action) => {
  if (!mainWindow || mainWindow.isDestroyed() || !titlebarContents || event.sender !== titlebarContents) return;
  if (action === "minimize") mainWindow.minimize();
  if (action === "toggle-maximize") {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
  if (action === "close") mainWindow.close();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  app.on("web-contents-created", (_event, contents) => harden(contents));
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
