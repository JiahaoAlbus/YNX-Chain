#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
root="$PWD/.ynx-developer-local"
app="$root/YNX Developer Testnet Preview.app"
rm -rf "$root"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/runtime"
/usr/bin/clang -fobjc-arc -fmodules-cache-path="$root/module-cache" desktop/macos/main.m -o "$app/Contents/MacOS/YNXDeveloper" -framework Cocoa -framework WebKit
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
cp desktop/server.mjs "$app/Contents/Resources/server.mjs"
cp -R dist "$app/Contents/Resources/web"

node_binary="${YNX_DEVELOPER_NODE_BINARY:-}"
for candidate in "$node_binary" "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" "$(command -v node 2>/dev/null || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    non_system=$(/usr/bin/otool -L "$candidate" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/System/|/usr/lib/)' || true)
    if [[ -z "$non_system" ]]; then node_binary="$candidate"; break; fi
  fi
done
if [[ -z "$node_binary" || ! -x "$node_binary" ]]; then
  echo "A portable arm64 Node runtime linked only to macOS system libraries is required. Set YNX_DEVELOPER_NODE_BINARY." >&2
  exit 1
fi
COPYFILE_DISABLE=1 cp -X "$node_binary" "$app/Contents/Resources/runtime/node"
chmod 0755 "$app/Contents/Resources/runtime/node"
/usr/bin/xattr -cr "$app"
/usr/bin/codesign --force --deep --sign - "$app"
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
if ! grep -Fq 'Signature=adhoc' <<<"$signature" || ! grep -Fq 'TeamIdentifier=not set' <<<"$signature"; then
  echo "Refusing local-package classification: expected only linker ad-hoc signing with no team identity." >&2
  exit 1
fi
COPYFILE_DISABLE=1 /usr/bin/ditto -c -k --keepParent --noextattr --noqtn "$app" "$root/ynx-developer-testnet-preview-macos-unsigned.zip"
/usr/bin/shasum -a 256 "$root/ynx-developer-testnet-preview-macos-unsigned.zip"
echo "Built unsigned macOS Testnet Preview with an ad-hoc signature, bundled portable runtime and no team identity. This is not a Developer ID signed production desktop release."
