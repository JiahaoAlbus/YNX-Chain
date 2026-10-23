#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

repo_root=$(/usr/bin/git -C "$PWD" rev-parse --show-toplevel)
tracked_changes=$(/usr/bin/git -C "$repo_root" status --porcelain --untracked-files=no -- apps/developer packages/developer-client packages/wallet-auth apps/wallet-desktop/native)
if [[ -n "$tracked_changes" ]]; then
  echo "Refusing to package tracked Developer changes that are not committed." >&2
  printf '%s\n' "$tracked_changes" >&2
  exit 1
fi
source_commit=$(/usr/bin/git -C "$repo_root" rev-parse HEAD)
source_tree=$(/usr/bin/git -C "$repo_root" rev-parse 'HEAD^{tree}')
source_date=$(/usr/bin/git -C "$repo_root" show -s --format=%cI HEAD)
# Fail before allocating a build candidate if either separately pinned input is
# absent or changed. These are source roots, never runtime qualification flags.
node --input-type=module -e "import('./scripts/package-identity-admission-source.mjs').then(m=>m.verifyCanonicalIdentityAdmissionSource())"
canonical_native_root=$(node scripts/package-identity-admission-source.mjs --native-source-root)
canonical_app_native_root=$(node scripts/identity-app-custody-source.mjs)
node --test --test-concurrency=1 scripts/canonical-identity-selection.test.mjs scripts/canonical-identity-package.test.mjs
node --test scripts/native-wallet-transport-recipe.test.mjs
node --test scripts/admit-derived-native.test.mjs
node --test scripts/normal-macos-build-layout.test.mjs scripts/verify-normal-macos-release.test.mjs
node --test desktop/wallet-identity-v2-caller.test.mjs desktop/wallet-identity-v2-startup.test.mjs
node --test desktop/native-identity-channel.test.mjs
node --test desktop/native-identity-ui.test.mjs
node --test desktop/native-bridge-document-lifetime.test.mjs
node --test scripts/native-display-locale.test.mjs
YNX_IDE_PEER_KERNEL_SOURCE="${YNX_DEVELOPER_CANONICAL_SDK_ROOT:-$repo_root/packages/wallet-auth}/src/original-identity-peer-runtime.js" node --test desktop/wallet-identity-peer-bridge.test.mjs
# Test the normal App consumer against the same selected holder header. The
# holder is App-only; it is not another Node NAPI translation unit.
YNX_IDE_IDENTITY_NATIVE_INCLUDE="$canonical_app_native_root/packages/wallet-auth/native" node --test runtime/theia/scripts/identity-launch-consumer.test.mjs scripts/package-native-parent-link.test.mjs scripts/identity-app-selection.test.mjs scripts/identity-app-custody-source.test.mjs
node --test desktop/marketplace-artifact-download.test.mjs desktop/marketplace-catalog-policy.test.mjs desktop/marketplace-catalog-transport.test.mjs desktop/marketplace-readme.test.mjs desktop/marketplace-channel.test.mjs
node --test runtime/theia/scripts/extension-display-identity.test.mjs
node --test scripts/normal-local-workspace-aliases.test.mjs
node --test scripts/verify-packaged-local-imports.test.mjs
node --test scripts/solidity-current-file-route.test.mjs
node --test scripts/bundle-composed-core.test.mjs
runtime_checkpoint="$source_commit"
# One deployment target for the native shell, bundle declaration and all bundled
# Mach-O dependencies. The portable Node runtime establishes the 13.5 floor.
macos_min_version=$(/usr/libexec/PlistBuddy -c 'Print LSMinimumSystemVersion' desktop/macos/Info.plist)
[[ "$macos_min_version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo "Invalid macOS deployment target" >&2; exit 1; }
local_node_runtime="${YNX_DEVELOPER_LOCAL_NODE_RUNTIME:-}"
if [[ -n "$local_node_runtime" ]]; then
  [[ -n "${YNX_DEVELOPER_COMPOSED_ARTIFACT:-}" && -n "${YNX_DEVELOPER_COMPOSED_PIN:-}" ]] || { echo "Local workbench requires its exact composed payload and pin." >&2; exit 1; }
  macos_min_version=$(node --input-type=module - "$local_node_runtime" "$PWD/.ynx-developer-candidates" "$macos_min_version" <<'NODE'
import {readFile,realpath,lstat,readdir} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {verifyComposedRuntime,validateRuntimeArtifact} from './services/codeoss-service/src/composed-runtime.mjs';
import {inspectBinary,compareVersions} from './scripts/verify-macos-compatibility.mjs';
const [input,candidates,baseline]=process.argv.slice(2),root=await realpath(input);
if(root!==input||!root.startsWith(candidates+'/'))throw Error('Use the exact retained owned Node runtime.');
const record=JSON.parse(await readFile(join(root,'distribution.json')));
if(record.schemaVersion!==1||!record.executionVerified||!['v26.7.0','v24.19.0'].includes(record.version)||!/^\d+(?:\.\d+)*$/.test(record.minimumOS))throw Error('Exact reviewed macOS Node closure required.');
if(record.version==='v24.19.0'&&(record.source!=='/usr/local/bin/node'||record.sourceSha256!=='1f08f0e5b8d9a0136c6219f4cea4d3b4fb8ffa4d96e0ff64869ce0dda6dd6a35'||record.sourceKind!=='official-node-installer'||record.originalSigningClass!=='developer-id-nodejs-foundation'||record.licenseVerified!==true))throw Error('Official Node 24 source/signature/legal qualification is missing.');
const runtimeFloors=[];
for(const entry of record.files){if(!/^(node|ynx-js-node|lib\/[^/]+)$/.test(entry.path))throw Error('Invalid runtime file.');const path=join(root,entry.path);if(!(await lstat(path)).isFile())throw Error('Regular runtime input required.');if(createHash('sha256').update(await readFile(path)).digest('hex')!==entry.bundledSha256)throw Error('Runtime input changed.');const slice=inspectBinary(path)?.find(value=>value.architecture===(process.arch==='arm64'?'arm64':'x86_64'));if(!slice||!['1','macos'].includes(slice.platform))throw Error('Runtime image has no current macOS slice.');compareVersions(slice.minimumOS,slice.minimumOS);runtimeFloors.push(slice.minimumOS);}
const nodeEntry=record.files.find(entry=>entry.path==='node'),jsEntry=record.files.find(entry=>entry.path==='ynx-js-node');
if(!nodeEntry||!jsEntry||jsEntry.derivedFrom!=='node'||jsEntry.bundledSha256!==nodeEntry.bundledSha256)throw Error('Exact sealed JavaScript Node entry is required.');
for(const entry of record.notices){if(!entry.path.startsWith('notices/')||entry.path.split('/').includes('..'))throw Error('Invalid runtime notice.');if(createHash('sha256').update(await readFile(join(root,entry.path))).digest('hex')!==entry.sha256)throw Error('Runtime notice changed.');}
if(execFileSync(join(root,'node'),['--version'],{encoding:'utf8'}).trim()!==record.version)throw Error('Retained runtime version changed.');
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;};
if(!runtimeFloors.length||record.minimumOS!==runtimeFloors.sort(compare).at(-1))throw Error('Runtime floor differs from its actual Mach-O bytes.');
const core=await verifyComposedRuntime(process.env.YNX_DEVELOPER_COMPOSED_ARTIFACT,validateRuntimeArtifact(JSON.parse(await readFile(process.env.YNX_DEVELOPER_COMPOSED_PIN))));
// A local development App must retain the reviewed language extension closure.
// Runtime adapters alone cannot provide Python commands or language detection.
const pluginRoot=join(process.env.YNX_DEVELOPER_COMPOSED_ARTIFACT,'plugins');
const pluginInputs=JSON.parse(await readFile(join(pluginRoot,'extension-inputs.json')));
for(const id of ['vscode.javascript','vscode.typescript','vscode.typescript-language-features','vscode.git','vscode.git-base','ms-vscode.js-debug','vscode.json','vscode.json-language-features','ms-python.python','ms-python.debugpy','vscode.python','llvm-vs-code-extensions.lldb-dap']){
  const input=pluginInputs.find(item=>`${item.namespace}.${item.name}`===id);
  if(!input)throw Error(`Local development App is missing required extension ${id}. Use the complete reviewed language inputs.`);
  const metadata=JSON.parse(await readFile(join(pluginRoot,`${id}-${input.version}`,'package.json')));
  if(`${metadata.publisher}.${metadata.name}`!==id||metadata.version!==input.version)throw Error('Local language extension payload identity differs.');
}
if(!core.ynxCppInput)throw Error('Local development App requires the current owned C/C++ extension.');
if(core.nodeVersion!==record.version)throw Error('Reviewed runtime does not match the exact composed Node build.');
if(core.macosCompatibility&&(core.macosCompatibility.architecture!==process.arch||!/^\d+(?:\.\d+)*$/.test(core.macosCompatibility.minimumOS)||!Array.isArray(core.macosCompatibility.binaries)||!core.macosCompatibility.binaries.length))throw Error('Invalid sealed core Mach-O closure metadata.');
if(record.version==='v24.19.0'&&(!core.macosCompatibility||core.macosCompatibility.architecture!==process.arch||!/^\d+(?:\.\d+)*$/.test(core.macosCompatibility.minimumOS)))throw Error('Node24 requires a newly measured sealed core Mach-O closure.');
// Measure the verified archive source itself, including plugin native binaries;
// a caller-written floor or outer-App-only scan cannot conceal archived minOS.
const coreFloors=[];
async function measure(folder){for(const name of await readdir(folder)){const path=join(folder,name),stat=await lstat(path);if(stat.isDirectory())await measure(path);else if(stat.isFile()){const slices=inspectBinary(path);if(!slices)continue;for(const slice of slices){if(!['1','macos'].includes(slice.platform))throw Error('Core image is not a macOS slice.');compareVersions(slice.minimumOS,slice.minimumOS);coreFloors.push(slice.minimumOS);}}}}
await measure(process.env.YNX_DEVELOPER_COMPOSED_ARTIFACT);
if(!coreFloors.length)throw Error('Verified core has no measurable macOS native closure.');
const coreFloor=coreFloors.sort(compare).at(-1);
if(core.macosCompatibility&&core.macosCompatibility.minimumOS!==coreFloor)throw Error('Sealed core floor differs from its actual Mach-O bytes.');
console.log([baseline,record.minimumOS,coreFloor].sort(compare).at(-1));
NODE
  )
fi
machine_arch=$(/usr/bin/uname -m)
case "$machine_arch" in
  arm64|x86_64) platform="macos-$([[ "$machine_arch" == arm64 ]] && printf arm64 || printf x64)" ;;
  *) echo "Unsupported macOS architecture: $machine_arch" >&2; exit 1 ;;
