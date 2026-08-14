import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { YNX_TESTNET_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";

const directory = path.dirname(fileURLToPath(import.meta.url));
const rpcUrl = process.env.YNX_WALLET_RPC_URL || "https://evm.ynxweb4.com";
const evidencePath = process.env.YNX_WALLET_EVIDENCE_PATH;

async function rpcStatus() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.result !== YNX_TESTNET_CHAIN_QUANTITY) throw new Error("wrong chain");
    return { available: true, chainId: payload.result, endpoint: rpcUrl, signingEnabled: false };
  } catch {
    return { available: false, chainId: null, endpoint: rpcUrl, signingEnabled: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function recordEvidence(status, window) {
  if (!evidencePath) return;
  let prior = { launches: 0 };
  try { prior = JSON.parse(await readFile(evidencePath, "utf8")); } catch {}
  const evidence = {
    schemaVersion: 1,
    launches: Number(prior.launches || 0) + 1,
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
    signingEnabled: false
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

ipcMain.handle("wallet:status", rpcStatus);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "YNX Wallet Testnet Preview",
    backgroundColor: "#071016",
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.removeMenu();
  await window.loadFile(path.join(directory, "index.html"));
  const status = await rpcStatus();
  await recordEvidence(status, window);
  window.webContents.send("wallet:status-result", status);
});

app.on("window-all-closed", () => app.quit());
