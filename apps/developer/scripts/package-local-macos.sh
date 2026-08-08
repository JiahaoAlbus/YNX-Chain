#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

repo_root=$(/usr/bin/git -C "$PWD" rev-parse --show-toplevel)
tracked_changes=$(/usr/bin/git -C "$repo_root" status --porcelain --untracked-files=no -- apps/developer packages/developer-client)
if [[ -n "$tracked_changes" ]]; then
  echo "Refusing to package tracked Developer changes that are not committed." >&2
  printf '%s\n' "$tracked_changes" >&2
  exit 1
fi
source_commit=$(/usr/bin/git -C "$repo_root" rev-parse HEAD)
source_tree=$(/usr/bin/git -C "$repo_root" rev-parse 'HEAD^{tree}')
source_date=$(/usr/bin/git -C "$repo_root" show -s --format=%cI HEAD)
runtime_checkpoint=$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync("product-release.json","utf8")).commit)')

npm run build
root="$PWD/.ynx-developer-local"
app="$root/YNX Developer Testnet Preview.app"
rm -rf "$root"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/runtime"
/usr/bin/clang -fobjc-arc -fmodules-cache-path="$root/module-cache" desktop/macos/main.m -o "$app/Contents/MacOS/YNXDeveloper" -framework Cocoa -framework WebKit
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
cp desktop/server.mjs "$app/Contents/Resources/server.mjs"
cp -R dist "$app/Contents/Resources/web"
cp sbom.cdx.json "$app/Contents/Resources/sbom.cdx.json"

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
npm_root=$(npm root -g)
if [[ ! -f "$npm_root/npm/bin/npm-cli.js" ]]; then
  echo "A complete npm CLI is required for isolated desktop package installation." >&2
  exit 1
fi
mkdir -p "$app/Contents/Resources/runtime/npm/node_modules"
COPYFILE_DISABLE=1 cp -XR "$npm_root/npm" "$app/Contents/Resources/runtime/npm/node_modules/npm"
sbom_sha=$(/usr/bin/shasum -a 256 "$app/Contents/Resources/sbom.cdx.json" | awk '{print $1}')
node -e '
const fs = require("fs");
const [output, sourceCommit, sourceTree, sourceDate, runtimeCheckpoint, sbomSha256] = process.argv.slice(1);
const record = {
  schemaVersion: 1,
  productId: "ynx-developer-v1",
  version: "0.2.0",
  artifactClass: "unsigned-testnet-preview",
  platform: "macos-arm64",
  signingClass: "adhoc-no-team-id",
  sourceRepository: "https://github.com/JiahaoAlbus/YNX-Chain",
  sourceCommit,
  sourceTree,
  sourceCommitDate: sourceDate,
  runtimeCheckpoint,
  sourceDirty: false,
  sbomPath: "Contents/Resources/sbom.cdx.json",
  sbomSha256
};
fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
' "$app/Contents/Resources/build-provenance.json" "$source_commit" "$source_tree" "$source_date" "$runtime_checkpoint" "$sbom_sha"
/usr/bin/xattr -cr "$app"
/usr/bin/codesign --force --deep --sign - "$app"
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
if ! grep -Fq 'Signature=adhoc' <<<"$signature" || ! grep -Fq 'TeamIdentifier=not set' <<<"$signature"; then
  echo "Refusing local-package classification: expected only linker ad-hoc signing with no team identity." >&2
  exit 1
fi
COPYFILE_DISABLE=1 /usr/bin/ditto -c -k --keepParent --noextattr --noqtn "$app" "$root/ynx-developer-testnet-preview-macos-unsigned.zip"
/usr/bin/shasum -a 256 "$root/ynx-developer-testnet-preview-macos-unsigned.zip"
echo "Embedded source commit $source_commit, source tree $source_tree and SBOM SHA-256 $sbom_sha."
echo "Built unsigned macOS Testnet Preview with an ad-hoc signature, bundled portable runtime and no team identity. This is not a Developer ID signed production desktop release."
