import { app, BrowserWindow, ipcMain, nativeImage, safeStorage, shell } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_RPC_URL, probeYNXTestnetRPC } from "./rpc.mjs";
import { YNX_TESTNET_CHAIN_QUANTITY } from "./wallet-auth-contract.mjs";
import { CANONICAL_AUTHORIZATION_APPROVED, evaluateWalletCallback } from "./callback-policy.mjs";
import { DesktopWalletVault } from "./desktop-wallet-vault.mjs";
import { DesktopWalletAuthority } from "./desktop-wallet-authority.mjs";
import { FilePermissionStore } from "./desktop-permission-store.mjs";
import { CanonicalTransactionSender } from "./canonical-transaction-sender.mjs";
import { WalletConnectTransport } from "./walletconnect-transport.mjs";
import { decodeWalletConnectQR } from "./walletconnect-qr-decoder.mjs";
import { canonicalizeWindowsYNXWalletProtocolUrl, extractYNXWalletProtocolUrl } from "./protocol-activation.mjs";

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
const startupProtocolUrls = [];
let protocolRegistration = { platform: process.platform, attempted: false, registered: false };
const initialProtocolUrl = extractYNXWalletProtocolUrl(process.argv);
if (initialProtocolUrl) queueStartupProtocolUrl(initialProtocolUrl);

function queueStartupProtocolUrl(url) {
  if (startupProtocolUrls.length < 16) startupProtocolUrls.push(url);
}

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
    },
    protocolRegistration
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

ipcMain.handle("wallet:status", rpcStatus);
ipcMain.handle("wallet:authorization-action", async (_event, action) => {
  if (!pendingReview?.acceptedForReview) return { acceptedForReview: false, code: "NO_PENDING_AUTHORIZATION_REQUEST", callbackEmitted: false, authorityGranted: false };
  if (action !== "approve" && action !== "reject") return { acceptedForReview: false, code: "INVALID_AUTHORIZATION_ACTION", callbackEmitted: false, authorityGranted: false };
  if (action === "reject") {
    const result = Object.freeze({ acceptedForReview: true, action, code: "USER_REJECTED", callbackEmitted: false, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false });
    lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: false, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false };
    pendingReview = null;
    if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
    return result;
  }
  const at = new Date().toISOString();
  let callback;
  try {
    callback = await walletAuthority.approveCanonicalAuthorization(pendingReview.request, at);
  } catch (error) {
    return authorizationFailure("CANONICAL_AUTHORIZATION_SIGN_FAILED", action, error);
  }
  try {
    await shell.openExternal(callback.callbackUrl);
    const result = Object.freeze({
      acceptedForReview: true,
      action,
      code: CANONICAL_AUTHORIZATION_APPROVED,
      callbackEmitted: true,
      callbackReceivedProved: false,
      authorityGranted: true,
      productSessionCreated: false
    });
    lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: true, callbackReceivedProved: false, authorityGranted: result.authorityGranted, productSessionCreated: false };
    pendingReview = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`YNX Wallet · ${result.code}`);
      await recordEvidence(await rpcStatus(), mainWindow);
    }
    return result;
  } catch (error) {
    return authorizationFailure("CANONICAL_CALLBACK_LAUNCH_FAILED", action, error);
  }
});

async function authorizationFailure(stageCode, action, error) {
  const underlyingCode = safeCode(error);
  const result = { acceptedForReview: true, action, code: stageCode, underlyingCode, callbackEmitted: false, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false };
  lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: false, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false };
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return result;
}

