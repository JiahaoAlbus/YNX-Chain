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
runtime_checkpoint="$source_commit"
# One deployment target for the native shell, bundle declaration and all bundled
# Mach-O dependencies. The portable Node runtime establishes the 13.5 floor.
macos_min_version=$(/usr/libexec/PlistBuddy -c 'Print LSMinimumSystemVersion' desktop/macos/Info.plist)
[[ "$macos_min_version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo "Invalid macOS deployment target" >&2; exit 1; }
machine_arch=$(/usr/bin/uname -m)
case "$machine_arch" in
  arm64|x86_64) platform="macos-$([[ "$machine_arch" == arm64 ]] && printf arm64 || printf x64)" ;;
  *) echo "Unsupported macOS architecture: $machine_arch" >&2; exit 1 ;;
esac
candidate_root="$PWD/.ynx-developer-candidates"
root="${YNX_DEVELOPER_MACOS_OUTPUT_DIR:-$candidate_root/${source_commit:0:12}-${platform}}"
case "$root" in
  "$candidate_root"/*) ;;
  *) echo "YNX_DEVELOPER_MACOS_OUTPUT_DIR must stay under $candidate_root" >&2; exit 1 ;;
esac
[[ "$root" != *"/../"* && "$root" != */.. ]] || { echo "YNX_DEVELOPER_MACOS_OUTPUT_DIR must not contain parent traversal" >&2; exit 1; }
[[ ! -e "$root" ]] || { echo "Refusing to overwrite existing macOS package candidate: $root" >&2; exit 1; }

npm run code:build
app="$root/YNX Developer Testnet Preview.app"
mkdir -p "$root" "$app/Contents/MacOS" "$app/Contents/Resources/runtime" "$app/Contents/Resources/code/apps/developer/frontend"
/usr/bin/clang -fobjc-arc -mmacosx-version-min="$macos_min_version" -Werror=unguarded-availability -Werror=unguarded-availability-new -fmodules-cache-path="$root/module-cache" desktop/macos/main.m -o "$app/Contents/MacOS/YNXDeveloper" -framework Cocoa -framework Security -framework WebKit
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
cp desktop/code-server.mjs "$app/Contents/Resources/server.mjs"
cp -R frontend/dist "$app/Contents/Resources/code/apps/developer/frontend/dist"
cp -R frontend/src "$app/Contents/Resources/code/apps/developer/frontend/src"
cp -R protocol "$app/Contents/Resources/code/apps/developer/protocol"
cp -R services "$app/Contents/Resources/code/apps/developer/services"
# The packaged project preparer resolves these owned inputs relative to its
# service module. The composed archive alone does not supply those paths.
mkdir -p "$app/Contents/Resources/code/apps/developer/native"
cp -R native/ynx-brand native/ynx-tools "$app/Contents/Resources/code/apps/developer/native/"
mkdir -p "$app/Contents/Resources/code/apps/developer/scripts"
cp scripts/compiler-worker.mjs scripts/compiler-pin.mjs "$app/Contents/Resources/code/apps/developer/scripts/"
if [[ -n "${YNX_DEVELOPER_SOLIDITY_INPUT:-}" ]]; then
  node scripts/bundle-solidity-runtime.mjs "$YNX_DEVELOPER_SOLIDITY_INPUT" "$app/Contents/Resources/code/apps/developer/compiler-runtime"
fi
cp package.json package-lock.json "$app/Contents/Resources/code/apps/developer/"
# APFS clones preserve a standalone dependency tree while sharing unchanged
# blocks. Retain any failed clone outside the app before a fresh normal copy.
if ! COPYFILE_DISABLE=1 cp -cXR node_modules "$app/Contents/Resources/code/apps/developer/node_modules"; then
  if [[ -e "$app/Contents/Resources/code/apps/developer/node_modules" ]]; then
    mv "$app/Contents/Resources/code/apps/developer/node_modules" "$root/node_modules-clone-failed"
  fi
  COPYFILE_DISABLE=1 cp -XR node_modules "$app/Contents/Resources/code/apps/developer/node_modules"
fi

# Preserve the exact reviewed native-component bytes inside an archive. Outer
# ad-hoc signing would otherwise mutate the composed runtime's pinned tree.
# This is distribution, not an alternative launch/authentication route: the
# existing protected operator still installs its exact registered driver.
composed_artifact="${YNX_DEVELOPER_COMPOSED_ARTIFACT:-}"
composed_pin="${YNX_DEVELOPER_COMPOSED_PIN:-}"
if [[ -n "$composed_artifact" || -n "$composed_pin" ]]; then
  [[ -n "$composed_artifact" && -n "$composed_pin" ]] || { echo "Both exact composed artifact and pin are required." >&2; exit 1; }
  node scripts/bundle-composed-core.mjs "$composed_artifact" "$composed_pin" "$app/Contents/Resources/composed-core"
fi

node_binary="${YNX_DEVELOPER_NODE_BINARY:-}"
for candidate in "$node_binary" "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" "$(command -v node 2>/dev/null || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    non_system=$(/usr/bin/otool -L "$candidate" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/System/|/usr/lib/)' || true)
    if [[ -z "$non_system" ]]; then node_binary="$candidate"; break; fi
  fi
