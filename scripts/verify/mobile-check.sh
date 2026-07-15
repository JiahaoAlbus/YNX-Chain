#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -d apps/mobile/node_modules ]]; then
  npm --prefix apps/mobile ci --ignore-scripts --no-audit --no-fund
fi

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const pkg = JSON.parse(await readFile("apps/mobile/package.json", "utf8"));
const lock = JSON.parse(await readFile("apps/mobile/package-lock.json", "utf8"));
const app = JSON.parse(await readFile("apps/mobile/app.json", "utf8"));
assert.equal(lock.lockfileVersion, 3);
assert.equal(pkg.dependencies.expo, "~57.0.4");
assert.equal(pkg.dependencies["expo-secure-store"], "~57.0.0");
assert.equal(pkg.dependencies["expo-screen-capture"], "57.0.0");
assert.equal(pkg.dependencies["expo-local-authentication"], "~57.0.0");
assert.equal(pkg.dependencies["expo-clipboard"], "57.0.0");
assert.equal(pkg.dependencies["@noble/curves"], "2.2.0");
assert.equal(pkg.dependencies["@noble/hashes"], "2.2.0");
assert.equal(pkg.dependencies["@noble/ciphers"], "2.2.0");
assert.equal(pkg.dependencies["react-native-qrcode-svg"], "6.3.21");
assert.equal(pkg.scripts.android, "expo run:android");
assert.equal(pkg.scripts.ios, "expo run:ios");
assert.equal(app.expo.android.package, "com.ynxweb4.mobile");
assert.equal(app.expo.android.versionCode, 1);
assert.equal(app.expo.ios.bundleIdentifier, "com.ynxweb4.mobile");
assert.equal(app.expo.ios.buildNumber, "1");
assert.ok(app.expo.plugins.includes("./plugins/withYnxAndroidReleaseSigning"));
assert.ok(app.expo.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === "expo-local-authentication" && plugin[1]?.faceIDPermission === "Allow YNX to authorize local account key use."));
assert.equal(lock.packages["node_modules/@noble/curves"].version, "2.2.0");
assert.equal(lock.packages["node_modules/@noble/hashes"].version, "2.2.0");
assert.equal(lock.packages["node_modules/@noble/ciphers"].version, "2.2.0");
assert.equal(lock.packages["node_modules/expo-local-authentication"].version, "57.0.0");
assert.equal(lock.packages["node_modules/expo-clipboard"].version, "57.0.0");
assert.equal(lock.packages["node_modules/react-native-qrcode-svg"].version, "6.3.21");
NODE

for asset in assets/brand/ynx-logo.png apps/mobile/assets/ynx-logo.png internal/explorer/assets/ynx-logo.png; do
  test -s "$asset"
done
cmp -s assets/brand/ynx-logo.png apps/mobile/assets/ynx-logo.png
cmp -s assets/brand/ynx-logo.png internal/explorer/assets/ynx-logo.png
test ! -e apps/mobile/assets/ynx-mark.svg
rg -q 'require\("\./assets/ynx-logo\.png"\)' apps/mobile/App.tsx
rg -q '"backgroundColor": "#FFFFFF"' apps/mobile/app.json
rg -q 'await this\.authorize\("ownership-proof"\)' apps/mobile/src/api/mobileSession.ts
rg -q 'await this\.authorize\("signed-post"\)' apps/mobile/src/api/mobileSession.ts
rg -q 'await authorizeLocalKeyUse\("identity-removal"\)' apps/mobile/App.tsx
rg -q 'await authorizeLocalKeyUse\("native-transfer"\)' apps/mobile/src/components/NativeWalletDashboard.tsx
rg -q 'Cross-chain.*Not active' apps/mobile/src/components/NativeWalletDashboard.tsx
rg -q 'chainId=6423&asset=YNXT' apps/mobile/src/components/NativeWalletDashboard.tsx
rg -q 'type WalletRoute = "assets" \| "activity" \| "account"' apps/mobile/src/components/NativeWalletDashboard.tsx
rg -q 'YNX_NATIVE_TX_V1' apps/mobile/src/crypto/ynxSigner.ts
rg -q 'x25519-hkdf-sha256-xchacha20poly1305' apps/mobile/src/crypto/chatCrypto.ts
rg -q 'type Tab = "square" \| "chat" \| "wallet" \| "pay" \| "network"' apps/mobile/App.tsx
rg -q 'https://rpc\.ynxweb4\.com' apps/mobile/src/api/nativeWallet.ts
test -s testdata/mobile-native-transfer-vector.json

if rg -n 'AsyncStorage|localStorage|sessionStorage' apps/mobile --glob '!package-lock.json' --glob '!scripts/**'; then
  echo "mobile-check failed: account or session data must not use unprotected web/async storage" >&2
  exit 1
fi

npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile test
rm -rf apps/mobile/dist
npm --prefix apps/mobile run bundle-check
test -s apps/mobile/dist/metadata.json
rm -rf apps/mobile/dist

echo "mobile-check passed: strict types, canonical ynx1/signing vectors, secure-storage boundary, and iOS/Android Hermes bundles"