ipcMain.handle("wallet:account-status", () => safeIPC(() => walletAuthority.accountStatus()));
ipcMain.handle("wallet:create-account", () => safeIPC(async () => {
  const result = await walletAuthority.createAccount();
  mainWindow?.webContents.send("wallet:account-status-result", result);
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return result;
}));
ipcMain.handle("wallet:add-account", () => safeIPC(() => changeActiveAccount(() => walletAuthority.addAccountAndSelect())));
ipcMain.handle("wallet:select-account", (_event, account) => safeIPC(() => changeActiveAccount(() => walletAuthority.selectAccount(account))));
ipcMain.handle("wallet:permissions", (_event, origin) => safeIPC(() => walletAuthority.request({ origin, method: "wallet_getPermissions" })));
ipcMain.handle("wallet:walletconnect-status", () => safeIPC(() => walletConnect.status()));
ipcMain.handle("wallet:walletconnect-sessions", () => safeIPC(() => walletConnect.sessions()));
ipcMain.handle("wallet:walletconnect-pair", (_event, uri) => safeIPC(() => walletConnect.pair(uri)));
ipcMain.handle("wallet:walletconnect-decode-qr", (_event, input) => safeIPC(() => decodeWalletConnectQR({
  bytes: Buffer.from(input?.bytes ?? []),
  mimeType: input?.mimeType,
  createImage: bytes => nativeImage.createFromBuffer(bytes)
})));
ipcMain.handle("wallet:walletconnect-disconnect", (_event, topic) => safeIPC(async () => {
  const origin = walletConnect.sessionOrigin(topic);
  await walletAuthority.revokeOrigin(origin);
  const result = await walletConnect.disconnectSession(topic);
  mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "disconnected", topic, origin });
  return { ...result, localPermissionRevoked: true };
}));
ipcMain.handle("wallet:walletconnect-proposal-action", (_event, id, action) => safeIPC(async () => {
  if (action === "reject") { await walletConnect.rejectSession(id); return { rejected: true }; }
  if (action !== "approve") throw Object.assign(new Error("Invalid proposal action"), { code: "INVALID_PROPOSAL_ACTION" });
  const account = await walletAuthority.accountStatus();
  if (!account.initialized) throw Object.assign(new Error("Create an account before approving the session"), { code: "ACCOUNT_NOT_CREATED" });
  const origin = walletConnect.proposalOrigin(id);
  await walletAuthority.approveOrigin(origin);
  try {
    const session = await walletConnect.approveSession(id, account.account);
    mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "approved", topic: session.topic, origin });
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
  const review = evaluateWalletCallback(canonicalizeWindowsYNXWalletProtocolUrl(rawValue));
  const activation = protocolActivationFingerprint(rawValue);
  if (pendingReview?.acceptedForReview) {
    const busy = { acceptedForReview: false, code: "AUTHORIZATION_REQUEST_IN_PROGRESS", callbackEmitted: false, authorityGranted: false };
    lastCallback = { received: true, activation, ...busy };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("wallet:authorization-error", busy);
    return;
  }
  pendingReview = review.acceptedForReview ? review : null;
  lastCallback = {
    received: true,
    acceptedForReview: review.acceptedForReview,
    code: review.code,
    callbackEmitted: false,
    authorityGranted: false,
    requestingProduct: review.request?.requestingProduct ?? null,
    activation
  };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setTitle(`YNX Wallet · ${review.code}`);
  if (review.acceptedForReview) mainWindow.webContents.send("wallet:authorization-request", review);
  else mainWindow.webContents.send("wallet:authorization-error", review);
  await recordEvidence(await rpcStatus(), mainWindow);
}

async function changeActiveAccount(change) {
  const sessions = walletConnect?.sessions?.() ?? [];
  const remoteDisconnectFailures = [];
  for (const session of sessions) {
    try { await walletConnect.disconnectSession(session.topic); } catch (error) { remoteDisconnectFailures.push({ topic: session.topic, code: safeCode(error) }); }
  }
  const status = await change();
  mainWindow?.webContents.send("wallet:account-status-result", status);
  mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "account-switched", disconnectedSessions: sessions.length - remoteDisconnectFailures.length, remoteDisconnectFailures });
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return { ...status, dappPermissionsRevoked: true, disconnectedSessions: sessions.length - remoteDisconnectFailures.length, remoteDisconnectFailures };
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!walletAuthority) queueStartupProtocolUrl(url);
  else void handleCallback(url);
});

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
app.on("second-instance", (_event, argv) => {
  const url = extractYNXWalletProtocolUrl(argv);
  if (url) {
    if (!walletAuthority) queueStartupProtocolUrl(url);
    else void handleCallback(url);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
});

if (singleInstanceLock) app.whenReady().then(async () => {
  if (process.platform === "win32") {
    const accepted = app.setAsDefaultProtocolClient("ynxwallet");
    protocolRegistration = { platform: process.platform, attempted: true, registered: accepted && app.isDefaultProtocolClient("ynxwallet") };
  }
  const userData = app.getPath("userData");
  walletAuthority = new DesktopWalletAuthority({
    vault: new DesktopWalletVault({ filePath: path.join(userData, "wallet-vault-v2.json"), legacyFilePath: path.join(userData, "wallet-vault-v1.json"), safeStorage }),
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
  for (const url of startupProtocolUrls.splice(0, 16)) await handleCallback(url);
  if (walletConnect.status().configured) {
    try {
      await walletConnect.start({
        onSessionProposal: proposal => window.webContents.send("wallet:walletconnect-proposal", sanitizeProposal(proposal)),
        onSessionRequest: event => void handleWalletConnectRequest(event),
        onSessionDelete: async event => {
          if (event.origin) await walletAuthority.revokeOrigin(event.origin);
          window.webContents.send("wallet:walletconnect-session-changed", { type: "deleted", topic: event.topic, origin: event.origin, localPermissionRevoked: Boolean(event.origin) });
        },
        onSessionRestore: session => window.webContents.send("wallet:walletconnect-session-changed", { type: "restored", topic: session.topic, origin: session.origin }),
        onRequestExpire: event => expireWalletConnectRequest(event.id, window)
      });
      window.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
    } catch (error) {
      window.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: safeCode(error) });
    }
  }
});

app.on("window-all-closed", () => app.quit());

async function handleWalletConnectRequest(event) {
  const { topic, id } = event;
  try {
    const authorized = walletConnect.authorizeRequest(event);
    const response = await walletAuthority.request({ origin: authorized.origin, method: authorized.method, params: authorized.params });
    if (response.status === "success") return walletConnect.respond(topic, id, response);
    walletConnectRequests.set(response.request.id, { topic: authorized.topic, jsonRpcId: authorized.jsonRpcId });
    mainWindow?.webContents.send("wallet:provider-request", response.request);
  } catch (error) {
    await walletConnect.respond(topic, id, { status: "error", code: Number.isInteger(error?.code) ? error.code : 4200, message: error?.message ?? "Provider request failed" });
  }
}
function expireWalletConnectRequest(jsonRpcId, window = mainWindow) {
  const expired = [];
  for (const [requestId, transport] of walletConnectRequests) {
    if (String(transport.jsonRpcId) !== String(jsonRpcId)) continue;
    walletConnectRequests.delete(requestId);
    walletAuthority.expire(requestId);
    expired.push(requestId);
  }
  for (const requestId of expired) window?.webContents.send("wallet:provider-request-expired", { id: requestId, code: "WALLETCONNECT_REQUEST_EXPIRED" });
  return Object.freeze({ jsonRpcId: String(jsonRpcId), expiredRequestIds: Object.freeze(expired) });
}
function sanitizeProposal(proposal) {
  const metadata = proposal?.params?.proposer?.metadata ?? {};
  const namespace = proposal?.params?.requiredNamespaces?.eip155 ?? {};
  return { id: String(proposal.id), name: boundedText(metadata.name, "Unknown DApp"), url: boundedText(metadata.url, null), requested: { chains: boundedArray(namespace.chains), methods: boundedArray(namespace.methods), events: boundedArray(namespace.events) } };
}
function rejectProviderRequest(id) { walletAuthority.reject(id); }
function protocolActivationFingerprint(value) {
  const text = typeof value === "string" ? value : "";
  let route = { scheme: null, host: null, pathname: null, queryKeys: [], hasHash: false };
  try { const url = new URL(text); route = { scheme: url.protocol, host: url.hostname, pathname: url.pathname, queryKeys: [...url.searchParams.keys()], hasHash: Boolean(url.hash) }; } catch {}
  return Object.freeze({ bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"), ...route });
}
async function safeIPC(action) { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: { code: safeCode(error), message: error?.message ?? "Wallet request failed" } }; } }
function safeCode(error) { return error?.data?.code ?? error?.code ?? "WALLET_REQUEST_FAILED"; }
function boundedText(value, fallback) { return typeof value === "string" && value.length <= 512 ? value : fallback; }
function boundedArray(value) { return Array.isArray(value) && value.length <= 64 ? value.filter(item => typeof item === "string" && item.length <= 128) : []; }
