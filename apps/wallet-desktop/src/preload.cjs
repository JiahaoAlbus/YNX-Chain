const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ynxWallet", {
  status: () => ipcRenderer.invoke("wallet:status"),
  onStatus: callback => ipcRenderer.on("wallet:status-result", (_event, value) => callback(value)),
  onAuthorizationRequest: callback => ipcRenderer.on("wallet:authorization-request", (_event, value) => callback(value)),
  onAuthorizationError: callback => ipcRenderer.on("wallet:authorization-error", (_event, value) => callback(value)),
  authorizationAction: action => ipcRenderer.invoke("wallet:authorization-action", action)
});