esac
candidate_root=$(node scripts/build-output-root.mjs root)
root="${YNX_DEVELOPER_MACOS_OUTPUT_DIR:-$candidate_root/${source_commit:0:12}-${platform}}"
case "$root" in
  "$candidate_root"/*) ;;
  *) echo "YNX_DEVELOPER_MACOS_OUTPUT_DIR must stay under $candidate_root" >&2; exit 1 ;;
esac
[[ "$root" != *"/../"* && "$root" != */.. ]] || { echo "YNX_DEVELOPER_MACOS_OUTPUT_DIR must not contain parent traversal" >&2; exit 1; }
[[ ! -e "$root" && ! -L "$root" ]] || { echo "Refusing to overwrite existing macOS package candidate: $root" >&2; exit 1; }

npm run code:build
node scripts/build-output-root.mjs claim "$root"
mkdir "$root/tmp"
export TMPDIR="$root/tmp"
app="$root/YNX Developer Testnet Preview.app"
mkdir -p "$root" "$app/Contents/MacOS" "$app/Contents/Resources/runtime" "$app/Contents/Resources/code/apps/developer/frontend"
branding_root="$root/branding"
node scripts/package-macos-branding.mjs assets "$branding_root"
cp "$branding_root/YNXDeveloper.icns" "$branding_root/installer-background.png" "$branding_root/branding-manifest.json" "$app/Contents/Resources/"
branding_sha=$(/usr/bin/shasum -a 256 "$app/Contents/Resources/branding-manifest.json" | awk '{print $1}')
# Keep the mature shell in Objective-C; the original parent supplier is ObjC++.
# The old refusal implementation defines the same ABI and must not be linked.
/usr/bin/clang -fobjc-arc -mmacosx-version-min="$macos_min_version" -I"$canonical_app_native_root/packages/wallet-auth/native" -I"$canonical_native_root/packages/wallet-auth/native" -Werror=unguarded-availability -Werror=unguarded-availability-new -fmodules-cache-path="$root/module-cache" -c desktop/macos/main.m -o "$root/main.o"
/usr/bin/clang++ -std=c++17 -fobjc-arc -mmacosx-version-min="$macos_min_version" -I"$canonical_app_native_root/packages/wallet-auth/native" -I"$canonical_native_root/packages/wallet-auth/native" -Idesktop/macos "$root/main.o" desktop/macos/original-ide-parent-supplier.mm "$canonical_native_root/packages/wallet-auth/native/original-auth-identity-source-authority.mm" "$canonical_native_root/packages/wallet-auth/native/original-auth-identity-joint-owner.mm" "$canonical_native_root/packages/wallet-auth/native/original-ide-parent-source-binding.mm" "$canonical_native_root/packages/wallet-auth/native/original-ide-parent-kernel.mm" "$canonical_native_root/packages/wallet-auth/native/original-ide-parent-observation.mm" "$canonical_app_native_root/packages/wallet-auth/native/original-ide-identity-launch-holder.mm" -o "$app/Contents/MacOS/YNXDeveloper" -framework Cocoa -framework Security -framework WebKit -lbsm
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
if [[ -n "$local_node_runtime" ]]; then
  /usr/libexec/PlistBuddy -c "Set LSMinimumSystemVersion $macos_min_version" "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add YNXDesktopMode string local-workbench' "$app/Contents/Info.plist"
  /usr/bin/clang -mmacosx-version-min="$macos_min_version" desktop/macos/local-workbench-lock.c -o "$app/Contents/Resources/runtime/ynx-local-workbench-lock"
  /usr/bin/clang -Wall -Wextra -Werror -mmacosx-version-min="$macos_min_version" desktop/macos/workspace-path-identity.c -o "$app/Contents/Resources/runtime/workspace-path-identity"
