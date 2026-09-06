import { DesktopKeyLifecycle } from "./key-lifecycle.mjs";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, powerMonitor, safeStorage, shell } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CANONICAL_RPC_URL, probeYNXTestnetRPC } from "./rpc.mjs";
import { YNX_TESTNET_CHAIN_QUANTITY, WALLET_AUTH_PROTOCOL_SOURCE } from "./wallet-auth-contract.mjs";
import { DesktopAuthorizationController, parseWalletConnectActivation } from "./callback-policy.mjs";
import { PasswordWalletVault } from "./password-wallet-vault.mjs";
import { assertWalletIPC } from "./wallet-ipc-policy.mjs";
import { DesktopWalletAuthority } from "./desktop-wallet-authority.mjs";
import { FilePermissionStore } from "./desktop-permission-store.mjs";
import { CanonicalTransactionSender } from "./canonical-transaction-sender.mjs";
import { FileTransactionIntentStore } from "./transaction-intent-store.mjs";
import { CanonicalAccountNetwork, NativeWalletService } from "./native-wallet-service.mjs";
import { WalletConnectTransport } from "./walletconnect-transport.mjs";
import { decodeWalletConnectQR } from "./walletconnect-qr-decoder.mjs";
import { createReceiveCode } from "./receive-code.mjs";
import { canonicalizeWindowsYNXWalletProtocolUrl, extractYNXWalletProtocolUrl } from "./protocol-activation.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
function handleWalletIPC(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { assertWalletIPC(event, mainWindow?.webContents, pathToFileURL(path.join(directory, "index.html")).href); }
    catch (error) { return safeIPC(() => { throw error; }); }
    return handler(event, ...args);
  });
}
const isolatedProfile = process.env.YNX_WALLET_PROFILE_PATH;
if (isolatedProfile) {
  if (!path.isAbsolute(isolatedProfile)) throw new Error("YNX_WALLET_PROFILE_PATH must be an absolute path");
  app.setPath("userData", isolatedProfile);
}
// Canonical public RPC from Central endpoint matrix d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59.
const rpcUrl = process.env.YNX_WALLET_RPC_URL || CANONICAL_RPC_URL;
const evidencePath = process.env.YNX_WALLET_EVIDENCE_PATH;
let mainWindow;
let authorizationController;
let protocolReady = false;
let lastCallback = null;
let walletAuthority;
let nativeWallet;
let walletConnect;
const keyAccess = new DesktopKeyLifecycle({ focused: () => mainWindow?.isFocused() === true });
keyAccess.subscribe(state => {
  if (state.locked && !state.authenticating) {
    authorizationController?.cancel(); walletAuthority?.cancelAll(); nativeWallet?.clear();
    walletConnectRequests.clear(); walletConnectProposalAccounts.clear();
  }
  mainWindow?.webContents.send("wallet:security-state", state);
});
const sensitiveIPC = action => safeIPC(() => keyAccess.run(action));
const walletConnectRequests = new Map();
const walletConnectProposalAccounts = new Map();
const walletConnectProposalActions = new Set();
let accountChangeInProgress = false;
const startupProtocolUrls = [];
let protocolRegistration = { platform: process.platform, attempted: false, registered: false };
const initialProtocolUrl = extractYNXWalletProtocolUrl(process.argv);
if (initialProtocolUrl) queueStartupProtocolUrl(initialProtocolUrl);

function queueStartupProtocolUrl(url) {
  if (startupProtocolUrls.length < 16) startupProtocolUrls.push(url);
}

async function rpcStatus() {
  return probeYNXTestnetRPC({ rpcUrl, expectedChainId: YNX_TESTNET_CHAIN_QUANTITY, fetchImpl: net.fetch.bind(net) });
}

