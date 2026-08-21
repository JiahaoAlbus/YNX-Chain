import { readFile } from "node:fs/promises";

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

const before = JSON.parse(await evaluate(`JSON.stringify({
  hidden: document.querySelector("#authorization").hidden,
  product: document.querySelector("#auth-product").textContent,
  purpose: document.querySelector("#auth-purpose").textContent,
  scopes: document.querySelector("#auth-scopes").textContent,
  result: document.querySelector("#auth-result").textContent
})`));
if (before.hidden || (action !== "invalid" && !before.product.startsWith("Authorization request from "))) throw new Error(`authorization UI was not visible: ${JSON.stringify(before)}`);
if (action === "invalid") {
  if (before.product !== "Authorization request rejected" || before.scopes !== "None" || !before.result.includes("callbackEmitted=false") || !before.result.includes("authorityGranted=false")) {
    throw new Error(`invalid request did not fail closed visibly: ${JSON.stringify(before)}`);
  }
  socket.close();
  console.log(JSON.stringify({ action, before, callbackEmitted: false, authorityGranted: false }, null, 2));
  process.exit(0);
}
await evaluate(`document.querySelector("#${action}-auth").click(); true`);
const expected = action === "reject" ? "USER_REJECTED" : "CANONICAL_AUTH_BRIDGE_UNAVAILABLE";
let after;
for (let attempt = 0; attempt < 30; attempt += 1) {
  after = JSON.parse(await evaluate(`JSON.stringify({ result: document.querySelector("#auth-result").textContent })`));
  if (after.result.includes("callbackEmitted=false")) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!after.result.includes(expected) || !after.result.includes("callbackEmitted=false") || !after.result.includes("authorityGranted=false")) {
  throw new Error(`fail-closed action result mismatch: ${JSON.stringify(after)}`);
}
socket.close();
console.log(JSON.stringify({ action, before, after, callbackEmitted: false, authorityGranted: false }, null, 2));
