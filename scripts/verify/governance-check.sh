#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

GOMAXPROCS="${GOMAXPROCS:-2}" go test ./internal/governance ./cmd/ynx-governanced ./cmd/ynx-governance-state
go vet ./internal/governance ./cmd/ynx-governanced ./cmd/ynx-governance-state
jq empty release/product-release.json release/public-product-metadata.json release/integration/governance-app-gateway.manifest.json release/integration/governance-app-gateway.schema.json release/integration/governance-bft.manifest.json release/integration/governance-bft.schema.json release/integration/governance-bft-test-vectors.json
npm --prefix apps/governance run lint
npm --prefix apps/governance test
npm --prefix apps/governance run build
npm --prefix apps/governance audit --audit-level=moderate

scan_text() {
  local case_mode="$1"
  local pattern="$2"
  shift 2
  if command -v rg >/dev/null 2>&1; then
    if [[ "$case_mode" == "insensitive" ]]; then
      rg -n -i "$pattern" "$@"
    else
      rg -n "$pattern" "$@"
    fi
    return $?
  fi
  if [[ "$case_mode" == "insensitive" ]]; then
    grep -R --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=coverage -n -E -i "$pattern" "$@"
  else
    grep -R --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=coverage -n -E "$pattern" "$@"
  fi
}

if scan_text insensitive 'TODO|FIXME|Placeholder|Coming soon|example\.com|Fake Balance|Fake User|Fake Transaction|Fake Price|Fake Revenue|Fake APY|Fake Liquidity|Fake Provider|Fake Health|Hard-coded Success|No-op Button' apps/governance internal/governance cmd/ynx-governance-state cmd/ynx-governanced docs/governance release infra/systemd/ynx-governanced.example.service infra/docker/ynx-governanced.Dockerfile; then
  echo "governance forbidden runtime/public text scan failed" >&2
  exit 1
else
  scan_status=$?
  if [[ $scan_status -ne 1 ]]; then
    echo "governance forbidden runtime/public text scanner failed with status $scan_status" >&2
    exit 1
  fi
fi

if scan_text sensitive '(BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{32,})' apps/governance cmd/ynx-governance-state cmd/ynx-governanced internal/governance docs/governance release infra; then
  echo "governance secret pattern scan failed" >&2
  exit 1
else
  scan_status=$?
  if [[ $scan_status -ne 1 ]]; then
    echo "governance secret pattern scanner failed with status $scan_status" >&2
    exit 1
  fi
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
