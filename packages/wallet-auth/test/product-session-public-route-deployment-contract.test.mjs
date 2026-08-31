import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN } from "../src/index.js";

const installer = fileURLToPath(new URL("../../../scripts/deploy/install-product-session-v2-testnet-remote.sh", import.meta.url));
const caddy = fileURLToPath(new URL("../../../deploy/wallet/wallet.caddy", import.meta.url));

test("Product Session deployment binds the public client origin before the legacy Wallet fallback", async () => {
  const [installerSource, caddySource] = await Promise.all([readFile(installer, "utf8"), readFile(caddy, "utf8")]);
  assert.equal(PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN, "https://wallet-auth.ynxweb4.com");
  assert.match(caddySource, /^wallet-auth\.ynxweb4\.com, wallet-auth-testnet\.43\.153\.202\.237\.sslip\.io \{/m);
  assert.match(caddySource, /@ynx_product_session_v2 path \/v2\/product-sessions\/\*/);
  assert.match(caddySource, /handle @ynx_product_session_v2 \{\n    reverse_proxy 127\.0\.0\.1:6441\n  \}\n  handle \{\n    reverse_proxy 127\.0\.0\.1:18445\n  \}/);
  assert.match(installerSource, /wallet-auth\.ynxweb4\.com, wallet-auth-testnet\.43\.153\.202\.237\.sslip\.io/);
  assert.match(installerSource, /# BEGIN YNX PRODUCT SESSION V2 WALLET AUTH/);
  assert.match(installerSource, /YNX_PRODUCT_SESSION_V2_PUBLIC_URL=https:\/\/wallet-auth\.ynxweb4\.com/g);
  assert.equal(installerSource.includes("https://rest.ynxweb4.com"), false);
});
