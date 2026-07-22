#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

commit="$(git rev-parse HEAD)"
release="ynx-bridge-${commit:0:12}"
build_time="2026-07-22T00:00:00Z"
ldflags="-s -w -buildid= -X main.buildCommit=$commit -X main.buildRelease=$release -X main.buildTime=$build_time"
for output in first second; do
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags "$ldflags" -o "$tmp/$output/ynx-bridged" ./cmd/ynx-bridged
done
first_sha="$(shasum -a 256 "$tmp/first/ynx-bridged" | awk '{print $1}')"
second_sha="$(shasum -a 256 "$tmp/second/ynx-bridged" | awk '{print $1}')"
[[ "$first_sha" == "$second_sha" ]] || { echo "Bridge builds are not reproducible" >&2; exit 1; }
module_count="$(go list -deps -f '{{if .Module}}{{if ne .Module.Path "github.com/JiahaoAlbus/YNX-Chain"}}{{.Module.Path}}{{end}}{{end}}' ./cmd/ynx-bridged | sed '/^$/d' | sort -u | wc -l | tr -d ' ')"
[[ "$module_count" == 0 ]] || { echo "Bridge binary has unexpected third-party modules" >&2; exit 1; }
node ./scripts/package/bridge-sbom.mjs "$tmp/first/ynx-bridged" "$tmp/bridge-sbom.spdx.json" "$commit" "$release" "$build_time"
node - "$tmp/bridge-sbom.spdx.json" "$first_sha" "$commit" <<'NODE'
const fs=require("fs"); const [path,sha,commit]=process.argv.slice(2); const d=JSON.parse(fs.readFileSync(path));
if(d.spdxVersion!=="SPDX-2.3"||d.packages?.length!==2||d.artifact?.sha256!==sha||d.artifact?.signingClass!=="unsigned-local-testnet"||d.artifact?.installedLocal!==false||d.artifact?.deployedPublic!==false||d.packages[0]?.versionInfo!==commit) throw new Error("Bridge SBOM or artifact truth state invalid");
NODE
bytes="$(wc -c < "$tmp/first/ynx-bridged" | tr -d ' ')"
echo "bridge supply-chain check passed: reproducible linux/amd64 sha256=$first_sha bytes=$bytes SPDX packages=2 signing=unsigned-local-testnet"
