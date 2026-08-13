const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ynxWallet", {
  status: () => ipcRenderer.invoke("wallet:status"),
  onStatus: callback => ipcRenderer.on("wallet:status-result", (_event, value) => callback(value))
});
