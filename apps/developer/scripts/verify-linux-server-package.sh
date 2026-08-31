#!/usr/bin/env bash
set -euo pipefail

archive=${1:?"Usage: verify-linux-server-package.sh ARCHIVE EXPECTED_SOURCE_COMMIT"}
expected_commit=${2:?"Usage: verify-linux-server-package.sh ARCHIVE EXPECTED_SOURCE_COMMIT"}
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo "Linux x86_64 is required." >&2; exit 1; }
[[ -f "$archive" && "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Archive and full expected source commit are required." >&2; exit 1; }

work=$(mktemp -d /tmp/ynx-developer-linux-verify.XXXXXX)
server_pid=""
cleanup(){ if [[ -n "$server_pid" ]]; then kill "$server_pid" >/dev/null 2>&1 || true; wait "$server_pid" 2>/dev/null || true; fi; rm -rf "$work"; }
trap cleanup EXIT
tar -xzf "$archive" -C "$work"
bundle=$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'ynx-developer-*-linux-x64-server' -print -quit)
[[ -n "$bundle" && -f "$bundle/release-manifest.json" && -f "$bundle/app/services/gateway/src/server.mjs" && -d "$bundle/app/node_modules" && -f "$bundle/app/frontend/dist/index.html" ]] || { echo "Incomplete Linux server appliance." >&2; exit 1; }
node -e '
const fs=require("fs"); const [file,expected]=process.argv.slice(1); const value=JSON.parse(fs.readFileSync(file,"utf8"));
for(const [key,expectedValue] of Object.entries({schemaVersion:1,productId:"ynx-developer-v1",artifactClass:"unsigned-testnet-preview",platform:"linux-x64-server",deliveryMode:"self-hosted-server-appliance",sourceCommit:expected,productionSigned:false})) if(value[key]!==expectedValue) throw new Error(`${key} mismatch`);
if(!/^[0-9a-f]{64}$/.test(value.sourceEvidenceManifestSha256||"")) throw new Error("protected deployment evidence digest is missing");
if(value.minimumRuntime?.node!==">=22"||value.bundled?.applicationDependencies!==true||value.bundled?.workspaceState!==false||value.bundled?.operatorEnvironment!==false) throw new Error("unsafe or incomplete server manifest");
' "$bundle/release-manifest.json" "$expected_commit"
port=$(node -e 'const net=require("net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close()})')
state="$work/state"
NODE_ENV=test HOST=127.0.0.1 PORT="$port" YNX_CODE_STATE_DIR="$state" YNX_CODE_STATIC_ROOT="$bundle/app/frontend/dist" node "$bundle/app/services/gateway/src/server.mjs" >"$work/server.log" 2>&1 &
server_pid=$!
for _ in {1..80}; do
  if curl --fail --silent --show-error "http://127.0.0.1:$port/healthz" >"$work/health.json"; then break; fi
  kill -0 "$server_pid" 2>/dev/null || { cat "$work/server.log" >&2; echo "Linux appliance exited during cold start." >&2; exit 1; }
  sleep 0.1
done
node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(value.ok!==true||value.service!=="ynx-code-gateway"||value.sandboxReady!==true)throw new Error(`invalid health: ${JSON.stringify(value)}`)' "$work/health.json"
kill "$server_pid"; wait "$server_pid" 2>/dev/null || true; server_pid=""
echo "Extracted Linux x64 server appliance cold start and health verification passed: $bundle"
