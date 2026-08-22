import { readFile } from "node:fs/promises";
import path from "node:path";

const [targetsPath, imagePath, expectedURI] = process.argv.slice(2);
if (!targetsPath || !imagePath || !/^wc:[0-9a-f-]+@2\?/.test(expectedURI ?? "")) {
  throw new Error("usage: walletconnect-qr-ui-gate.mjs <targets.json> <qr-image> <expected-wc-v2-uri>");
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
const pending = new Map();
socket.addEventListener("message", event => {
  const payload = JSON.parse(event.data);
  if (!payload.id || !pending.has(payload.id)) return;
  const { resolve, reject } = pending.get(payload.id);
  pending.delete(payload.id);
  if (payload.error) reject(new Error(JSON.stringify(payload.error)));
  else resolve(payload.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  socket.send(JSON.stringify({ id, method, params }));
  return response;
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

await send("DOM.enable");
const document = await send("DOM.getDocument", { depth: -1, pierce: true });
const input = await send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#walletconnect-qr" });
if (!input.nodeId) throw new Error("WalletConnect QR input is missing");
await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [path.resolve(imagePath)] });

let state;
for (let attempt = 0; attempt < 60; attempt += 1) {
  state = JSON.parse(await evaluate(`JSON.stringify({
    title: document.title,
    uri: document.querySelector("#walletconnect-uri")?.value,
    status: document.querySelector("#walletconnect-qr-status")?.textContent,
    pairDisabled: document.querySelector("#walletconnect-pair")?.disabled,
    qrInputValueCleared: document.querySelector("#walletconnect-qr")?.value === ""
  })`));
  if (state.uri === expectedURI) break;
  if (/INVALID_|QR_DECODE_FAILED|QR_DECODER_UNAVAILABLE/.test(state.status ?? "")) break;
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (state.title !== "YNX Wallet" || state.uri !== expectedURI || state.status !== "WalletConnect v2 URI decoded locally. Review it, then pair the DApp." || !state.qrInputValueCleared) {
  throw new Error(`WalletConnect QR UI gate failed: ${JSON.stringify(state)}`);
}
socket.close();
console.log(JSON.stringify({
  qrDecodedLocally: true,
  exactWalletConnectV2URI: true,
  uploadPerformed: false,
  pairingPerformed: false,
  walletConnectRelayProved: false,
  state
}, null, 2));