async function recordEvidence(status, window, { launch = false } = {}) {
  if (!evidencePath) return;
  let prior = { launches: 0 };
  try { prior = JSON.parse(await readFile(evidencePath, "utf8")); } catch {}
  const accountRead = walletAuthority ? await safeIPC(() => walletAuthority.accountStatus()) : null;
  const authority = accountRead?.ok ? accountRead.value : { initialized: null, account: null, custody: "unavailable", accountReadFailed: true };
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
    walletAuthContract: { ...WALLET_AUTH_PROTOCOL_SOURCE, imported: true, expectedChainId: YNX_TESTNET_CHAIN_QUANTITY },
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
    signingEnabled: authority.initialized === true && !authority.recoveryRequired && !keyAccess.status().locked,
    keySecurity: keyAccess.status(),
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

handleWalletIPC("wallet:status", rpcStatus);
handleWalletIPC("wallet:security-status", () => keyAccess.status());
handleWalletIPC("wallet:unlock", (_event, input) => safeIPC(() => {
  if (accountChangeInProgress) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  return keyAccess.unlock(input);
}));
handleWalletIPC("wallet:lock", () => { keyAccess.lock(); return keyAccess.status(); });
handleWalletIPC("wallet:password-setup", (_event, input) => safeIPC(() => custodyChange((guard, beforePublish) => walletAuthority.vault.setup(input, guard, { beforePublish }))));
handleWalletIPC("wallet:recovery-history", () => safeIPC(() => walletAuthority.vault.recoveryHistory()));
handleWalletIPC("wallet:recovery-preview", (_event, input) => safeIPC(() => {
  if (accountChangeInProgress) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  return keyAccess.custody(guard => walletAuthority.vault.prepareRecovery(input, guard));
}));
handleWalletIPC("wallet:recovery-commit", (_event, previewId) => safeIPC(() => custodyChange((guard, beforePublish) => walletAuthority.vault.commitRecovery(previewId, guard, { beforePublish }))));
handleWalletIPC("wallet:authorization-action", async (_event, input) => {
  const action = typeof input === "string" ? input : input?.action;
  try {
    if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: "ACCOUNT_CHANGED" });
    const result = await keyAccess.run(() => authorizationController.act(input));
    lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: result.callbackEmitted, callbackReceivedProved: false, authorityGranted: result.authorityGranted, productSessionCreated: false };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle("YNX Wallet");
      await recordEvidence(await rpcStatus(), mainWindow);
    }
    return result;
  } catch (error) {
    return authorizationFailure(error.authorizationStage ?? error.code ?? "CANONICAL_AUTHORIZATION_SIGN_FAILED", action, error);
  }
});

async function authorizationFailure(stageCode, action, error) {
  const underlyingCode = safeCode(error);
  const outcomeUnknown = error?.data?.outcomeUnknown === true;
  const result = { acceptedForReview: Boolean(authorizationController?.pending), action, code: stageCode, underlyingCode, failureClass: safeErrorClass(error), failureCategory: safeFailureCategory(error), callbackEmitted: outcomeUnknown ? null : false, callbackOutcomeUnknown: outcomeUnknown, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false };
  lastCallback = { ...(lastCallback ?? {}), action, result, callbackEmitted: result.callbackEmitted, callbackOutcomeUnknown: outcomeUnknown, callbackReceivedProved: false, authorityGranted: false, productSessionCreated: false };
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return result;
}

