#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -d apps/mobile/node_modules ]]; then
  npm --prefix apps/mobile ci --ignore-scripts --no-audit --no-fund
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; rm -rf apps/mobile/dist-social apps/mobile/dist-wallet' EXIT

for product in social wallet; do
  (
    cd apps/mobile
    YNX_MOBILE_PRODUCT="$product" EXPO_PUBLIC_YNX_PRODUCT="$product" npx expo config --type public --json
  ) >"$tmp/$product.json"
done

node --input-type=module - "$tmp/social.json" "$tmp/wallet.json" <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [socialPath, walletPath] = process.argv.slice(2);
const social = JSON.parse(await readFile(socialPath, "utf8"));
const wallet = JSON.parse(await readFile(walletPath, "utf8"));
assert.deepEqual(
  [social.name, social.scheme, social.android.package, social.ios.bundleIdentifier, social.extra.product],
  ["YNX Social", "ynxsocial", "com.ynxweb4.social", "com.ynxweb4.social", "social"],
);
assert.deepEqual(
  [wallet.name, wallet.scheme, wallet.android.package, wallet.ios.bundleIdentifier, wallet.extra.product],
  ["YNX Wallet", "ynxwallet", "com.ynxweb4.wallet", "com.ynxweb4.wallet", "wallet"],
);
assert.notEqual(social.android.package, wallet.android.package);
assert.equal(social.extra.internalAcceptanceShell, false);
assert.equal(wallet.extra.internalAcceptanceShell, false);
NODE

rg -q 'nativeSocialBinding.*ynx-social://com\.ynxweb4\.social' internal/appgateway/gateway.go
rg -q 'nativeWalletBinding.*ynx-wallet://com\.ynxweb4\.wallet' internal/appgateway/gateway.go
rg -q 'case nativeSocialBinding' internal/appgateway/gateway.go
rg -q 'case nativeWalletBinding' internal/appgateway/gateway.go
rg -q 'PRODUCT === "integration" && !chatDetail' apps/mobile/App.tsx
rg -q 'fetchSquareProfileByHandle' apps/mobile/src/components/NativeChatScreen.tsx
if rg -n 'Recipient YNX address|placeholder="ynx1\.\.\."|Start with another registered ynx1 account' apps/mobile/src/components; then
  echo "mobile-product-split-check failed: Social still exposes address-based friend discovery" >&2
  exit 1
fi

npm --prefix apps/mobile run bundle-check:products
test -s apps/mobile/dist-social/metadata.json
test -s apps/mobile/dist-wallet/metadata.json

echo "mobile-product-split-check passed: distinct Social/Wallet identities, route isolation, handle-based Chat discovery, and Android/iOS Hermes bundles"