fi
cp desktop/code-server.mjs "$app/Contents/Resources/server.mjs"
cp -R frontend/dist "$app/Contents/Resources/code/apps/developer/frontend/dist"
cp -R frontend/src "$app/Contents/Resources/code/apps/developer/frontend/src"
cp -R protocol "$app/Contents/Resources/code/apps/developer/protocol"
cp -R services "$app/Contents/Resources/code/apps/developer/services"
mkdir -p "$app/Contents/Resources/code/apps/developer/desktop"
cp desktop/local-workbench.mjs desktop/local-startup-process.mjs desktop/local-plugin-copy.mjs desktop/local-workbench-ipc.mjs desktop/local-python-toolchain.mjs desktop/wallet-admission-startup.mjs desktop/wallet-admission-delivery.mjs desktop/wallet-identity-v2-caller.mjs desktop/native-parent-control.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
cp desktop/original-service-pipe.mjs desktop/private-payload-pump.mjs desktop/native-identity-channel.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
cp desktop/native-identity-ui.js "$app/Contents/Resources/code/apps/developer/desktop/"
cp desktop/native-tools-client.mjs desktop/local-ai-tools-host.mjs desktop/admitted-local-project.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
cp desktop/marketplace-catalog-policy.mjs desktop/marketplace-catalog-transport.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
cp desktop/marketplace-artifact-policy.mjs desktop/marketplace-artifact-transport.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
cp desktop/chain-public-reader.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
node scripts/package-identity-admission-source.mjs "$app/Contents/Resources/code"
node scripts/package-identity-admission-source.mjs --copy-native "$app/Contents/Resources/code"
mkdir -p "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/lib"
cp runtime/ynx-workbench/package.json "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/"
cp runtime/ynx-workbench/lib/wallet-admission-channel.js runtime/ynx-workbench/lib/wallet-admission-protocol.js "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/lib/"
cp runtime/ynx-workbench/lib/marketplace-channel.js runtime/ynx-workbench/lib/marketplace-diagnostics.js "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/lib/"
cp runtime/ynx-workbench/lib/marketplace-readme.js "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/lib/"
cp runtime/ynx-workbench/lib/marketplace-artifact-channel.js "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/lib/"
cp runtime/ynx-workbench/lib/chain-public-channel.js "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/lib/"
cp runtime/ynx-workbench/lib/local-ai-tools-channel.js "$app/Contents/Resources/code/apps/developer/runtime/ynx-workbench/lib/"
if [[ -n "$local_node_runtime" ]]; then
  cp desktop/workspace-path-identity.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
  cp desktop/local-debug-session.mjs desktop/local-debugpy-bootstrap.py "$app/Contents/Resources/code/apps/developer/desktop/"
  cp desktop/local-go-toolchain-supplier.mjs desktop/local-go-selection.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
  cp desktop/local-js-debug-session.mjs desktop/local-js-debug-launcher.mjs desktop/local-js-debug-launcher.sh "$app/Contents/Resources/code/apps/developer/desktop/"
  cp desktop/local-js-debug-launcher.mjs desktop/local-js-debug-launcher.sh "$app/Contents/Resources/runtime/"
  chmod 0755 "$app/Contents/Resources/runtime/local-js-debug-launcher.sh"
