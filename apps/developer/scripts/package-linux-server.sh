#!/usr/bin/env bash
set -euo pipefail

source_dir=${1:?"Usage: package-linux-server.sh SOURCE_DIR OUTPUT_DIR"}
output_dir=${2:?"Usage: package-linux-server.sh SOURCE_DIR OUTPUT_DIR"}
expected_commit=${YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT:?"Set YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT to the protected release commit."}
evidence_dir=${YNX_DEVELOPER_PROTECTED_EVIDENCE_DIR:?"Set YNX_DEVELOPER_PROTECTED_EVIDENCE_DIR to the passed protected deployment evidence directory."}

[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo "Linux x86_64 is required." >&2; exit 1; }
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "Expected source commit must be a full SHA-1." >&2; exit 1; }
[[ -d "$source_dir/node_modules" && -f "$source_dir/package.json" && -f "$source_dir/services/gateway/src/server.mjs" && -d "$source_dir/frontend/dist" ]] || { echo "The source directory is not a complete built Developer server tree." >&2; exit 1; }
[[ -f "$evidence_dir/source-commit.txt" && -f "$evidence_dir/result.txt" && -f "$evidence_dir/evidence-sha256.txt" ]] || { echo "Protected deployment evidence is incomplete." >&2; exit 1; }
evidence_commit=$(sed -n 's/^commit //p' "$evidence_dir/source-commit.txt" | head -n 1)
[[ "$evidence_commit" == "$expected_commit" ]] || { echo "Protected evidence commit $evidence_commit does not match expected $expected_commit." >&2; exit 1; }
grep -Fxq 'passed' "$evidence_dir/result.txt" || { echo "Protected deployment evidence did not pass." >&2; exit 1; }
(cd "$evidence_dir" && sha256sum -c evidence-sha256.txt >/dev/null)
node_version=$(node --version)
node -e 'const major=Number(process.versions.node.split(".")[0]);if(major<22)throw new Error("Node.js 22 or newer is required")'

work=$(mktemp -d /tmp/ynx-developer-linux-package.XXXXXX)
cleanup(){ rm -rf "$work"; }
trap cleanup EXIT
name="ynx-developer-0.2.0-testnet-preview-${expected_commit:0:8}-linux-x64-server"
bundle="$work/$name"
mkdir -p "$bundle/app"

# This is a server appliance, not a desktop package. It intentionally carries the
# Linux dependency tree and built frontend but neither workspace state nor any
# operator environment/secrets.
tar --exclude='./.ynx-code' --exclude='./.ynx-developer-local' --exclude='./.ynx-developer-windows' --exclude='./frontend/.vite' -C "$source_dir" -cf - . | tar -C "$bundle/app" -xf -
node -e '
const fs=require("fs");
const [out,commit,nodeVersion,evidenceHash]=process.argv.slice(1);
fs.writeFileSync(out,`${JSON.stringify({
  schemaVersion:1,productId:"ynx-developer-v1",version:"0.2.0",artifactClass:"unsigned-testnet-preview",
  platform:"linux-x64-server",deliveryMode:"self-hosted-server-appliance",sourceCommit:commit,
  sourceEvidenceManifestSha256:evidenceHash,
  minimumRuntime:{os:"Linux x86_64",node:">=22"},bundled:{applicationDependencies:true,builtFrontend:true,workspaceState:false,operatorEnvironment:false},
  nodeVersionAtPackage:nodeVersion,productionSigned:false,notarized:false,storeReleased:false
},null,2)}\n`);
' "$bundle/release-manifest.json" "$expected_commit" "$node_version" "$(sha256sum "$evidence_dir/evidence-sha256.txt" | awk '{print $1}')"
mkdir -p "$output_dir"
archive="$output_dir/$name.tar.gz"
tar -C "$work" -czf "$archive" "$name"
sha256sum "$archive"
printf 'Built Linux x64 server appliance %s from protected source %s using Node %s.\n' "$archive" "$expected_commit" "$node_version"
