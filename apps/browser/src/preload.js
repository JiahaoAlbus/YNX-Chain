import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld("ynxBrowser", Object.freeze({
  snapshot: invoke("browser:snapshot"), openTab: invoke("browser:open-tab"), closeTab: invoke("browser:close-tab"), activateTab: invoke("browser:activate-tab"),
  navigate: invoke("browser:navigate"), goBack: invoke("browser:back"), goForward: invoke("browser:forward"), reload: invoke("browser:reload"),
  bookmark: invoke("browser:bookmark"), permissionDecision: invoke("browser:permission-decision"), securityInfo: invoke("browser:security-info"),
  authorizeWallet: invoke("browser:wallet-authorize"), reviewTransaction: invoke("browser:transaction-review"), aiPrepare: invoke("browser:ai-prepare"), aiCurrentPage: invoke("browser:ai-current-page"), aiRun: invoke("browser:ai-run"), aiCancel: invoke("browser:ai-cancel"), aiReview: invoke("browser:ai-review"),
  onState: callback => ipcRenderer.on("browser:state", (_event, state) => callback(state))
}));
