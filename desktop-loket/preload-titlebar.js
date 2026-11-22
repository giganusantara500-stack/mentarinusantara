const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loketChrome", {
  minimize() {
    ipcRenderer.send("loket-window", "minimize");
  },
  toggleMaximize() {
    ipcRenderer.send("loket-window", "toggle-maximize");
  },
  close() {
    ipcRenderer.send("loket-window", "close");
  },
  onState(callback) {
    ipcRenderer.on("loket-maximized", (_event, maximized) => callback(Boolean(maximized)));
  },
});
