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
assert.equal(lock.lockfileVersion, 3);
assert.equal(pkg.dependencies.expo, "~57.0.4");
assert.equal(pkg.dependencies["expo-secure-store"], "~57.0.0");
assert.equal(pkg.dependencies["expo-screen-capture"], "57.0.0");
assert.equal(pkg.dependencies["@noble/curves"], "2.2.0");
assert.equal(pkg.dependencies["@noble/hashes"], "2.2.0");
assert.equal(pkg.scripts.android, "expo run:android");
assert.equal(pkg.scripts.ios, "expo run:ios");
assert.equal(lock.packages["node_modules/@noble/curves"].version, "2.2.0");
assert.equal(lock.packages["node_modules/@noble/hashes"].version, "2.2.0");
NODE

for asset in assets/brand/ynx-logo.png apps/mobile/assets/ynx-logo.png internal/explorer/assets/ynx-logo.png; do
  test -s "$asset"
done
cmp -s assets/brand/ynx-logo.png apps/mobile/assets/ynx-logo.png
cmp -s assets/brand/ynx-logo.png internal/explorer/assets/ynx-logo.png
test ! -e apps/mobile/assets/ynx-mark.svg
rg -q 'require\("\./assets/ynx-logo\.png"\)' apps/mobile/App.tsx
rg -q '"backgroundColor": "#FFFFFF"' apps/mobile/app.json

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