fi
# The packaged project preparer resolves these owned inputs relative to its
# service module. The composed archive alone does not supply those paths.
mkdir -p "$app/Contents/Resources/code/apps/developer/native"
cp -R native/ynx-brand native/ynx-tools native/ynx-go "$app/Contents/Resources/code/apps/developer/native/"
mkdir -p "$app/Contents/Resources/code/apps/developer/scripts"
cp scripts/compiler-worker.mjs scripts/compiler-pin.mjs scripts/solidity-semantic-index.mjs "$app/Contents/Resources/code/apps/developer/scripts/"
if [[ -n "${YNX_DEVELOPER_SOLIDITY_INPUT:-}" ]]; then
  node scripts/bundle-solidity-runtime.mjs "$YNX_DEVELOPER_SOLIDITY_INPUT" "$app/Contents/Resources/code/apps/developer/compiler-runtime"
  node scripts/bundle-solidity-language-runtime.mjs "$YNX_DEVELOPER_SOLIDITY_INPUT" "$app/Contents/Resources/code/apps/developer/native/ynx-tools"
fi
if [[ "${YNX_DEVELOPER_SOLIDITY_FORMAT_INPUT:-}" == retained ]]; then
  node scripts/bundle-solidity-format-runtime.mjs "$app/Contents/Resources/code/apps/developer/native/ynx-tools"
