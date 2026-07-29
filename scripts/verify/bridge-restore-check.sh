#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
commit="$(git rev-parse HEAD)"; output="${1:-}"
GOOS="$(go env GOOS)" GOARCH="$(go env GOARCH)" CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags "-s -w -buildid= -X main.buildCommit=$commit -X main.buildRelease=ynx-bridge-${commit:0:12} -X main.buildTime=bounded-local-restore" -o "$tmp/ynx-bridged" ./cmd/ynx-bridged
port="$(node -e 'const net=require("node:net");const server=net.createServer();server.unref();server.once("error",error=>{console.error(error);process.exit(1)});server.listen(0,"127.0.0.1",()=>{const address=server.address();if(!address||typeof address==="string"){process.exit(1)}console.log(address.port);server.close()})')"
case "$port" in
  ''|*[!0-9]*) echo "failed to reserve restore probe port" >&2; exit 1 ;;
esac
probe="$tmp/bridge-restore-probe.mjs"
sed "s/16435/$port/g" ./scripts/verify/bridge-restore-probe.mjs > "$probe"
node "$probe" "$tmp/ynx-bridged" "$commit" "$output"
