import { readFile } from "node:fs/promises";

const [targetsPath, action, expectedAccount = ""] = process.argv.slice(2);
if (!targetsPath || !["create", "restore"].includes(action)) {
  throw new Error("usage: provider-authority-ui-gate.mjs <targets.json> <create|restore> [expected-account]");
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
  return JSON.parse(await evaluate(`JSON.stringify({
    title: document.title,
    accountTitle: document.querySelector("#account-title")?.textContent,
    accountDetail: document.querySelector("#account-detail")?.textContent,
    accountButtonHidden: document.querySelector("#create-account")?.hidden,
    accountButtonDisabled: document.querySelector("#create-account")?.disabled,
    signing: document.querySelector("#signing-short")?.textContent,
    walletConnectTitle: document.querySelector("#walletconnect-title")?.textContent,
    walletConnectDetail: document.querySelector("#walletconnect-detail")?.textContent,
    pairDisabled: document.querySelector("#walletconnect-pair")?.disabled
  })`));
}

let before;
for (let attempt = 0; attempt < 30; attempt += 1) {
  before = await readState();
  if (before.walletConnectTitle === "WalletConnect not configured") break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (before.title !== "YNX Wallet") throw new Error(`unexpected window title: ${JSON.stringify(before)}`);
if (before.walletConnectTitle !== "WalletConnect not configured" || !before.pairDisabled || !before.walletConnectDetail.includes("WALLETCONNECT_PROJECT_ID_UNAVAILABLE")) {
  throw new Error(`WalletConnect missing-project state did not fail closed visibly: ${JSON.stringify(before)}`);
}

if (action === "create") {
  if (before.accountTitle !== "No account created" || before.accountButtonHidden) throw new Error(`fresh account boundary mismatch: ${JSON.stringify(before)}`);
  await evaluate(`document.querySelector("#create-account").click(); true`);
}

let after;
for (let attempt = 0; attempt < 60; attempt += 1) {
  after = await readState();
  if (after.accountTitle === "Secure Testnet account ready" && after.accountButtonHidden && after.signing === "Approval required") break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
const account = after.accountDetail?.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
if (!account || after.accountTitle !== "Secure Testnet account ready" || !after.accountButtonHidden || after.signing !== "Approval required" || !after.accountDetail.includes("OS-encrypted local custody")) {
  throw new Error(`secure account UI did not become ready: ${JSON.stringify(after)}`);
}
if (action === "restore" && (!expectedAccount || account !== expectedAccount.toLowerCase())) {
  throw new Error(`restored account mismatch: expected ${expectedAccount}, got ${account}`);
}

socket.close();
console.log(JSON.stringify({
  action,
  account,
  visibleAuthority: true,
  osEncryptedCustodyVisible: true,
  approvalRequiredVisible: true,
  walletConnectConfigured: false,
  walletConnectFailClosedVisible: true,
  before,
  after
}, null, 2));