elif [[ -n "${YNX_DEVELOPER_SOLIDITY_FORMAT_INPUT:-}" ]]; then
  echo "YNX_DEVELOPER_SOLIDITY_FORMAT_INPUT must be retained when enabled." >&2
  exit 1
fi
cp package.json package-lock.json "$app/Contents/Resources/code/apps/developer/"
# APFS clones preserve a standalone dependency tree while sharing unchanged
# blocks. Retain any failed clone outside the app before a fresh normal copy.
if ! COPYFILE_DISABLE=1 cp -cR node_modules "$app/Contents/Resources/code/apps/developer/node_modules"; then
  if [[ -e "$app/Contents/Resources/code/apps/developer/node_modules" ]]; then
    mv "$app/Contents/Resources/code/apps/developer/node_modules" "$root/node_modules-clone-failed"
  fi
  if [[ "${YNX_DEVELOPER_MACOS_REQUIRE_CLONE:-0}" == 1 ]]; then
    echo "Required dependency clone failed; partial candidate preserved without an unbudgeted full copy." >&2
    exit 1
  fi
  COPYFILE_DISABLE=1 cp -XR node_modules "$app/Contents/Resources/code/apps/developer/node_modules"
fi
if [[ -n "$local_node_runtime" ]]; then
  node scripts/verify-packaged-local-imports.mjs "$app/Contents/Resources/code/apps/developer"
  node scripts/package-node-pty-distribution.mjs prepare "$app/Contents/Resources"
fi

