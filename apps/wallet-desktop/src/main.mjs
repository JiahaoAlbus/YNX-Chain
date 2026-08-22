import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_RPC_URL, probeYNXTestnetRPC } from "./rpc.mjs";
import { YNX_TESTNET_CHAIN_QUANTITY } from "./wallet-auth-contract.mjs";
import { decisionForReview, evaluateWalletCallback } from "./callback-policy.mjs";
import { DesktopWalletVault } from "./desktop-wallet-vault.mjs";
import { DesktopWalletAuthority } from "./desktop-wallet-authority.mjs";
import { FilePermissionStore } from "./desktop-permission-store.mjs";
import { CanonicalTransactionSender } from "./canonical-transaction-sender.mjs";
import { WalletConnectTransport } from "./walletconnect-transport.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
// Canonical public RPC from Central endpoint matrix d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59.
const rpcUrl = process.env.YNX_WALLET_RPC_URL || CANONICAL_RPC_URL;
const evidencePath = process.env.YNX_WALLET_EVIDENCE_PATH;
let mainWindow;
let pendingReview;
let lastCallback = null;
let walletAuthority;
let walletConnect;
const walletConnectRequests = new Map();

async function rpcStatus() {
  return probeYNXTestnetRPC({ rpcUrl, expectedChainId: YNX_TESTNET_CHAIN_QUANTITY });
}

async function recordEvidence(status, window, { launch = false } = {}) {
  if (!evidencePath) return;
  let prior = { launches: 0 };
  try { prior = JSON.parse(await readFile(evidencePath, "utf8")); } catch {}
  const authority = walletAuthority ? await walletAuthority.accountStatus() : { initialized: false, account: null, custody: "not-created" };
  const evidence = {
    schemaVersion: 1,
    appVersion: app.getVersion(),
    launches: Number(prior.launches || 0) + (launch ? 1 : 0),
    visibleShellReady: true,
    window: {
      title: window.getTitle(),
      visible: window.isVisible(),
      destroyed: window.isDestroyed()
    },
    walletAuthContract: { imported: true, expectedChainId: YNX_TESTNET_CHAIN_QUANTITY },
    rpc: status,
    providerAuthority: {
      accountCreated: authority.initialized,
      approvedAccount: authority.account,
      custody: authority.custody,
      externalAccountExposureRequiresOriginApproval: true,
      supportedMethods: ["eth_chainId", "eth_accounts", "eth_requestAccounts", "wallet_getPermissions", "wallet_requestPermissions", "wallet_revokePermissions", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]
    },
    accountCreated: false,
    balanceClaimed: false,
    transactionCreated: false,
    signingEnabled: authority.initialized,
    callback: lastCallback ?? prior.callback ?? {
      received: false,
      acceptedForReview: false,
      callbackEmitted: false,
      authorityGranted: false
    }
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

ipcMain.handle("wallet:status", rpcStatus);
ipcMain.handle("wallet:authorization-action", async (_event, action) => {
  const result = decisionForReview(pendingReview, action);
  lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: false, authorityGranted: false };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(`YNX Wallet · ${result.code}`);
    await recordEvidence(await rpcStatus(), mainWindow);
  }
  return result;
});

ipcMain.handle("wallet:account-status", () => safeIPC(() => walletAuthority.accountStatus()));
ipcMain.handle("wallet:create-account", () => safeIPC(async () => {
  const result = await walletAuthority.createAccount();
  mainWindow?.webContents.send("wallet:account-status-result", result);
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return result;
}));
ipcMain.handle("wallet:permissions", (_event, origin) => safeIPC(() => walletAuthority.request({ origin, method: "wallet_getPermissions" })));
ipcMain.handle("wallet:walletconnect-status", () => safeIPC(() => walletConnect.status()));
ipcMain.handle("wallet:walletconnect-pair", (_event, uri) => safeIPC(() => walletConnect.pair(uri)));
ipcMain.handle("wallet:walletconnect-proposal-action", (_event, id, action) => safeIPC(async () => {
  if (action === "reject") { await walletConnect.rejectSession(id); return { rejected: true }; }
  if (action !== "approve") throw Object.assign(new Error("Invalid proposal action"), { code: "INVALID_PROPOSAL_ACTION" });
  const account = await walletAuthority.accountStatus();
  if (!account.initialized) throw Object.assign(new Error("Create an account before approving the session"), { code: "ACCOUNT_NOT_CREATED" });
  const origin = walletConnect.proposalOrigin(id);
  await walletAuthority.approveOrigin(origin);
  try {
    const session = await walletConnect.approveSession(id, account.account);
    return { approved: true, topic: session.topic, origin, account: account.account };
  } catch (error) {
    await walletAuthority.revokeOrigin(origin);
    throw error;
  }
}));
ipcMain.handle("wallet:provider-action", (_event, id, action) => safeIPC(async () => {
  const transport = walletConnectRequests.get(id);
  let response;
  try {
    response = action === "approve" ? await walletAuthority.approve(id) : rejectProviderRequest(id);
  } catch (error) {
    response = { status: "error", code: Number.isInteger(error?.code) ? error.code : 4001, message: error?.message ?? "Provider request failed" };
  }
  if (transport) {
    await walletConnect.respond(transport.topic, transport.jsonRpcId, response);
    walletConnectRequests.delete(id);
  }
  return response;
}));

