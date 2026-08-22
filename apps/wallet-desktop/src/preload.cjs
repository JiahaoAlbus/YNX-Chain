const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ynxWallet", {
  status: () => ipcRenderer.invoke("wallet:status"),
  onStatus: callback => ipcRenderer.on("wallet:status-result", (_event, value) => callback(value)),
  onAuthorizationRequest: callback => ipcRenderer.on("wallet:authorization-request", (_event, value) => callback(value)),
  onAuthorizationError: callback => ipcRenderer.on("wallet:authorization-error", (_event, value) => callback(value)),
  authorizationAction: action => ipcRenderer.invoke("wallet:authorization-action", action),
  accountStatus: () => ipcRenderer.invoke("wallet:account-status"),
  createAccount: () => ipcRenderer.invoke("wallet:create-account"),
  addAccount: () => ipcRenderer.invoke("wallet:add-account"),
  selectAccount: account => ipcRenderer.invoke("wallet:select-account", account),
  onAccountStatus: callback => ipcRenderer.on("wallet:account-status-result", (_event, value) => callback(value)),
  walletConnectStatus: () => ipcRenderer.invoke("wallet:walletconnect-status"),
  walletConnectSessions: () => ipcRenderer.invoke("wallet:walletconnect-sessions"),
  walletConnectPair: uri => ipcRenderer.invoke("wallet:walletconnect-pair", uri),
  walletConnectDisconnect: topic => ipcRenderer.invoke("wallet:walletconnect-disconnect", topic),
  walletConnectProposalAction: (id, action) => ipcRenderer.invoke("wallet:walletconnect-proposal-action", id, action),
  onWalletConnectStatus: callback => ipcRenderer.on("wallet:walletconnect-status-result", (_event, value) => callback(value)),
  onWalletConnectProposal: callback => ipcRenderer.on("wallet:walletconnect-proposal", (_event, value) => callback(value)),
  onWalletConnectSessionChanged: callback => ipcRenderer.on("wallet:walletconnect-session-changed", (_event, value) => callback(value)),
  onProviderRequestExpired: callback => ipcRenderer.on("wallet:provider-request-expired", (_event, value) => callback(value)),
  onProviderRequest: callback => ipcRenderer.on("wallet:provider-request", (_event, value) => callback(value)),
  providerAction: (id, action) => ipcRenderer.invoke("wallet:provider-action", id, action)
});
