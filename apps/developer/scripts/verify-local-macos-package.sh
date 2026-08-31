#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
machine_arch=$(/usr/bin/uname -m)
case "$machine_arch" in
  arm64) platform="macos-arm64"; pty_arch="darwin-arm64" ;;
  x86_64) platform="macos-x64"; pty_arch="darwin-x64" ;;
  *) echo "Unsupported macOS architecture: $machine_arch" >&2; exit 1 ;;
esac
source_commit=$(/usr/bin/git rev-parse HEAD)
candidate_root="$PWD/.ynx-developer-candidates"
root="${YNX_DEVELOPER_MACOS_OUTPUT_DIR:-$candidate_root/${source_commit:0:12}-${platform}}"
case "$root" in
  "$candidate_root"/*) ;;
  *) echo "YNX_DEVELOPER_MACOS_OUTPUT_DIR must stay under $candidate_root" >&2; exit 1 ;;
esac
[[ "$root" != *"/../"* && "$root" != */.. ]] || { echo "YNX_DEVELOPER_MACOS_OUTPUT_DIR must not contain parent traversal" >&2; exit 1; }
dmg="$root/ynx-developer-testnet-preview-${platform}-unsigned.dmg"
[[ -f "$dmg" ]] || { echo "Build the macOS DMG first." >&2; exit 1; }
work=$(mktemp -d /private/tmp/ynx-developer-install.XXXXXX)
cleanup() {
  if [[ -n "${app_pid:-}" ]]; then kill "$app_pid" >/dev/null 2>&1 || true; wait "$app_pid" 2>/dev/null || true; fi
  if [[ -n "${mount_point:-}" ]]; then /usr/bin/hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
mount_point=$(/usr/bin/hdiutil attach -nobrowse -readonly "$dmg" | /usr/bin/awk 'match($0, /\/Volumes\/.*/) { print substr($0, RSTART); exit }')
# Recent macOS versions can return from hdiutil before APFS has materialized
# the final volume directory.  Wait briefly for that directory rather than
# treating a valid image as an installation failure.
for _ in {1..30}; do
  [[ -d "$mount_point" ]] && break
  sleep 0.1
done
[[ -d "$mount_point" ]] || { echo "DMG did not mount at expected volume path: $mount_point" >&2; exit 1; }
mounted_app="$mount_point/YNX Developer Testnet Preview.app"
[[ -x "$mounted_app/Contents/MacOS/YNXDeveloper" ]]
[[ -x "$mounted_app/Contents/Resources/runtime/node" ]]
[[ -f "$mounted_app/Contents/Resources/build-provenance.json" ]]
[[ -f "$mounted_app/Contents/Resources/sbom.cdx.json" ]]
install_root="$work/Applications"
installed_app="$install_root/YNX Developer Testnet Preview.app"
mkdir -p "$install_root"
/usr/bin/ditto "$mounted_app" "$installed_app"
app="$installed_app"
[[ -x "$app/Contents/MacOS/YNXDeveloper" ]] || { echo "DMG app did not survive installation copy." >&2; exit 1; }
echo "Installed mounted DMG application to isolated Applications root: $app"
expected_source_commit="${YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT:-$(/usr/bin/git rev-parse HEAD)}"
expected_source_tree="${YNX_DEVELOPER_EXPECTED_SOURCE_TREE:-$(/usr/bin/git rev-parse "$expected_source_commit^{tree}")}"
expected_runtime_checkpoint=$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync("product-release.json","utf8")).commit)')
node -e '
const crypto = require("crypto");
const fs = require("fs");
const [provenancePath, sbomPath, expectedCommit, expectedTree, expectedRuntime, expectedPlatform] = process.argv.slice(1);
const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
const sbom = fs.readFileSync(sbomPath);
const sbomSha256 = crypto.createHash("sha256").update(sbom).digest("hex");
const expected = {
  schemaVersion: 1,
  productId: "ynx-developer-v1",
  artifactClass: "unsigned-testnet-preview",
  platform: expectedPlatform,
  signingClass: "adhoc-no-team-id",
  sourceCommit: expectedCommit,
  sourceTree: expectedTree,
  runtimeCheckpoint: expectedRuntime,
  sourceDirty: false,
  sbomPath: "Contents/Resources/sbom.cdx.json",
  sbomSha256
};
for (const [key, value] of Object.entries(expected)) {
  if (provenance[key] !== value) throw new Error(`provenance ${key} mismatch: ${provenance[key]} != ${value}`);
}
const parsedSbom = JSON.parse(sbom.toString("utf8"));
if (parsedSbom.bomFormat !== "CycloneDX" || parsedSbom.specVersion !== "1.5" || !Array.isArray(parsedSbom.components) || parsedSbom.components.length < 100) throw new Error("full YNX Code CycloneDX component inventory is missing");
for (const required of ["Node.js", "npm", "node-pty", "monaco-editor", "react", "yjs"]) if (!parsedSbom.components.some(component => component.name === required)) throw new Error(`SBOM component ${required} is missing`);
console.log(`Embedded provenance verified for source ${provenance.sourceCommit} and SBOM ${sbomSha256}.`);
' "$app/Contents/Resources/build-provenance.json" "$app/Contents/Resources/sbom.cdx.json" "$expected_source_commit" "$expected_source_tree" "$expected_runtime_checkpoint" "$platform"
if /usr/bin/xattr -p com.apple.quarantine "$app" >/dev/null 2>&1; then echo "DMG unexpectedly restored quarantine metadata." >&2; exit 1; fi
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
signature=$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)
grep -Fq 'Signature=adhoc' <<<"$signature"
grep -Fq 'TeamIdentifier=not set' <<<"$signature"
for bundled_binary in "$app/Contents/Resources/runtime/node" "$app/Contents/Resources/code/apps/developer/node_modules/node-pty/prebuilds/$pty_arch/pty.node"; do
  bundled_signature=$(/usr/bin/codesign -dv --verbose=4 "$bundled_binary" 2>&1 || true)
  grep -Fq 'Signature=adhoc' <<<"$bundled_signature"
  grep -Fq 'TeamIdentifier=not set' <<<"$bundled_signature"