handleWalletIPC("wallet:account-status", () => safeIPC(() => walletAuthority.accountStatus()));
handleWalletIPC("wallet:import-account", (_event, input) => safeIPC(() => changeActiveAccount(() => walletAuthority.importAccount(input))));
handleWalletIPC("wallet:balance", () => safeIPC(() => nativeWallet.balance()));
handleWalletIPC("wallet:pending-transactions", () => safeIPC(async () => walletAuthority.transactionSender.submissions.list((await walletAuthority.accountStatus()).account)));
handleWalletIPC("wallet:transaction-status", (_event, hash) => safeIPC(async () => walletAuthority.transactionSender.submissions.check(hash, (await walletAuthority.accountStatus()).account)));
handleWalletIPC("wallet:retry-transaction", (_event, hash) => sensitiveIPC(async () => {
  const lease = keyAccess.current(), status = await walletAuthority.accountStatus();
  lease.assert();
  return walletAuthority.transactionSender.submissions.retry(hash, status.account, lease);
}));
handleWalletIPC("wallet:prepare-transfer", (_event, input) => sensitiveIPC(() => nativeWallet.prepareTransfer(input)));
handleWalletIPC("wallet:transfer-action", (_event, id, action) => sensitiveIPC(() => nativeWallet.transferAction(id, action)));
handleWalletIPC("wallet:save-backup", (_event, password) => sensitiveIPC(async () => {
  const status = await walletAuthority.accountStatus();
  if (!status.initialized) throw new Error("Create or import an account first");
  const encrypted = await walletAuthority.vault.encryptedBackup(password);
  const selected = await keyAccess.withOwnedDialog(() => dialog.showSaveDialog(mainWindow, { title: "Save encrypted Wallet backup", defaultPath: `ynx-wallet-${status.account.slice(2, 10)}.json`, filters: [{ name: "Encrypted JSON wallet", extensions: ["json"] }] }));
  if (selected.canceled || !selected.filePath) return { saved: false };
  await keyAccess.current().step(() => writeFile(selected.filePath, encrypted, { mode: 0o600, flag: "wx" }));
  return { saved: true, account: status.account };
}));
handleWalletIPC("wallet:create-account", () => safeIPC(async () => {
  if (authorizationController.inFlight) throw Object.assign(new Error("Finish the current authorization first"), { code: "AUTHORIZATION_ACTION_IN_PROGRESS" });
  const result = await keyAccess.run(() => walletAuthority.createAccount());
  keyAccess.setAccount(result.account);
  mainWindow?.webContents.send("wallet:account-status-result", result);
  const review = await authorizationController.refreshAccount();
  if (review?.acceptedForReview) mainWindow?.webContents.send("wallet:authorization-request", review);
  else if (review) mainWindow?.webContents.send("wallet:authorization-error", review);
  if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
  return result;
}));
handleWalletIPC("wallet:add-account", () => safeIPC(() => changeActiveAccount(() => walletAuthority.addAccountAndSelect())));
handleWalletIPC("wallet:receive-code", (_event, expectedAccount) => safeIPC(() => createReceiveCode(expectedAccount, () => walletAuthority.accountStatus())));
handleWalletIPC("wallet:select-account", (_event, account) => safeIPC(() => changeActiveAccount(() => walletAuthority.selectAccount(account))));
handleWalletIPC("wallet:permissions", (_event, origin) => safeIPC(() => walletAuthority.request({ origin, method: "wallet_getPermissions" })));
handleWalletIPC("wallet:walletconnect-status", () => safeIPC(() => walletConnect.status()));
handleWalletIPC("wallet:walletconnect-sessions", () => safeIPC(() => walletConnect.sessions()));
handleWalletIPC("wallet:walletconnect-pair", (_event, uri) => safeIPC(() => walletConnect.pair(uri)));
handleWalletIPC("wallet:walletconnect-decode-qr", (_event, input) => safeIPC(() => decodeWalletConnectQR({
  bytes: Buffer.from(input?.bytes ?? []),
  mimeType: input?.mimeType,
  createImage: bytes => nativeImage.createFromBuffer(bytes)
})));
handleWalletIPC("wallet:walletconnect-disconnect", (_event, topic) => safeIPC(async () => {
  const origin = walletConnect.sessionOrigin(topic);
  await walletAuthority.revokeOrigin(origin);
  const result = await walletConnect.disconnectSession(topic);
  mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "disconnected", topic, origin });
  return { ...result, localPermissionRevoked: true };
}));
handleWalletIPC("wallet:walletconnect-proposal-action", (_event, id, action, expectedAccount) => sensitiveIPC(async () => {
  const key = String(id);
  if (!["approve", "reject"].includes(action)) throw Object.assign(new Error("Invalid proposal action"), { code: "INVALID_PROPOSAL_ACTION" });
  if (accountChangeInProgress || !walletConnectProposalAccounts.has(key)) throw Object.assign(new Error("The proposal account changed. Connect again from the app."), { code: "ACCOUNT_CHANGED" });
  if (walletConnectProposalActions.has(key)) throw Object.assign(new Error("This proposal is already being processed"), { code: "WALLETCONNECT_PROPOSAL_ACTION_IN_PROGRESS" });
  walletConnectProposalActions.add(key);
  try {
    if (action === "reject") { await walletConnect.rejectSession(id); walletConnectProposalAccounts.delete(key); return { rejected: true }; }
    const account = await walletAuthority.accountStatus();
    if (!account.initialized) throw Object.assign(new Error("Create an account before approving the session"), { code: "ACCOUNT_NOT_CREATED" });
    if (expectedAccount !== walletConnectProposalAccounts.get(key) || expectedAccount !== account.account) throw Object.assign(new Error("The selected account changed. Review a new connection."), { code: "ACCOUNT_CHANGED" });
    const origin = walletConnect.proposalOrigin(id);
    await walletAuthority.approveOrigin(origin, expectedAccount);
    try {
      const session = await keyAccess.current().deliver(() => walletConnect.approveSession(id, expectedAccount));
      walletConnectProposalAccounts.delete(key);
      mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "approved", topic: session.topic, origin });
      return { approved: true, topic: session.topic, origin, account: expectedAccount };
    } catch (error) {
      await walletAuthority.revokeOrigin(origin);
      throw error;
    }
  } finally { walletConnectProposalActions.delete(key); }
}));

