import { createECDH } from "node:crypto";
import { encodeRequestDeepLink } from "@ynx-chain/wallet-auth";

const now = new Date();
const device = createECDH("prime256v1");
device.setPrivateKey(Buffer.alloc(32, 0x42));
const base = {
  version: "1",
  chainId: "ynx_6423-1",
  requestingProduct: "social",
  productClientId: "ynx-social-v1",
  bundleId: "com.ynx.social",
  productDeviceAlgorithm: "p256-sha256",
  productDeviceKey: device.getPublicKey(null, "compressed").toString("base64url"),
  callback: "ynx-social://com.ynx.social",
  scopes: ["account:read", "profile:link"],
  purpose: "Verify native YNX Wallet approval and rejection on this isolated test device.",
  issuedAt: new Date(now.getTime() - 30_000).toISOString(),
  expiresAt: new Date(now.getTime() + 240_000).toISOString()
};
const url = nonce => encodeRequestDeepLink({ ...base, nonce });
console.log(JSON.stringify({
  reject: url("native_reject_abcdefghijklmnopqrstuvwxyz12"),
  approve: url("native_approve_abcdefghijklmnopqrstuvwxyz1")
}));
