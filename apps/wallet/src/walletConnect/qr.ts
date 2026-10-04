import { parseWalletConnectPairingUri } from "@ynx-chain/wallet-auth";

export type WalletConnectCameraState = "unavailable" | "denied" | "ready";

/** Accepts only a strict, current WalletConnect v2 URI. No scanned content is
 * opened as a URL or forwarded to the relay before this parser succeeds. */
export function reviewWalletConnectQrPayload(value: unknown, camera: WalletConnectCameraState, at = new Date()): string {
  if (camera === "denied") throw new Error("Camera permission was denied. WalletConnect pairing was not attempted.");
  if (camera === "unavailable") throw new Error("No camera is available. WalletConnect pairing was not attempted.");
  if (typeof value !== "string" || !value.trim()) throw new Error("The QR code does not contain a WalletConnect pairing URI.");
  const uri = value.trim();
  parseWalletConnectPairingUri(uri, at);
  return uri;
}
