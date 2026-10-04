/** Render a local module matrix without changing the document's image/script CSP. */
import {setWalletCopy} from "./wallet-locale.mjs";
// IPC produces public data fields. Snapshot them before touching the canvas;
// neither sparse arrays nor accessor properties are a complete module matrix.
function ownValue(object, key) {
  if (!object || typeof object !== "object") throw new Error("Invalid receiving code");
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Invalid receiving code");
  return descriptor.value;
}
export function drawReceiveCode(canvas, code, expectedAccount) {
  const size = ownValue(code, "size"), source = ownValue(code, "modules");
  if (typeof expectedAccount !== "string" || !expectedAccount || ownValue(code, "account") !== expectedAccount ||
      ownValue(code, "chainId") !== "ynx_6423-1" || ownValue(code, "asset") !== "YNXT" ||
      ownValue(code, "uri") !== `ynx:${expectedAccount}?chainId=ynx_6423-1&asset=YNXT` ||
      !Number.isInteger(size) || size < 21 || size > 177 || (size - 21) % 4 !== 0 ||
      !Array.isArray(source) || source.length !== size ** 2) {
    throw new Error("Invalid receiving code");
  }
  const modules = new Uint8Array(size ** 2);
  for (let index = 0; index < modules.length; index++) {
    const value = ownValue(source, String(index));
    if (value !== 0 && value !== 1) throw new Error("Invalid receiving code");
    modules[index] = value;
  }
  const quiet = 4, scale = 6, side = (size + quiet * 2) * scale;
  canvas.width = canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Receiving code cannot be displayed");
  context.fillStyle = "#FFFFFF"; context.fillRect(0, 0, side, side);
  context.fillStyle = "#002FA7";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (modules[y * size + x]) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
}

export function createReceiveCodeUI({ canvas, status, requestCode, draw = drawReceiveCode }) {
  let revision = 0;
  function clear() {
    revision++;
    canvas.hidden = true;
    canvas.width = canvas.height = 1;
    status.textContent = "";
  }
  async function refresh(account) {
    clear();
    if (!account) return;
    const current = revision;
    setWalletCopy(status,"Preparing your receiving code…");
    try {
      const result = await requestCode(account);
      if (current !== revision) return;
      if (ownValue(result, "ok") !== true) throw new Error("Receiving account unavailable");
      const value = ownValue(result, "value");
      if (current !== revision) return;
      draw(canvas, value, account);
      // Rendering or a supplied adapter may invalidate Receive synchronously.
      // A retired request cannot make the canvas visible or publish success.
      if (current !== revision) return;
      canvas.hidden = false;
      setWalletCopy(status,"Scan with a Wallet that supports YNX Testnet.");
    } catch {
      if (current !== revision) return;
      canvas.hidden = true;
      setWalletCopy(status,"The receiving code is unavailable. Reopen Receive to try again.");
    }
  }
  return { clear, refresh };
}