# Preserve the exact reviewed native-component bytes inside an archive. Outer
# ad-hoc signing would otherwise mutate the composed runtime's pinned tree.
# This is distribution, not an alternative launch/authentication route: the
# existing protected operator still installs its exact registered driver.
composed_artifact="${YNX_DEVELOPER_COMPOSED_ARTIFACT:-}"
composed_pin="${YNX_DEVELOPER_COMPOSED_PIN:-}"
if [[ -n "$composed_artifact" || -n "$composed_pin" ]]; then
  [[ -n "$composed_artifact" && -n "$composed_pin" ]] || { echo "Both exact composed artifact and pin are required." >&2; exit 1; }
  if [[ -n "$local_node_runtime" ]]; then
    YNX_DEVELOPER_LOCAL_WORKBENCH_PAYLOAD=1 node scripts/bundle-composed-core.mjs "$composed_artifact" "$composed_pin" "$app/Contents/Resources/composed-core"
  else
    node scripts/bundle-composed-core.mjs "$composed_artifact" "$composed_pin" "$app/Contents/Resources/composed-core"
  fi
fi

node_binary="${YNX_DEVELOPER_NODE_BINARY:-}"
if [[ -n "$local_node_runtime" ]]; then
  node --input-type=module - "$local_node_runtime" "$app/Contents/Resources/runtime" <<'NODE'
import {readFile,mkdir,copyFile,chmod} from 'node:fs/promises';import {join,dirname} from 'node:path';
const [input,output]=process.argv.slice(2),record=JSON.parse(await readFile(join(input,'distribution.json')));
for(const entry of [...record.files,...record.notices]){const target=join(output,entry.path);await mkdir(dirname(target),{recursive:true});await copyFile(join(input,entry.path),target);}
await copyFile(join(input,'distribution.json'),join(output,'distribution.json'));await chmod(join(output,'node'),0o755);await chmod(join(output,'ynx-js-node'),0o755);
NODE
  node_binary="$local_node_runtime/node"
else
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
fi
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
const [output, sourceCommit, sourceTree, sourceDate, runtimeCheckpoint, sbomSha256, platform, minimumOS, macosCompatibilitySha256, brandingSha256] = process.argv.slice(1);
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
  sbomSha256,
  branding: {path: "Contents/Resources/branding-manifest.json", sha256: brandingSha256}
};
const coreReceipt = require("path").join(require("path").dirname(output), "composed-core/distribution.json");
if (fs.existsSync(coreReceipt)) record.composedCoreDistribution = JSON.parse(fs.readFileSync(coreReceipt, "utf8"));
fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
' "$app/Contents/Resources/build-provenance.json" "$source_commit" "$source_tree" "$source_date" "$runtime_checkpoint" "$sbom_sha" "$platform" "$macos_min_version" "$compatibility_sha" "$branding_sha"
/usr/bin/xattr -cr "$app"
# The reviewed portable Node binary may retain its distributor signature while
# native npm modules are locally ad-hoc signed. macOS library validation rejects
# that mixed-Team process. This entire unsigned Preview must therefore use one
# explicit no-Team-ID ad-hoc class for every bundled Mach-O before sealing the
# outer app.
while IFS= read -r bundled_binary; do
  # Signing the alias separately derives a filename-specific CodeDirectory and
  # breaks the debug supervisor's exact-runtime check. Seal Node once, then
  # derive its launcher alias from those signed bytes before recording hashes.
  if [[ -n "$local_node_runtime" && "$bundled_binary" == "$app/Contents/Resources/runtime/ynx-js-node" ]]; then
    continue
  fi
  /usr/bin/codesign --force --sign - "$bundled_binary"
done < <(node -e 'const fs=require("fs"),path=require("path"),app=process.argv[1],inventory=JSON.parse(fs.readFileSync(path.join(app,"Contents/Resources/macos-compatibility.json")));for(const binary of inventory.binaries)if(binary.path.startsWith("Contents/Resources/"))console.log(path.join(app,binary.path));' "$app")
if [[ -n "$local_node_runtime" ]]; then
  COPYFILE_DISABLE=1 cp -X "$app/Contents/Resources/runtime/node" "$app/Contents/Resources/runtime/ynx-js-node"
  chmod 0755 "$app/Contents/Resources/runtime/ynx-js-node"
  /usr/bin/codesign --verify --strict "$app/Contents/Resources/runtime/ynx-js-node"
