import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function authorizationReviewReady(before) {
  return Boolean(before && !before.hidden && before.open && before.reviewId && before.requestId === before.reviewId
    && before.resultCode === "AWAITING_APPROVAL" && before.callbackEmitted === "false"
    && before.authorityGranted === "false" && before.productSessionCreated === "false");
}

export function authorizationResultMatches(before, after, action) {
  if (!authorizationReviewReady(before) || !after || !["approve", "reject"].includes(action)) return false;
  return after.reviewId === before.reviewId && after.requestId === before.reviewId
    && after.resultCode === (action === "approve" ? "CANONICAL_AUTHORIZATION_APPROVED" : "USER_REJECTED")
    && after.callbackEmitted === "true" && after.authorityGranted === String(action === "approve")
    && after.productSessionCreated === "false";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCallbackUiGate();
async function runCallbackUiGate() {
const [targetsPath, action] = process.argv.slice(2);
if (!targetsPath || !["reject", "approve", "invalid"].includes(action)) throw new Error("usage: callback-ui-gate.mjs <targets.json> <reject|approve|invalid>");
const [target] = JSON.parse(await readFile(targetsPath, "utf8"));
if (!target?.webSocketDebuggerUrl) throw new Error("no Electron page target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
async function evaluate(expression) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener("message", listener); reject(new Error("Desktop callback UI inspection timed out")); }, 5000);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) reject(new Error(JSON.stringify(payload)));
      else resolve(payload.result.result.value);
    };
    socket.addEventListener("message", listener);
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return response;
}

const before = JSON.parse(await evaluate(`JSON.stringify({
  hidden: document.querySelector("#authorization").hidden,
  open: document.querySelector("#authorization").open,
  product: document.querySelector("#auth-product").textContent,
  origin: document.querySelector("#auth-origin").textContent,
  account: document.querySelector("#auth-account").textContent,
  reviewId: document.querySelector("#authorization").dataset.reviewId ?? null,
  requestId: document.querySelector("#authorization").dataset.requestId ?? null,
  resultCode: document.querySelector("#authorization").dataset.resultCode ?? null,
  callbackEmitted: document.querySelector("#authorization").dataset.callbackEmitted ?? null,
  authorityGranted: document.querySelector("#authorization").dataset.authorityGranted ?? null,
  productSessionCreated: document.querySelector("#authorization").dataset.productSessionCreated ?? null,
  purpose: document.querySelector("#auth-purpose").textContent,
  scopes: document.querySelector("#auth-scopes").textContent,
  result: document.querySelector("#auth-result").textContent
})`));
if (action !== "invalid" && (!authorizationReviewReady(before) || !before.product.startsWith("Connect to ") || !before.origin || !/^(ynx1|0x)/.test(before.account))) throw new Error(`authorization consent identity was not visible: ${JSON.stringify(before)}`);
if (action === "invalid") {
  const state = JSON.parse(await evaluate(`JSON.stringify({ visibleApproval: document.querySelector("#authorization").open, error: document.querySelector("#connection-result").textContent })`));
  if (state.visibleApproval || !state.error) throw new Error("Invalid request did not fail closed visibly");
  socket.close();
  console.log(JSON.stringify({ action, before, callbackEmitted: false, authorityGranted: false }, null, 2));
  process.exit(0);
}

await evaluate(`document.querySelector("#${action}-auth").click(); true`);
const expected = action === "reject" ? "USER_REJECTED" : "CANONICAL_AUTHORIZATION_APPROVED";
const expectedCallback = true;
const expectedAuthority = action === "approve";
let after;
for (let attempt = 0; attempt < 30; attempt += 1) {
  after = JSON.parse(await evaluate(`JSON.stringify({ ...document.querySelector("#authorization").dataset })`));
  if (authorizationResultMatches(before, after, action)) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!authorizationResultMatches(before, after, action)) {
  throw new Error(`fail-closed action result mismatch: ${JSON.stringify(after)}`);
}
socket.close();
console.log(JSON.stringify({ action, before, after, callbackEmitted: expectedCallback, callbackReceivedProved: false, authorityGranted: expectedAuthority, productSessionCreated: false }, null, 2));
}