done
if [[ -z "$node_binary" || ! -x "$node_binary" ]]; then
  echo "A portable macOS Node runtime linked only to macOS system libraries is required. Set YNX_DEVELOPER_NODE_BINARY." >&2
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
node scripts/verify-macos-compatibility.mjs "$app" "$macos_min_version" "$machine_arch" "$app/Contents/Resources/macos-compatibility.json"
compatibility_sha=$(/usr/bin/shasum -a 256 "$app/Contents/Resources/macos-compatibility.json" | awk '{print $1}')
node scripts/generate-code-sbom.mjs "$app/Contents/Resources/sbom.cdx.json" "$node_binary" "$npm_root/npm/package.json" "$source_commit"
sbom_sha=$(/usr/bin/shasum -a 256 "$app/Contents/Resources/sbom.cdx.json" | awk '{print $1}')
node -e '
const fs = require("fs");
const [output, sourceCommit, sourceTree, sourceDate, runtimeCheckpoint, sbomSha256, platform, minimumOS, macosCompatibilitySha256] = process.argv.slice(1);
const record = {
  schemaVersion: 1,
  productId: "ynx-developer-v1",
  version: "0.2.0",
  artifactClass: "unsigned-testnet-preview",
  platform,
  signingClass: "adhoc-no-team-id",
  sourceRepository: "https://github.com/JiahaoAlbus/YNX-Chain",
  sourceCommit,
  sourceTree,
  sourceCommitDate: sourceDate,
  runtimeCheckpoint,
  sourceDirty: false,
  minimumOS,
  macosCompatibilityPath: "Contents/Resources/macos-compatibility.json",
  macosCompatibilitySha256,
  sbomPath: "Contents/Resources/sbom.cdx.json",
  sbomSha256
};
const coreReceipt = require("path").join(require("path").dirname(output), "composed-core/distribution.json");
if (fs.existsSync(coreReceipt)) record.composedCoreDistribution = JSON.parse(fs.readFileSync(coreReceipt, "utf8"));
fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
' "$app/Contents/Resources/build-provenance.json" "$source_commit" "$source_tree" "$source_date" "$runtime_checkpoint" "$sbom_sha" "$platform" "$macos_min_version" "$compatibility_sha"
/usr/bin/xattr -cr "$app"
# The reviewed portable Node binary may retain its distributor signature while
# native npm modules are locally ad-hoc signed. macOS library validation rejects
# that mixed-Team process. This entire unsigned Preview must therefore use one
# explicit no-Team-ID ad-hoc class for every bundled Mach-O before sealing the
# outer app.
while IFS= read -r bundled_binary; do
  if /usr/bin/file "$bundled_binary" | /usr/bin/grep -q 'Mach-O'; then
    /usr/bin/codesign --force --sign - "$bundled_binary"
  fi
done < <(/usr/bin/find "$app/Contents/Resources" -type f -print)
/usr/bin/codesign --force --deep --sign - "$app"
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
if ! grep -Fq 'Signature=adhoc' <<<"$signature" || ! grep -Fq 'TeamIdentifier=not set' <<<"$signature"; then
  echo "Refusing local-package classification: expected only linker ad-hoc signing with no team identity." >&2
  exit 1
fi
dmg_root="$root/dmg-root"
dmg="$root/ynx-developer-testnet-preview-${platform}-unsigned.dmg"
mkdir -p "$dmg_root"
# APFS can stage an identical copy without duplicating all runtime blocks.
# Other filesystems retain the existing regular-copy route.
if ! COPYFILE_DISABLE=1 cp -cR "$app" "$dmg_root/"; then
  # Preserve a failed clone attempt; the fallback starts in a fresh directory.
  dmg_root="$root/dmg-root-fallback"
  mkdir "$dmg_root"
  COPYFILE_DISABLE=1 cp -XR "$app" "$dmg_root/"
fi
/usr/bin/hdiutil create -ov -format UDZO -volname "YNX Developer Testnet Preview" -srcfolder "$dmg_root" "$dmg" >/dev/null
/usr/bin/shasum -a 256 "$dmg" | tee "$root/SHA256SUMS.txt"
# Only a successful image's generated, holder-free staging duplicate is
# disposable. Keep the original app, DMG and all failed/partial builds.
holder_status=0
/usr/sbin/lsof -nP +D "$dmg_root" > "$root/dmg-staging-holder.log" 2>&1 || holder_status=$?
if [[ "$holder_status" -eq 1 && ! -s "$root/dmg-staging-holder.log" && -d "$dmg_root" && ! -L "$dmg_root" && ( "$dmg_root" == "$root/dmg-root" || "$dmg_root" == "$root/dmg-root-fallback" ) ]]; then
  /usr/bin/find "$dmg_root" -print > "$root/dmg-staging-deleted-paths.txt"
  rm -rf -- "$dmg_root"
  printf '%s\n' 'Generated DMG staging duplicate deleted; original app, DMG, source provenance and package receipts retained.' > "$root/dmg-staging-cleanup.txt"
fi
echo "Embedded source commit $source_commit, source tree $source_tree and SBOM SHA-256 $sbom_sha."
echo "Built unsigned macOS Testnet Preview DMG with an ad-hoc app signature, bundled portable runtime and no team identity. This is not a Developer ID signed or notarized production desktop release."
