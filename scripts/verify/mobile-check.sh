#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

match_file() {
  local pattern="$1"
  local path="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -q "$pattern" "$path"
  else
    grep -Eq -- "$pattern" "$path"
  fi
}

scan_unprotected_storage() {
  if command -v rg >/dev/null 2>&1; then
    rg -n 'AsyncStorage|localStorage|sessionStorage' apps/mobile --glob '!package-lock.json' --glob '!scripts/**'
  else
    grep -RInE \
      --exclude='package-lock.json' \
      --exclude-dir='scripts' \
      --exclude-dir='node_modules' \
      --exclude-dir='dist' \
      --exclude-dir='.expo' \
      -- 'AsyncStorage|localStorage|sessionStorage' apps/mobile
  fi
}

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
match_file 'require\("\./assets/ynx-logo\.png"\)' apps/mobile/App.tsx
match_file '"backgroundColor": "#FFFFFF"' apps/mobile/app.json
match_file 'await this\.authorize\("ownership-proof"\)' apps/mobile/src/api/mobileSession.ts
match_file 'await this\.authorize\("signed-post"\)' apps/mobile/src/api/mobileSession.ts
match_file 'await authorizeLocalKeyUse\("identity-removal"\)' apps/mobile/App.tsx
match_file 'await authorizeLocalKeyUse\("native-transfer"\)' apps/mobile/src/components/NativeWalletDashboard.tsx
match_file 'Cross-chain.*Not active' apps/mobile/src/components/NativeWalletDashboard.tsx
match_file 'chainId=6423&asset=YNXT' apps/mobile/src/components/NativeWalletDashboard.tsx
match_file 'type WalletRoute = "assets" \| "activity" \| "account"' apps/mobile/src/components/NativeWalletDashboard.tsx
match_file 'YNX_NATIVE_TX_V1' apps/mobile/src/crypto/ynxSigner.ts
match_file 'x25519-hkdf-sha256-xchacha20poly1305' apps/mobile/src/crypto/chatCrypto.ts
match_file 'createChatEnvelopeSet' apps/mobile/src/api/mobileSession.ts
match_file 'rotateCurrentChatDevice' apps/mobile/src/api/mobileSession.ts
match_file 'Manage Chat devices' apps/mobile/src/components/NativeChatScreen.tsx
match_file 'await this\.authorize\("device-rotation"\)' apps/mobile/src/api/mobileSession.ts
match_file 'type Tab = "social" \| "wallet" \| "pay" \| "network"' apps/mobile/App.tsx
match_file 'type SocialRoute = "feed" \| "messages" \| "alerts"' apps/mobile/App.tsx
match_file 'createSquareComment' apps/mobile/src/api/mobileSession.ts
match_file 'setSquareReaction' apps/mobile/src/api/mobileSession.ts
match_file 'setSquareFollow' apps/mobile/src/api/mobileSession.ts
match_file 'createSquareReport' apps/mobile/src/api/mobileSession.ts
match_file 'parseSquareComments' apps/mobile/src/api/square.ts
match_file 'listSquareNotifications' apps/mobile/src/api/mobileSession.ts
match_file 'setSquareProfile' apps/mobile/src/api/mobileSession.ts
match_file 'NativeSocialAlertsScreen' apps/mobile/App.tsx
match_file 'https://rpc\.ynxweb4\.com' apps/mobile/src/api/nativeWallet.ts
test -s testdata/mobile-native-transfer-vector.json

if scan_unprotected_storage; then
  echo "mobile-check failed: account or session data must not use unprotected web/async storage" >&2
  exit 1
fi

npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile test
rm -rf apps/mobile/dist
npm --prefix apps/mobile run bundle-check
test -s apps/mobile/dist/metadata.json
rm -rf apps/mobile/dist

echo "mobile-check passed: native Social/Wallet/Pay/Network UI, strict ynx1 signing, persistent Square action clients, multi-device Chat vectors, biometric authorization, secure-storage boundary, and iOS/Android Hermes bundles"