done
self_test_output=$("$app/Contents/MacOS/YNXDeveloper" --self-test "$app/Contents/Resources")
printf '%s\n' "$self_test_output"
grep -Eq '^YNX Wallet scheme state: installed=(true|false) schemeRegistered=(true|false)$' <<<"$self_test_output"
export YNX_CODE_DESKTOP_SUPPORT_DIR="$work/support"
"$app/Contents/MacOS/YNXDeveloper" >"$work/cold-launch.log" 2>&1 &
app_pid=$!
server_pid=""
for _ in {1..50}; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$work/cold-launch.log" >&2
    echo "Extracted macOS Testnet Preview exited during cold launch." >&2
    exit 1
  fi
  server_pid=$(/usr/bin/pgrep -P "$app_pid" 2>/dev/null || true)
  [[ -n "$server_pid" ]] && break
  sleep 0.1
done
[[ -n "$server_pid" ]] || { cat "$work/cold-launch.log" >&2; echo "Bundled local server did not start during cold launch." >&2; exit 1; }
server_command=$(/bin/ps -o command= -p "$server_pid")
[[ "$server_command" == *"Contents/Resources/runtime/node"* && "$server_command" == *"Contents/Resources/server.mjs"* ]] || { echo "Cold launch started an unexpected child process: $server_command" >&2; exit 1; }
runtime_port=""
for _ in {1..50}; do
  runtime_port=$(/usr/sbin/lsof -Pan -p "$server_pid" -iTCP -sTCP:LISTEN 2>/dev/null | /usr/bin/awk 'NR>1 {sub(/^.*:/,"",$9); print $9; exit}' || true)
  [[ "$runtime_port" =~ ^[0-9]+$ ]] && break
  sleep 0.1