handleWalletIPC("wallet:provider-action", (_event, id, action) => sensitiveIPC(async () => {
  const lease = keyAccess.current();
  const transport = walletConnectRequests.get(id);
  let response;
  try {
    if (accountChangeInProgress) throw Object.assign(new Error("The selected account changed"), { code: 4100 });
    response = action === "approve" ? await walletAuthority.approve(id) : rejectProviderRequest(id);
  } catch (error) {
    response = { status: "error", code: Number.isInteger(error?.code) ? error.code : 4001, message: error?.message ?? "Provider request failed", ...(error?.data ? { data: error.data } : {}) };
  }
  if (transport) {
    try { await lease.deliver(() => walletConnect.respond(transport.topic, transport.jsonRpcId, response)); }
    catch (error) {
      if (error?.data?.code === "WALLET_OPERATION_CANCELLED") return { ...response, responseDelivered: false, deliveryCode: "WALLET_OPERATION_CANCELLED" };
      throw error;
    }
    walletConnectRequests.delete(id);
  }
  return { ...response, responseDelivered: Boolean(transport) };
}));

async function handleCallback(rawValue) {
  try {
    const walletConnectActivation = parseWalletConnectActivation(rawValue);
    if (walletConnectActivation) {
      mainWindow?.show(); mainWindow?.focus();
      if (walletConnectActivation.uri) await walletConnect.pair(walletConnectActivation.uri);
      mainWindow?.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
      return;
    }
  } catch (error) {
    mainWindow?.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: safeCode(error) });
    return;
  }
  const review = await authorizationController.receive(canonicalizeWindowsYNXWalletProtocolUrl(rawValue));
  // Keep the current consent visible when another app tries to open a request.
  if (review.code === "AUTHORIZATION_REQUEST_IN_PROGRESS") {
    if (authorizationController.pending && !authorizationController.pending.loadingAccount) mainWindow?.webContents.send("wallet:authorization-request", authorizationController.pending);
    mainWindow?.show(); mainWindow?.focus();
    return;
  }
  lastCallback = {
    received: true, acceptedForReview: review.acceptedForReview, code: review.code,
    callbackEmitted: false, authorityGranted: false,
    requestingProduct: review.request?.productId ?? null,
    activation: protocolActivationFingerprint(rawValue)
  };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show(); mainWindow.focus(); mainWindow.setTitle("YNX Wallet");
  if (review.acceptedForReview) mainWindow.webContents.send("wallet:authorization-request", review);
  else mainWindow.webContents.send("wallet:authorization-error", review);
  await recordEvidence(await rpcStatus(), mainWindow);
}

async function changeActiveAccount(change) {
  if (accountChangeInProgress || walletConnectProposalActions.size) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  keyAccess.assertUnlocked();
  keyAccess.cancelOperations();
  const invalidatedAuthorizationId = authorizationController.pending?.id;
  if (authorizationController.cancel()) mainWindow?.webContents.send("wallet:authorization-error", { acceptedForReview: false, code: "ACCOUNT_CHANGED", requestId: invalidatedAuthorizationId, callbackEmitted: false, authorityGranted: false });
  accountChangeInProgress = true;
  try {
    nativeWallet?.clear();
    const proposals = [...walletConnectProposalAccounts.keys()];
    walletConnectProposalAccounts.clear();
    for (const id of proposals) { try { await walletConnect.rejectSession(id); } catch {} }
    for (const [id, transport] of walletConnectRequests) {
      walletAuthority.expire(id);
      mainWindow?.webContents.send("wallet:provider-request-expired", { id, code: "ACCOUNT_CHANGED" });
      try { await walletConnect.respond(transport.topic, transport.jsonRpcId, { status: "error", code: 4100, message: "The selected account changed" }); } catch {}
    }
    walletConnectRequests.clear();
    const sessions = walletConnect?.sessions?.() ?? [];
    const remoteDisconnectFailures = [];
    for (const session of sessions) {
      try { await walletConnect.disconnectSession(session.topic); } catch (error) { remoteDisconnectFailures.push({ topic: session.topic, code: safeCode(error) }); }
    }
    const status = await keyAccess.run(change);
    keyAccess.setAccount(status.account);
    mainWindow?.webContents.send("wallet:account-status-result", status);
    mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "account-switched", cancelledProposalIds: proposals, disconnectedSessions: sessions.length - remoteDisconnectFailures.length, remoteDisconnectFailures });
    if (mainWindow && !mainWindow.isDestroyed()) await recordEvidence(await rpcStatus(), mainWindow);
    return { ...status, dappPermissionsRevoked: true, disconnectedSessions: sessions.length - remoteDisconnectFailures.length, remoteDisconnectFailures };
  } finally { accountChangeInProgress = false; }
}