fi
node --input-type=module - "$app/Contents/Resources" <<'NODE'
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const resources=process.argv[2],runtime=join(resources,'runtime'),path=join(runtime,'distribution.json');let record;
try{record=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')process.exit(0);throw error;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),modifications=[];
for(const entry of record.files){const bytes=await readFile(join(runtime,entry.path)),afterSha256=sha(bytes);if(afterSha256!==entry.bundledSha256){modifications.push({path:entry.path,beforeSha256:entry.bundledSha256,afterSha256});entry.bundledSha256=afterSha256;}}
record.packageAdhocSigning={signingClass:'adhoc-no-team-id',modifications};
await writeFile(path,JSON.stringify(record,null,2)+'\n');
if(execFileSync(join(runtime,'node'),['--version'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',OPENSSL_CONF:'/dev/null'}}).trim()!==record.version)throw Error('Signed bundled Node runtime version differs.');
const provenancePath=join(resources,'build-provenance.json'),provenance=JSON.parse(await readFile(provenancePath,'utf8'));
provenance.desktopMode='local-workbench';provenance.localNodeRuntime={path:'Contents/Resources/runtime/distribution.json',sha256:sha(await readFile(path)),version:record.version,minimumOS:record.minimumOS,packageAdhocSigning:record.packageAdhocSigning};
provenance.localWorkspaceHelpers={schemaVersion:1,minimumOS:provenance.minimumOS,signingClass:'adhoc-no-team-id',files:[]};
for(const [path,source] of [['runtime/ynx-local-workbench-lock','desktop/macos/local-workbench-lock.c'],['runtime/workspace-path-identity','desktop/macos/workspace-path-identity.c'],['code/apps/developer/desktop/workspace-path-identity.mjs','desktop/workspace-path-identity.mjs']])provenance.localWorkspaceHelpers.files.push({path:'Contents/Resources/'+path,sha256:sha(await readFile(join(resources,path))),source,sourceSha256:sha(await readFile(source))});
await writeFile(provenancePath,JSON.stringify(provenance,null,2)+'\n');
NODE
# Record the actual signed formatter bytes before sealing the outer app. Keep
# each original input hash so the local no-Team-ID signature is distinguishable
# from the retained dependency and the separately documented server derivative.
node --input-type=module - "$app/Contents/Resources" <<'NODE'
import {readFile, writeFile, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const resources=process.argv[2];
const formatter=join(resources,'code/apps/developer/native/ynx-tools/formatter');
const receipt=join(formatter,'distribution.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let record;
try {record=JSON.parse(await readFile(receipt,'utf8'));}
catch(error) {if(error.code==='ENOENT')process.exit(0);throw error;}
const modifications=[];
for(const [relative,beforeSha256] of Object.entries(record.files)) {
  if(relative.startsWith('/')||relative.split('/').some(part=>part==='..'||part===''))throw Error('Invalid formatter distribution path.');
  const file=join(formatter,relative);
  if(!(await lstat(file)).isFile())throw Error('Formatter distribution input is not a regular file.');
  const bytes=await readFile(file),afterSha256=sha(bytes);
  if(afterSha256===beforeSha256)continue;
  const magic=bytes.length>=4?bytes.readUInt32BE(0):0;
  if(![0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(magic))throw Error('Unexpected non-Mach-O formatter mutation: '+relative);
  modifications.push({path:relative,beforeSha256,afterSha256});
  record.files[relative]=afterSha256;
}
record.macosAdhocSigning={signingClass:'adhoc-no-team-id',modifications};
await writeFile(receipt,JSON.stringify(record,null,2)+'\n');
const provenancePath=join(resources,'build-provenance.json');
const provenance=JSON.parse(await readFile(provenancePath,'utf8'));
provenance.solidityFormatterDistribution={path:'Contents/Resources/code/apps/developer/native/ynx-tools/formatter/distribution.json',sha256:sha(await readFile(receipt)),packages:record.packages,macosAdhocSigning:record.macosAdhocSigning};
await writeFile(provenancePath,JSON.stringify(provenance,null,2)+'\n');
NODE
if [[ -n "$local_node_runtime" ]]; then
  node scripts/package-node-pty-distribution.mjs seal "$app/Contents/Resources"
fi
node scripts/package-identity-admission-source.mjs --seal-native "$app/Contents/Resources"
/usr/bin/codesign --force --deep --sign - "$app"
node scripts/package-identity-admission-source.mjs --verify-native "$app/Contents/Resources"
if [[ -n "$local_node_runtime" ]]; then
  node scripts/package-node-pty-distribution.mjs verify "$app/Contents/Resources"
fi
node --input-type=module - "$app/Contents/Resources" <<'NODE'
import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const resources=process.argv[2],runtime=join(resources,'runtime');let bytes;
try{bytes=await readFile(join(runtime,'distribution.json'));}catch(error){if(error.code==='ENOENT')process.exit(0);throw error;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),record=JSON.parse(bytes);
for(const entry of record.files)if(sha(await readFile(join(runtime,entry.path)))!==entry.bundledSha256)throw Error('Outer signing changed recorded runtime bytes.');
const nodeEntry=record.files.find(entry=>entry.path==='node'),jsEntry=record.files.find(entry=>entry.path==='ynx-js-node');
if(!nodeEntry||!jsEntry||jsEntry.derivedFrom!=='node'||jsEntry.bundledSha256!==nodeEntry.bundledSha256)throw Error('Final signed JavaScript Node entry differs from the sealed runtime.');
const provenance=JSON.parse(await readFile(join(resources,'build-provenance.json'),'utf8'));if(provenance.localNodeRuntime.sha256!==sha(bytes))throw Error('Signed runtime provenance differs.');
const expected=['Contents/Resources/runtime/ynx-local-workbench-lock','Contents/Resources/runtime/workspace-path-identity','Contents/Resources/code/apps/developer/desktop/workspace-path-identity.mjs'];
if(provenance.localWorkspaceHelpers?.schemaVersion!==1||provenance.localWorkspaceHelpers.files.length!==expected.length)throw Error('Native workspace helper ledger missing.');
for(const [index,entry] of provenance.localWorkspaceHelpers.files.entries()){if(entry.path!==expected[index]||sha(await readFile(join(resources,entry.path.slice('Contents/Resources/'.length))))!==entry.sha256)throw Error('Outer signing changed recorded workspace helper bytes.');}
console.log('Final signed workspace helpers and provenance match.');
console.log('Final signed Node runtime files and provenance match.');
NODE
node --input-type=module - "$app/Contents/Resources" <<'NODE'
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const resources=process.argv[2];
const formatter=join(resources,'code/apps/developer/native/ynx-tools/formatter');
let bytes;
try {bytes=await readFile(join(formatter,'distribution.json'));}
catch(error) {if(error.code==='ENOENT')process.exit(0);throw error;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=JSON.parse(bytes);
for(const [relative,expected] of Object.entries(record.files)) {
  if(sha(await readFile(join(formatter,relative)))!==expected)throw Error('Outer signing changed recorded formatter bytes: '+relative);
}
const provenance=JSON.parse(await readFile(join(resources,'build-provenance.json'),'utf8'));
if(provenance.solidityFormatterDistribution.sha256!==sha(bytes))throw Error('Formatter distribution provenance differs after outer signing.');
console.log('Final signed formatter files and provenance match.');
NODE
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
if ! grep -Fq 'Signature=adhoc' <<<"$signature" || ! grep -Fq 'TeamIdentifier=not set' <<<"$signature"; then
  echo "Refusing local-package classification: expected only linker ad-hoc signing with no team identity." >&2
  exit 1
fi
node scripts/build-output-root.mjs verify "$root"
node scripts/package-macos-branding.mjs verify-app "$app"
/usr/bin/codesign --verify --deep --strict "$app"
dmg_root="$root/dmg-root"
dmg="$root/ynx-developer-testnet-preview-${platform}-unsigned.dmg"
mkdir -p "$dmg_root"
# APFS can stage an identical copy without duplicating all runtime blocks.
# Other filesystems retain the existing regular-copy route.
if ! COPYFILE_DISABLE=1 cp -cR "$app" "$dmg_root/"; then
  if [[ "${YNX_DEVELOPER_MACOS_REQUIRE_CLONE:-0}" == 1 ]]; then
    echo "Required DMG staging clone failed; partial candidate preserved without an unbudgeted full copy." >&2
    exit 1
  fi
  # Preserve a failed clone attempt; the fallback starts in a fresh directory.
  dmg_root="$root/dmg-root-fallback"
  mkdir "$dmg_root"
  COPYFILE_DISABLE=1 cp -XR "$app" "$dmg_root/"
fi
node scripts/package-macos-branding.mjs dmg "$dmg_root" "$branding_root" "$dmg"
node scripts/build-output-root.mjs verify "$root"
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