done
[[ "$runtime_port" =~ ^[0-9]+$ ]] || { echo "Bundled desktop runtime did not expose a local port." >&2; exit 1; }
/usr/bin/curl -fsS -c "$work/cookies" "http://127.0.0.1:$runtime_port/runtime/health" | "$app/Contents/Resources/runtime/node" -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(0));for(const id of ["javascript","cpp"]){if(v.compilers?.[id]!==true)throw new Error(`${id} toolchain unavailable`);}if(!v.sandboxReady)throw new Error("desktop sandbox unavailable");console.log("Bundled YNX Code runtime detected JavaScript and C++ toolchains.");'
/usr/bin/curl -fsS -b "$work/cookies" -X POST "http://127.0.0.1:$runtime_port/runtime/tasks" -H 'content-type: application/json' --data '{"protocolVersion":"ynx-code/v1","task":"build-run-active","approval":"execute-once","activePath":"hello.cpp","projectId":"package-cpp-verification","files":{"hello.cpp":"#include <iostream>\nint main(){ std::cout << 1; return 0; }"}}' | "$app/Contents/Resources/runtime/node" -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(0));if(!v.ok||v.code!==0||v.language!=="cpp"||v.sandbox?.network!==false)throw new Error(`C++ package compile failed: ${JSON.stringify(v)}`);console.log("Bundled YNX Code runtime completed a real bounded C++ compile.");'
/usr/bin/curl -fsS -b "$work/cookies" -X POST "http://127.0.0.1:$runtime_port/runtime/language/cpp" -H 'content-type: application/json' --data '{"protocolVersion":"ynx-code/v1","projectId":"package-lsp-verification","files":{"main.cpp":"int square(int value) { return value * value; }\nint main(){ return square(2); }\n"},"activePath":"main.cpp","operation":"documentSymbols"}' | "$app/Contents/Resources/runtime/node" -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(0));if(v.language!=="cpp"||v.operation!=="documentSymbols"||!Array.isArray(v.result)||v.result.length<1||v.sandbox?.network!==false)throw new Error(`C++ package LSP failed: ${JSON.stringify(v)}`);console.log(`Bundled YNX Code runtime completed a real C++ LSP document-symbol request with ${v.result.length} symbols.`);'
/usr/bin/curl -fsS -b "$work/cookies" -X PUT "http://127.0.0.1:$runtime_port/runtime/workspaces/package-persist" -H 'content-type: application/json' --data '{"protocolVersion":"ynx-code/v1","expectedRevision":0,"idempotencyKey":"package-save-00000001","workspace":{"name":"Persistent package check","folders":[],"files":{"hello.cpp":"int main(){return 0;}"},"open":["hello.cpp"],"active":"hello.cpp"}}' | "$app/Contents/Resources/runtime/node" -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(0));if(v.workspace?.revision!==1)throw new Error("workspace was not saved");'
kill "$app_pid"
wait "$app_pid" 2>/dev/null || true
app_pid=""
for _ in {1..30}; do
  kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$server_pid" 2>/dev/null; then
  kill "$server_pid" >/dev/null 2>&1 || true
  echo "Bundled local server survived App termination." >&2
  exit 1
fi
"$app/Contents/MacOS/YNXDeveloper" >"$work/second-launch.log" 2>&1 &
app_pid=$!
second_server_pid=""
for _ in {1..50}; do second_server_pid=$(/usr/bin/pgrep -P "$app_pid" 2>/dev/null || true); [[ -n "$second_server_pid" ]] && break; sleep 0.1; done
[[ -n "$second_server_pid" ]] || { cat "$work/second-launch.log" >&2; echo "Bundled local server did not start during second launch." >&2; exit 1; }
second_command=$(/bin/ps -o command= -p "$second_server_pid")
[[ "$second_command" == *"Contents/Resources/runtime/node"* && "$second_command" == *"Contents/Resources/server.mjs"* ]] || { echo "Second launch started an unexpected child process: $second_command" >&2; exit 1; }
second_runtime_port=""
for _ in {1..50}; do second_runtime_port=$(/usr/sbin/lsof -Pan -p "$second_server_pid" -iTCP -sTCP:LISTEN 2>/dev/null | /usr/bin/awk 'NR>1 {sub(/^.*:/,"",$9); print $9; exit}' || true); [[ "$second_runtime_port" =~ ^[0-9]+$ ]] && break; sleep 0.1; done
[[ "$second_runtime_port" =~ ^[0-9]+$ ]] || { echo "Second YNX Code runtime did not expose a local port." >&2; exit 1; }
/usr/bin/curl -fsS -b "$work/cookies" "http://127.0.0.1:$second_runtime_port/runtime/workspaces/package-persist" | "$app/Contents/Resources/runtime/node" -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(0));if(v.workspace?.files?.["hello.cpp"]!=="int main(){return 0;}"||v.workspace?.revision!==1)throw new Error("workspace did not survive second launch");console.log("YNX Code session and workspace survived second launch.");'
kill "$app_pid"; wait "$app_pid" 2>/dev/null || true; app_pid=""
for _ in {1..30}; do kill -0 "$second_server_pid" 2>/dev/null || break; sleep 0.1; done
if kill -0 "$second_server_pid" 2>/dev/null; then kill "$second_server_pid" >/dev/null 2>&1 || true; echo "Bundled local server survived second App termination." >&2; exit 1; fi
echo "Mounted macOS YNX Code DMG self-test, cold launch, real C++ compile, persistent second launch and child cleanup passed: $app"
