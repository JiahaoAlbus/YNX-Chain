import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_RPC_URL, probeYNXTestnetRPC } from "./rpc.mjs";
import { YNX_TESTNET_CHAIN_QUANTITY } from "./wallet-auth-contract.mjs";
import { decisionForReview, evaluateWalletCallback } from "./callback-policy.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
// Canonical public RPC from Central endpoint matrix d0f89797d13c7667cc187b0c64d5c9e1cb1d8f59.
const rpcUrl = process.env.YNX_WALLET_RPC_URL || CANONICAL_RPC_URL;
const evidencePath = process.env.YNX_WALLET_EVIDENCE_PATH;
let mainWindow;
let pendingReview;
let lastCallback = null;

async function rpcStatus() {
  return probeYNXTestnetRPC({ rpcUrl, expectedChainId: YNX_TESTNET_CHAIN_QUANTITY });
}

async function recordEvidence(status, window, { launch = false } = {}) {
  if (!evidencePath) return;
  let prior = { launches: 0 };
  try { prior = JSON.parse(await readFile(evidencePath, "utf8")); } catch {}
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
    accountCreated: false,
    balanceClaimed: false,
    transactionCreated: false,
    signingEnabled: false,
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
  if (pendingReview) window.webContents.send("wallet:authorization-request", pendingReview);
});

app.on("window-all-closed", () => app.quit());
