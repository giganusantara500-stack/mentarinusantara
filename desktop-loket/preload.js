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
