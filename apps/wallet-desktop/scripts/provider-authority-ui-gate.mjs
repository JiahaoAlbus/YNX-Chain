import { readFile } from "node:fs/promises";

const [targetsPath, action, expectedAccount = ""] = process.argv.slice(2);
if (!targetsPath || !["create", "restore", "switch"].includes(action)) {
  throw new Error("usage: provider-authority-ui-gate.mjs <targets.json> <create|restore|switch> [expected-account]");
}

const targets = JSON.parse(await readFile(targetsPath, "utf8"));
const target = targets.find(candidate => candidate.type === "page" && candidate.webSocketDebuggerUrl);
if (!target) throw new Error("no Electron page target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
async function evaluate(expression) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => {
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) reject(new Error(JSON.stringify(payload)));
      else resolve(payload.result.result.value);
    };
    socket.addEventListener("message", listener);
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return response;
}

async function readState() {
  return JSON.parse(await evaluate(`(async () => {
    const [accountResponse, connectionResponse] = await Promise.all([
      window.ynxWallet.accountStatus(),
      window.ynxWallet.walletConnectStatus()
    ]);
    const account = accountResponse?.ok === true ? accountResponse.value : null;
    const connection = connectionResponse?.ok === true ? connectionResponse.value : null;
    return JSON.stringify({
    title: document.title,
    nativeAccount: account && {
      initialized: account.initialized,
      account: account.account,
      ynxAccount: account.ynxAccount,
      custody: account.custody,
      secretExported: account.secretExported
    },
    nativeWalletConnect: connection && {
      configured: connection.configured,
      started: connection.started,
      relayConnected: connection.relayConnected,
      activeSessionCount: connection.activeSessionCount,
      code: connection.code
    },
    accountVisible: Boolean(document.querySelector("#account-title")?.getClientRects().length),
    connectionVisible: Boolean(document.querySelector("#walletconnect-title")?.getClientRects().length),
    signingVisible: Boolean(document.querySelector("#signing-short")?.getClientRects().length),
    accountTitle: document.querySelector("#account-title")?.textContent,
    accountDetail: document.querySelector("#account-detail")?.textContent,
    accountButtonHidden: document.querySelector("#create-account")?.hidden,
    accountButtonDisabled: document.querySelector("#create-account")?.disabled,
    addAccountHidden: document.querySelector("#add-account")?.hidden,
    addAccountDisabled: document.querySelector("#add-account")?.disabled,
    accountCount: document.querySelectorAll("#account-list button").length,
    selectedAccount: document.querySelector("#account-list button:disabled")?.dataset.account?.toLowerCase(),
    signing: document.querySelector("#signing-short")?.textContent,
    walletConnectTitle: document.querySelector("#walletconnect-title")?.textContent,
    walletConnectDetail: document.querySelector("#walletconnect-detail")?.textContent,
    pairDisabled: document.querySelector("#walletconnect-pair")?.disabled
  }); })()`));
}

function visibleAccount(state) {
  return state.accountDetail?.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
}

function accountReady(state) {
  const native = state.nativeAccount;
  const account = visibleAccount(state);
  return native?.initialized === true && account && native.account?.toLowerCase() === account
    && state.selectedAccount === account && native.ynxAccount && state.accountDetail.includes(native.ynxAccount)
    && native.custody === "os-encrypted-local" && native.secretExported === false
    && state.accountButtonHidden && state.signing === "Approval required";
}

function walletConnectUnavailable(state) {
  const native = state.nativeWalletConnect;
  return native?.configured === false && native.started === false && native.relayConnected === false
    && native.activeSessionCount === 0 && native.code === "WALLETCONNECT_PROJECT_ID_UNAVAILABLE"
    && state.connectionVisible && state.pairDisabled && Boolean(state.walletConnectTitle?.trim())
    && Boolean(state.walletConnectDetail?.trim()) && !state.walletConnectDetail.includes(native.code);
}

