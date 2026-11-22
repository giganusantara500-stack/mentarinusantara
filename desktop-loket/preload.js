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
    ipcRenderer.on("window-maximized", (_event, maximized) => callback(Boolean(maximized)));
  },
});
