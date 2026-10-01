import QRCode from "qrcode";
import { toYNXAddress } from "./wallet-address.js";

// Public receive address only. Pairing URIs never enter this component.
export async function renderHostedReceiveQR(container, account, isCurrent, encode = QRCode.toCanvas) {
  container.replaceChildren();container.dataset.state = "loading";
  const address = toYNXAddress(account);
  const canvas = container.ownerDocument.createElement("canvas");
  canvas.setAttribute("role", "img");canvas.setAttribute("aria-label", address);
  try {
    await encode(canvas, address, { width:210, margin:2, errorCorrectionLevel:"M" });
    if (!isCurrent()) return;
    container.replaceChildren(canvas);container.dataset.state = "ready";
  } catch {
    if (isCurrent()) container.dataset.state = "unavailable";
  }
}