let before;
await evaluate(`document.querySelector('nav [data-view="connections"]')?.click(); true`);
for (let attempt = 0; attempt < 30; attempt += 1) {
  before = await readState();
  if (walletConnectUnavailable(before)) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (before.title !== "YNX Wallet") throw new Error(`unexpected window title: ${JSON.stringify(before)}`);
if (!walletConnectUnavailable(before)) {
  throw new Error(`WalletConnect missing-project state did not fail closed visibly: ${JSON.stringify(before)}`);
}
const connectionBefore = before;
await evaluate(`document.querySelector('nav [data-view="accounts"]')?.click(); true`);
before = await readState();
if (!before.accountVisible) throw new Error("Account management panel is not visible");

if (action === "create") {
  if (before.nativeAccount?.initialized !== false || before.accountCount !== 0 || before.accountButtonHidden || before.accountButtonDisabled) throw new Error(`fresh account boundary mismatch: ${JSON.stringify(before)}`);
  await evaluate(`document.querySelector("#create-account").click(); true`);
}

let after;
for (let attempt = 0; attempt < 60; attempt += 1) {
  after = await readState();
  if (accountReady(after)) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
const account = visibleAccount(after);
await evaluate(`document.querySelector('nav [data-view="accounts"]')?.click(); true`);
after = await readState();
if (!after.accountVisible || !accountReady(after) || visibleAccount(after) !== account) {
  throw new Error(`secure account UI did not become ready: ${JSON.stringify(after)}`);
}
if (action === "restore" && (!expectedAccount || account !== expectedAccount.toLowerCase())) {
  throw new Error(`restored account mismatch: expected ${expectedAccount}, got ${account}`);
}

let switched = null;
if (action === "switch") {
  if (!expectedAccount || account !== expectedAccount.toLowerCase() || after.addAccountHidden || after.addAccountDisabled) {
    throw new Error(`account-switch starting state mismatch: ${JSON.stringify(after)}`);
  }
  await evaluate(`document.querySelector("#add-account").click(); true`);
  let added;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    added = await readState();
    if (accountReady(added) && visibleAccount(added) !== account && added.accountCount === 2 && !added.addAccountDisabled) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const addedAccount = visibleAccount(added);
  if (!accountReady(added) || addedAccount === account || added.accountCount !== 2 || added.addAccountDisabled) throw new Error(`new account was not selected visibly: ${JSON.stringify(added)}`);
  const selected = await evaluate(`(() => { const button = [...document.querySelectorAll("#account-list button")].find(item => item.dataset.account === ${JSON.stringify(account)}); if (!button) return false; button.click(); return true; })()`);
  if (!selected) throw new Error(`original account switch control missing: ${account}`);
  let restored;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    restored = await readState();
    if (accountReady(restored) && visibleAccount(restored) === account && restored.accountCount === 2) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const restoredAccount = visibleAccount(restored);
  if (!accountReady(restored) || restoredAccount !== account || restored.accountCount !== 2) throw new Error(`original account was not restored visibly: ${JSON.stringify(restored)}`);
  switched = { addedAccount, restoredAccount, visibleAccountCount: restored.accountCount };
  after = restored;
}

await evaluate(`document.querySelector('nav [data-view="connections"]')?.click(); true`);
const connectionAfter = await readState();
if (!connectionAfter.signingVisible || !accountReady(connectionAfter) || !walletConnectUnavailable(connectionAfter)) throw new Error("Signing approval requirement or WalletConnect fail-closed state is not visible");
await evaluate(`document.querySelector('nav [data-view="accounts"]')?.click(); true`);
socket.close();
console.log(JSON.stringify({
  action,
  account,
  visibleAuthority: true,
  osEncryptedCustodyVisible: true,
  custodyEvidenceSource: "native-account-status-matched-to-visible-account",
  secretDecryptionProved: false,
  approvalRequiredVisible: true,
  walletConnectConfigured: false,
  walletConnectFailClosedVisible: true,
  switched,
  before,
  after,
  connectionBefore,
  connectionAfter
}, null, 2));
