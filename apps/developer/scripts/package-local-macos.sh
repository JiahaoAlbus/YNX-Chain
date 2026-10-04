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
local_node_runtime="${YNX_DEVELOPER_LOCAL_NODE_RUNTIME:-}"
if [[ -n "$local_node_runtime" ]]; then
  [[ -n "${YNX_DEVELOPER_COMPOSED_ARTIFACT:-}" && -n "${YNX_DEVELOPER_COMPOSED_PIN:-}" ]] || { echo "Local workbench requires its exact composed payload and pin." >&2; exit 1; }
  macos_min_version=$(node --input-type=module - "$local_node_runtime" "$PWD/.ynx-developer-candidates" "$macos_min_version" <<'NODE'
import {readFile,realpath,lstat} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const [input,candidates,baseline]=process.argv.slice(2),root=await realpath(input);
if(root!==input||!root.startsWith(candidates+'/'))throw Error('Use the exact retained owned Node runtime.');
const record=JSON.parse(await readFile(join(root,'distribution.json')));
if(record.schemaVersion!==1||!record.executionVerified||!/^v26\./.test(record.version)||!/^\d+(?:\.\d+)*$/.test(record.minimumOS))throw Error('Reviewed Node 26 closure required.');
for(const entry of record.files){if(!/^(node|lib\/[^/]+)$/.test(entry.path))throw Error('Invalid runtime file.');const path=join(root,entry.path);if(!(await lstat(path)).isFile())throw Error('Regular runtime input required.');if(createHash('sha256').update(await readFile(path)).digest('hex')!==entry.bundledSha256)throw Error('Runtime input changed.');}
for(const entry of record.notices){if(!entry.path.startsWith('notices/')||entry.path.split('/').includes('..'))throw Error('Invalid runtime notice.');if(createHash('sha256').update(await readFile(join(root,entry.path))).digest('hex')!==entry.sha256)throw Error('Runtime notice changed.');}
if(execFileSync(join(root,'node'),['--version'],{encoding:'utf8'}).trim()!==record.version)throw Error('Retained runtime version changed.');
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;};
console.log(compare(record.minimumOS,baseline)>0?record.minimumOS:baseline);
NODE
  )
fi
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
branding_root="$root/branding"
node scripts/package-macos-branding.mjs assets "$branding_root"
cp "$branding_root/YNXDeveloper.icns" "$branding_root/installer-background.png" "$branding_root/branding-manifest.json" "$app/Contents/Resources/"
branding_sha=$(/usr/bin/shasum -a 256 "$app/Contents/Resources/branding-manifest.json" | awk '{print $1}')
/usr/bin/clang -fobjc-arc -mmacosx-version-min="$macos_min_version" -Werror=unguarded-availability -Werror=unguarded-availability-new -fmodules-cache-path="$root/module-cache" desktop/macos/main.m -o "$app/Contents/MacOS/YNXDeveloper" -framework Cocoa -framework Security -framework WebKit
cp desktop/macos/Info.plist "$app/Contents/Info.plist"
if [[ -n "$local_node_runtime" ]]; then
  /usr/libexec/PlistBuddy -c "Set LSMinimumSystemVersion $macos_min_version" "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add YNXDesktopMode string local-workbench' "$app/Contents/Info.plist"
  /usr/bin/clang -mmacosx-version-min="$macos_min_version" desktop/macos/local-workbench-lock.c -o "$app/Contents/Resources/runtime/ynx-local-workbench-lock"
fi
cp desktop/code-server.mjs "$app/Contents/Resources/server.mjs"
cp -R frontend/dist "$app/Contents/Resources/code/apps/developer/frontend/dist"
cp -R frontend/src "$app/Contents/Resources/code/apps/developer/frontend/src"
cp -R protocol "$app/Contents/Resources/code/apps/developer/protocol"
cp -R services "$app/Contents/Resources/code/apps/developer/services"
mkdir -p "$app/Contents/Resources/code/apps/developer/desktop"
cp desktop/local-workbench.mjs "$app/Contents/Resources/code/apps/developer/desktop/"
# The packaged project preparer resolves these owned inputs relative to its
# service module. The composed archive alone does not supply those paths.
mkdir -p "$app/Contents/Resources/code/apps/developer/native"
cp -R native/ynx-brand native/ynx-tools "$app/Contents/Resources/code/apps/developer/native/"
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
await copyFile(join(input,'distribution.json'),join(output,'distribution.json'));await chmod(join(output,'node'),0o755);
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
  /usr/bin/codesign --force --sign - "$bundled_binary"
done < <(node -e 'const fs=require("fs"),path=require("path"),app=process.argv[1],inventory=JSON.parse(fs.readFileSync(path.join(app,"Contents/Resources/macos-compatibility.json")));for(const binary of inventory.binaries)if(binary.path.startsWith("Contents/Resources/"))console.log(path.join(app,binary.path));' "$app")
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
/usr/bin/codesign --force --deep --sign - "$app"
node --input-type=module - "$app/Contents/Resources" <<'NODE'
import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const resources=process.argv[2],runtime=join(resources,'runtime');let bytes;
try{bytes=await readFile(join(runtime,'distribution.json'));}catch(error){if(error.code==='ENOENT')process.exit(0);throw error;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),record=JSON.parse(bytes);
for(const entry of record.files)if(sha(await readFile(join(runtime,entry.path)))!==entry.bundledSha256)throw Error('Outer signing changed recorded runtime bytes.');
const provenance=JSON.parse(await readFile(join(resources,'build-provenance.json'),'utf8'));if(provenance.localNodeRuntime.sha256!==sha(bytes))throw Error('Signed runtime provenance differs.');
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
