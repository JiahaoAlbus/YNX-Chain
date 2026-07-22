#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

GOMAXPROCS="${GOMAXPROCS:-2}" go test ./internal/governance ./cmd/ynx-governanced ./cmd/ynx-governance-state
go vet ./internal/governance ./cmd/ynx-governanced ./cmd/ynx-governance-state
jq empty release/product-release.json release/public-product-metadata.json release/integration/governance-app-gateway.manifest.json release/integration/governance-app-gateway.schema.json release/integration/governance-bft.manifest.json release/integration/governance-bft.schema.json release/integration/governance-bft-test-vectors.json

if rg -n -i 'TODO|FIXME|Placeholder|Coming soon|example\.com|Fake Balance|Fake User|Fake Transaction|Fake Price|Fake Revenue|Fake APY|Fake Liquidity|Fake Provider|Fake Health|Hard-coded Success|No-op Button' internal/governance cmd/ynx-governance-state cmd/ynx-governanced docs/governance release infra/systemd/ynx-governanced.example.service infra/docker/ynx-governanced.Dockerfile; then
  echo "governance forbidden runtime/public text scan failed" >&2
  exit 1
fi

if rg -n --hidden -g '!node_modules/**' -g '!.git/**' '(BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{32,})' cmd/ynx-governance-state cmd/ynx-governanced internal/governance docs/governance release infra; then
  echo "governance secret pattern scan failed" >&2
  exit 1
fi

build_dir="$(mktemp -d "${TMPDIR:-/tmp}/ynx-governance-build.XXXXXX")"
cleanup() { find "$build_dir" -type f -delete; find "$build_dir" -depth -type d -empty -delete; }
trap cleanup EXIT
for pass in one two; do
  CGO_ENABLED=0 go build -trimpath -o "$build_dir/ynx-governanced-$pass" ./cmd/ynx-governanced
  CGO_ENABLED=0 go build -trimpath -o "$build_dir/ynx-governance-state-$pass" ./cmd/ynx-governance-state
done
cmp "$build_dir/ynx-governanced-one" "$build_dir/ynx-governanced-two"
cmp "$build_dir/ynx-governance-state-one" "$build_dir/ynx-governance-state-two"
shasum -a 256 "$build_dir/ynx-governanced-one" "$build_dir/ynx-governance-state-one"

echo "governance local verification passed; public deployment and BFT execution are not implied"
