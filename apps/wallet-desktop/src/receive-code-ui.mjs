/** Render a local module matrix without changing the document's image/script CSP. */
export function drawReceiveCode(canvas, code, expectedAccount) {
  if (!expectedAccount || code?.account !== expectedAccount || code.chainId !== "ynx_6423-1" || code.asset !== "YNXT" ||
      code.uri !== `ynx:${expectedAccount}?chainId=ynx_6423-1&asset=YNXT` ||
      !Number.isInteger(code.size) || code.size < 21 || code.size > 177 || (code.size - 21) % 4 !== 0 ||
      !Array.isArray(code.modules) || code.modules.length !== code.size ** 2 || code.modules.some(value => value !== 0 && value !== 1)) {
    throw new Error("Invalid receiving code");
  }
  const quiet = 4, scale = 6, side = (code.size + quiet * 2) * scale;
  canvas.width = canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Receiving code cannot be displayed");
  context.fillStyle = "#FFFFFF"; context.fillRect(0, 0, side, side);
  context.fillStyle = "#002FA7";
  for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) {
    if (code.modules[y * code.size + x]) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
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
    status.textContent = "Preparing your receiving code…";
    try {
      const result = await requestCode(account);
      if (current !== revision) return;
      if (!result?.ok) throw new Error("Receiving account unavailable");
      draw(canvas, result.value, account);
      canvas.hidden = false;
      status.textContent = "Scan with a Wallet that supports YNX Testnet.";
    } catch {
      if (current !== revision) return;
      canvas.hidden = true;
      status.textContent = "The receiving code is unavailable. Reopen Receive to try again.";
    }
  }
  return { clear, refresh };
}
