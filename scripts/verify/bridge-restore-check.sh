#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
commit="$(git rev-parse HEAD)"; output="${1:-}"
GOOS="$(go env GOOS)" GOARCH="$(go env GOARCH)" CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags "-s -w -buildid= -X main.buildCommit=$commit -X main.buildRelease=ynx-bridge-${commit:0:12} -X main.buildTime=bounded-local-restore" -o "$tmp/ynx-bridged" ./cmd/ynx-bridged
node ./scripts/verify/bridge-restore-probe.mjs "$tmp/ynx-bridged" "$commit" "$output"