async function custodyChange(change) {
  if (accountChangeInProgress || walletConnectProposalActions.size) throw Object.assign(new Error("Finish the current account action first"), { code: "ACCOUNT_CHANGE_IN_PROGRESS" });
  accountChangeInProgress = true;
  try {
    const status = await keyAccess.custody(async guard => {
      // The repository first validates the exact review, file identity and staged
      // readback. Revoke only that live commit, still before publishing new keys.
      return change(guard, () => guard.step(() => walletAuthority.permissions.revokeAll()));
    });
    keyAccess.setAccount(status.account); keyAccess.lock();
    mainWindow?.webContents.send("wallet:account-status-result", status);
    const remoteDisconnectFailures = [];
    for (const session of walletConnect?.sessions?.() ?? []) {
      try { await walletConnect.disconnectSession(session.topic); }
      catch (error) { remoteDisconnectFailures.push({ topic: session.topic, code: safeCode(error) }); }
    }
    mainWindow?.webContents.send("wallet:walletconnect-session-changed", { type: "custody-changed", remoteDisconnectFailures });
    return { ...status, remoteDisconnectFailures };
  } finally { accountChangeInProgress = false; }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!protocolReady) queueStartupProtocolUrl(url);
  else void handleCallback(url);
});

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
app.on("second-instance", (_event, argv) => {
  const url = extractYNXWalletProtocolUrl(argv);
  if (url) {
    if (!protocolReady) queueStartupProtocolUrl(url);
    else void handleCallback(url);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
});

if (singleInstanceLock) app.whenReady().then(async () => {
  if (process.platform === "win32" && !isolatedProfile) {
    const accepted = app.setAsDefaultProtocolClient("ynxwallet");
    protocolRegistration = { platform: process.platform, attempted: true, registered: accepted && app.isDefaultProtocolClient("ynxwallet") };
  }
  const userData = app.getPath("userData");
  const accountNetwork = new CanonicalAccountNetwork({ fetchImpl: net.fetch.bind(net) });
  const passwordVault = new PasswordWalletVault({ filePath: path.join(userData, "wallet-vault-v3.json"), legacyFilePaths: [path.join(userData, "wallet-vault-v2.json"), path.join(userData, "wallet-vault-v1.json")], safeStorage, authorization: keyAccess });
  keyAccess.authorizer = passwordVault.authorizer();
  walletAuthority = new DesktopWalletAuthority({
    vault: passwordVault,
    permissions: new FilePermissionStore(path.join(userData, "wallet-permissions-v1.json")),
    transactionSender: new CanonicalTransactionSender({ network: accountNetwork, fetchImpl: net.fetch.bind(net), intentStore: new FileTransactionIntentStore({ filePath: path.join(userData, "transaction-intents-v1.json") }) })
  });
  authorizationController = new DesktopAuthorizationController({ authority: walletAuthority, openExternal: url => keyAccess.current().deliver(() => shell.openExternal(url)) });
  nativeWallet = new NativeWalletService({ vault: walletAuthority.vault, sender: walletAuthority.transactionSender, network: accountNetwork });
  walletConnect = new WalletConnectTransport({
    projectId: process.env.YNX_WALLETCONNECT_PROJECT_ID,
    metadata: { name: "YNX Wallet", description: "YNX Testnet self-custody Wallet", url: "https://wallet.ynxweb4.com", icons: ["https://www.ynxweb4.com/ynx-icon-512.png"], redirect: { native: "ynxwallet://wc" } }
  });
  const window = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    title: "YNX Wallet",
    backgroundColor: "#ffffff",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 20, y: 18 } } : {}),
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  window.on("blur", () => keyAccess.setFocused(false));
  window.on("focus", () => keyAccess.setFocused(true));
  window.on("minimize", () => keyAccess.lock());
  window.on("close", () => keyAccess.lock());
  for (const event of ["suspend", "lock-screen"]) powerMonitor.on(event, () => keyAccess.lock());
  const initialAccount = await safeIPC(() => walletAuthority.accountStatus());
  if (initialAccount.ok) keyAccess.setAccount(initialAccount.value.account);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== pathToFileURL(path.join(directory, "index.html")).href) event.preventDefault();
  });
  window.removeMenu();
  await window.loadFile(path.join(directory, "index.html"));
  const status = await rpcStatus();
  await recordEvidence(status, window, { launch: true });
  window.webContents.send("wallet:status-result", status);
  window.webContents.send("wallet:account-status-result", await safeIPC(() => walletAuthority.accountStatus()));
  window.webContents.send("wallet:walletconnect-status-result", walletConnect.status());
  if (walletConnect.status().configured) {
    try {
      await walletConnect.start({
        onSessionProposal: async proposal => {
          try { window.webContents.send("wallet:walletconnect-proposal", await sanitizeProposal(proposal)); }
          catch (error) { window.webContents.send("wallet:walletconnect-status-result", { ...walletConnect.status(), code: safeCode(error) }); }
        },
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
  protocolReady = true;
  for (const url of startupProtocolUrls.splice(0, 16)) await handleCallback(url);
});

app.on("window-all-closed", () => app.quit());

async function handleWalletConnectRequest(event) {
  const { topic, id } = event;
  try {
    if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: 4100 });
    await keyAccess.run(async lease => {
      const selected = await walletAuthority.accountStatus();
      lease.assert();
      const authorized = walletConnect.authorizeRequest(event, selected.account);
      const response = await walletAuthority.request({ origin: authorized.origin, method: authorized.method, params: authorized.params });
      lease.assert();
      if (response.status === "success") { await lease.deliver(() => walletConnect.respond(topic, id, response)); return; }
      walletConnectRequests.set(response.request.id, { topic: authorized.topic, jsonRpcId: authorized.jsonRpcId });
      mainWindow?.webContents.send("wallet:provider-request", response.request);
    });
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
async function sanitizeProposal(proposal) {
  if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: "ACCOUNT_CHANGED" });
  const metadata = proposal?.params?.proposer?.metadata ?? {};
  const namespace = walletConnect.proposalPermissions(proposal.id);
  const selected = await walletAuthority.accountStatus();
  if (accountChangeInProgress) throw Object.assign(new Error("The selected account is changing"), { code: "ACCOUNT_CHANGED" });
  const permissions = { chains: boundedArray(namespace.chains), methods: boundedArray(namespace.methods), events: boundedArray(namespace.events) };
  walletConnectProposalAccounts.set(String(proposal.id), selected.account);
  return { id: String(proposal.id), account: selected.account, name: boundedText(metadata.name, "Unknown DApp"), url: boundedText(metadata.url, null), expiresAt: new Date(proposal.expiryTimestamp * 1000).toISOString(), requested: permissions, permissions, methods: permissions.methods };
}
function rejectProviderRequest(id) { walletAuthority.reject(id); }
function protocolActivationFingerprint(value) {
  const text = typeof value === "string" ? value : "";
  let route = { scheme: null, host: null, pathname: null, queryKeys: [], hasHash: false };
  try { const url = new URL(text); route = { scheme: url.protocol, host: url.hostname, pathname: url.pathname, queryKeys: [...url.searchParams.keys()], hasHash: Boolean(url.hash) }; } catch {}
  return Object.freeze({ bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"), ...route });
}
async function safeIPC(action) { try { return { ok: true, value: await action() }; } catch (error) { return { ok: false, error: { code: safeCode(error), message: error?.message ?? "Wallet request failed", ...(error?.data?.outcomeUnknown ? { outcomeUnknown: true, transactionHash: error.data.transactionHash ?? null } : {}) } }; } }
function safeCode(error) { return error?.data?.code ?? error?.code ?? "WALLET_REQUEST_FAILED"; }
function safeErrorClass(error) { return typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "Error"; }
function safeFailureCategory(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/decrypt|ciphertext|safeStorage/i.test(message)) return "OS_SECRET_DECRYPT_FAILED";
  if (/expir|issued.*time|time.*window/i.test(message)) return "AUTHORIZATION_TIME_INVALID";
  if (/secret|private key|signing key/i.test(message)) return "WALLET_SECRET_INVALID";
  return "SIGNING_RUNTIME_ERROR";
}
function boundedText(value, fallback) { return typeof value === "string" && value.length <= 512 ? value : fallback; }
function boundedArray(value) { return Array.isArray(value) && value.length <= 64 ? value.filter(item => typeof item === "string" && item.length <= 128) : []; }
