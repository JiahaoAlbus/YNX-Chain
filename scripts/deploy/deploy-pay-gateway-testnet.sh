#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
source scripts/deploy/lib.sh

host="${PRIMARY_NODE_HOST:-43.153.202.237}"
user="${PRIMARY_NODE_USER:-ubuntu}"
key="${PRIMARY_NODE_SSH_KEY:-/Users/huangjiahao/Downloads/Huang.pem}"
ynx_require_clean_worktree
[[ -r "$key" ]] || { echo "Primary Testnet SSH key is not readable" >&2; exit 1; }

commit="$(git rev-parse HEAD)"
release="ynx-payd-${commit:0:12}"
build_time="$(node -e 'process.stdout.write(new Date().toISOString())')"
candidate="${TMPDIR:-/tmp}/$release"
flags="-s -w -X main.buildCommit=$commit -X main.buildRelease=$release -X main.buildTime=$build_time"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "$flags" -o "$candidate" ./cmd/ynx-payd
chmod 0755 "$candidate"
sha="$(sha256sum "$candidate" | awk '{print $1}')"
remote="$user@$host"
remote_candidate="/tmp/$release"
remote_installer="/tmp/install-$release.sh"
ynx_transport_scp "pay-gateway-primary" "$key" "$candidate" "$remote" "$remote_candidate"
ynx_transport_scp "pay-gateway-installer" "$key" scripts/deploy/install-pay-gateway-testnet-remote.sh "$remote" "$remote_installer"
ynx_transport_ssh "pay-gateway-primary" "$key" "$remote" "sudo bash '$remote_installer' '$remote_candidate' '$sha' '$commit' '$release'"