async function handleCallback(rawValue) {
  const review = evaluateWalletCallback(rawValue);
  pendingReview = review.acceptedForReview ? review : null;
  lastCallback = {
    received: true,
    acceptedForReview: review.acceptedForReview,
    code: review.code,
    callbackEmitted: false,
    authorityGranted: false,
    requestingProduct: review.request?.requestingProduct ?? null
  };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setTitle(`YNX Wallet · ${review.code}`);
  if (review.acceptedForReview) mainWindow.webContents.send("wallet:authorization-request", review);
  else mainWindow.webContents.send("wallet:authorization-error", review);
  await recordEvidence(await rpcStatus(), mainWindow);
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleCallback(url);
});

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  walletAuthority = new DesktopWalletAuthority({
    vault: new DesktopWalletVault({ filePath: path.join(userData, "wallet-vault-v1.json"), safeStorage }),
    permissions: new FilePermissionStore(path.join(userData, "wallet-permissions-v1.json")),
    transactionSender: new CanonicalTransactionSender()
  });
  walletConnect = new WalletConnectTransport({
    projectId: process.env.YNX_WALLETCONNECT_PROJECT_ID,
    metadata: { name: "YNX Wallet", description: "YNX Testnet self-custody Wallet", url: "https://wallet.ynxweb4.com", icons: ["https://www.ynxweb4.com/ynx-icon-512.png"], redirect: { native: "ynxwallet://wc" } }
  });
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "YNX Wallet",
    backgroundColor: "#071016",
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  window.removeMenu();
  await window.loadFile(path.join(directory, "index.html"));
  const status = await rpcStatus();
  await recordEvidence(status, window, { launch: true });
  window.webContents.send("wallet:status-result", status);
  window.webContents.send("wallet:account-status-result", await walletAuthority.accountStatus());
  window.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
  if (pendingReview) window.webContents.send("wallet:authorization-request", pendingReview);
  if (walletConnect.status().configured) {
    try {
      await walletConnect.start({
        onSessionProposal: proposal => window.webContents.send("wallet:walletconnect-proposal", sanitizeProposal(proposal)),
        onSessionRequest: event => void handleWalletConnectRequest(event),
        onSessionDelete: event => window.webContents.send("wallet:walletconnect-session-deleted", { topic: event.topic }),
        onRequestExpire: event => window.webContents.send("wallet:provider-request-expired", { id: String(event.id) })
      });
      window.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
    } catch (error) {
      window.webContents.send("wallet:walletconnect-status-result", { configured: true, connected: false, code: safeCode(error) });
    }
  }
});

app.on("window-all-closed", () => app.quit());

async function handleWalletConnectRequest(event) {
  const { topic, id, params } = event;
  try {
    const response = await walletAuthority.request({ origin: walletConnect.sessionOrigin(topic), method: params.request.method, params: params.request.params });
    if (response.status === "success") return walletConnect.respond(topic, id, response);
    walletConnectRequests.set(response.request.id, { topic, jsonRpcId: id });
    mainWindow?.webContents.send("wallet:provider-request", response.request);
  } catch (error) {
    await walletConnect.respond(topic, id, { status: "error", code: Number.isInteger(error?.code) ? error.code : 4200, message: error?.message ?? "Provider request failed" });
  }
}
function sanitizeProposal(proposal) {
  const metadata = proposal?.params?.proposer?.metadata ?? {};
  const namespace = proposal?.params?.requiredNamespaces?.eip155 ?? {};
  return { id: String(proposal.id), name: boundedText(metadata.name, "Unknown DApp"), url: boundedText(metadata.url, null), requested: { chains: boundedArray(namespace.chains), methods: boundedArray(namespace.methods), events: boundedArray(namespace.events) } };
}
function rejectProviderRequest(id) { walletAuthority.reject(id); }
async function safeIPC(action) { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: { code: safeCode(error), message: error?.message ?? "Wallet request failed" } }; } }
function safeCode(error) { return error?.data?.code ?? error?.code ?? "WALLET_REQUEST_FAILED"; }
function boundedText(value, fallback) { return typeof value === "string" && value.length <= 512 ? value : fallback; }
function boundedArray(value) { return Array.isArray(value) && value.length <= 64 ? value.filter(item => typeof item === "string" && item.length <= 128) : []; }
