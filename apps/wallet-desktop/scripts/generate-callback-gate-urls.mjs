import { createECDH, randomBytes } from "node:crypto";
import { createProductSessionRequest, encodeProductSessionWalletURL } from "@ynx-chain/wallet-auth";
import { PRODUCT_SESSION_REGISTRY } from "../src/wallet-auth-contract.mjs";

const platform = process.argv[2] ?? ({ darwin: "macos", win32: "windows", linux: "linux" }[process.platform]);
if (!["macos", "windows", "linux"].includes(platform)) throw new Error("Choose a supported Desktop platform");
const now = new Date();
// Dedicated public test device fixture. This script has no Wallet signing key.
const device = createECDH("prime256v1");
device.setPrivateKey(Buffer.alloc(32, 0x42));
const product = PRODUCT_SESSION_REGISTRY.products.find(item => item.productId === "social");
const url = () => encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY, createProductSessionRequest(PRODUCT_SESSION_REGISTRY, {
  productId: product.productId, platform, deviceId: "desktop-installed-callback-test",
  deviceKey: device.getPublicKey(null, "compressed").toString("base64url"),
  scopes: product.scopes, purpose: "Verify approval and rejection on this isolated test device.",
  nonce: randomBytes(32).toString("base64url"), state: randomBytes(32).toString("base64url"),
}, now), now);
console.log(JSON.stringify({ reject: url(), approve: url(), callback: product.nativeCallback, protocol: "product-session-v2", platform }));
