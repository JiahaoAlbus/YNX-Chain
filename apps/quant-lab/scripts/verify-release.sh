#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$repo_root"

runtime_targets=(
  apps/quant-lab/web
  apps/quant-lab/server
  apps/quant-lab/examples
  apps/quant-lab/Dockerfile
  apps/quant-lab/compose.yaml
  apps/quant-lab/k8s
  apps/quant-lab/public-product-metadata.json
  apps/quant-lab/product-release.json
  apps/quant-lab/security-verification.json
  apps/quant-lab/scripts/verify-desktop-candidate.py
  release/integration/ynx-quant-lab-contract.json
  docs/integration
  .ai-bridge/full-goal-coverage.json
  cmd/ynx-quantd
  cmd/ynx-quant-worker
  cmd/ynx-quant-paperd
  cmd/ynx-quant-riskd
  cmd/ynx-quant-web
  cmd/ynx-quant-cli
  cmd/ynx-quant-desktop
  internal/quantlab
  internal/quantworker
  internal/quantpackage
  internal/quantcli
)

forbidden='TODO|FIXME|Coming soon|example\.com|Fake (Balance|User|Transaction|Price|Revenue|APY|Liquidity|Provider|Health)|hard[- ]coded success|mock provider|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-'
if git grep -n -I -i -E -e "$forbidden" -- \
  "${runtime_targets[@]}" \
  ':(exclude)**/*_test.go' \
  ':(exclude)**/*.test.mjs'; then
  echo "Quant runtime/release prohibited-content gate failed"
  exit 1
fi

jq -e '.productId == "ynx-quant-lab" and .implementedLocal == true and .deployedPublic == true and .downloadHosted == true and .publicRuntime.mode == "simulated_testnet_only" and .publicRuntime.liveFundsEnabled == false and (.publicUrls | index("https://quant.ynxweb4.com/")) != null and ([.artifacts[] | select(.hosted == true and (.url | startswith("https://quant.ynxweb4.com/downloads/")))] | length) == 2' apps/quant-lab/product-release.json >/dev/null
jq -e '.productId == "ynx-quant-lab" and (.downloads | type == "array")' apps/quant-lab/public-product-metadata.json >/dev/null
jq -e '.productId == "ynx-quant-lab" and .artifactChecks.scanner == "ynx-archive-safety-v1" and .containerScanPassed == false and .externalVulnerabilityScanPassed == false' apps/quant-lab/security-verification.json >/dev/null

release_source=$(jq -r '.sourceCommit' apps/quant-lab/product-release.json)
if ! [[ "$release_source" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${release_source}^{commit}" 2>/dev/null; then
  echo "Quant product-release sourceCommit is not a resolvable full commit" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$release_source" HEAD; then
  echo "Quant product-release sourceCommit is not an ancestor of HEAD" >&2
  exit 1
fi
artifact_source=$(jq -r '.artifacts[0].sourceCommit' apps/quant-lab/product-release.json)
if ! [[ "$artifact_source" =~ ^[0-9a-f]{40}$ ]] || ! git cat-file -e "${artifact_source}^{commit}" 2>/dev/null; then
  echo "Quant desktop artifact sourceCommit is not a resolvable full commit" >&2
  exit 1
fi
if ! jq -e --arg source "$artifact_source" '[.artifacts[0:2][] | .sourceCommit == $source] | all' apps/quant-lab/product-release.json >/dev/null; then
  echo "Quant hosted desktop artifacts do not share one explicit sourceCommit" >&2
  exit 1
fi
artifact_source_paths=(
  go.mod
  go.sum
  apps/quant-lab/web
  apps/quant-lab/desktop/Info.plist
  apps/quant-lab/Dockerfile
  apps/quant-lab/compose.yaml
  apps/quant-lab/k8s
  apps/quant-lab/scripts/build-desktop-candidates.sh
  cmd/ynx-quantd
  cmd/ynx-quant-web
  cmd/ynx-quant-desktop
  internal/buildinfo
  internal/quantapp
  internal/quantlab
)
if ! git diff --quiet "$artifact_source".."$release_source" -- "${artifact_source_paths[@]}"; then
  if ! jq -e '.knownBlockingEvidence | index("updated desktop packages equivalent to the current web runtime") != null' apps/quant-lab/product-release.json >/dev/null; then
    echo "Quant desktop artifacts differ from current product source without a recorded blocker" >&2
    exit 1
  fi
fi

go test ./internal/quantlab ./internal/quantworker ./internal/quantpackage ./internal/quantapp ./internal/quantcli \
  ./cmd/ynx-quantd ./cmd/ynx-quant-worker ./cmd/ynx-quant-paperd \
  ./cmd/ynx-quant-riskd ./cmd/ynx-quant-web ./cmd/ynx-quant-cli
go test ./cmd/ynx-quant-desktop
go vet ./internal/quantlab ./internal/quantworker ./internal/quantpackage ./internal/quantapp ./internal/quantcli \
  ./cmd/ynx-quantd ./cmd/ynx-quant-worker ./cmd/ynx-quant-paperd \
  ./cmd/ynx-quant-riskd ./cmd/ynx-quant-web ./cmd/ynx-quant-cli
go vet ./cmd/ynx-quant-desktop
npm test --prefix apps/quant-lab
npm run test:browser --prefix apps/quant-lab
node --test apps/quant-lab/sdk/typescript/index.test.mjs

python_bin=${YNX_PYTHON_BIN:-}
if [[ -z "$python_bin" ]]; then
  for candidate in /usr/bin/python3 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && \
      "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      python_bin=$candidate
      break
    fi
  done
fi
if [[ -z "$python_bin" ]]; then
  echo "No healthy Python 3.9+ interpreter found; set YNX_PYTHON_BIN explicitly" >&2
  exit 1
fi
"$python_bin" apps/quant-lab/scripts/validate-integration-package.py >/dev/null
PYTHONPATH=apps/quant-lab/sdk/python/src "$python_bin" -m unittest discover \
  -s apps/quant-lab/sdk/python/tests -p 'test_*.py' -v
"$python_bin" apps/quant-lab/tests/test_archive_scanner.py -v

docker compose -f apps/quant-lab/compose.yaml config --quiet
ruby -e 'require "yaml"; YAML.load_stream(File.read("apps/quant-lab/k8s/quant-candidate.yaml"))'

if [[ "${YNX_BUILD_DESKTOP_CANDIDATES:-1}" == "1" ]]; then
  YNX_QUANT_SOURCE_COMMIT="$release_source" apps/quant-lab/scripts/build-desktop-candidates.sh >/dev/null
fi

desktop_output=${YNX_QUANT_DESKTOP_OUTPUT:-dist/quant-desktop}
mac_archive="$desktop_output/YNX-Quant-Lab-0.2.0-testnet-macos-arm64.zip"
windows_archive="$desktop_output/YNX-Quant-Lab-0.2.0-testnet-windows-x64.zip"
if [[ -f "$mac_archive" && -f "$windows_archive" ]]; then
  for entry in "0:$mac_archive" "1:$windows_archive"; do
    index=${entry%%:*}
    artifact=${entry#*:}
    expected_hash=$(jq -r ".artifacts[$index].sha256" apps/quant-lab/product-release.json)
    expected_bytes=$(jq -r ".artifacts[$index].bytes" apps/quant-lab/product-release.json)
    actual_hash=$(shasum -a 256 "$artifact" | awk '{print $1}')
    actual_bytes=$(wc -c <"$artifact" | tr -d ' ')
    if [[ "$actual_hash" != "$expected_hash" ]]; then
      echo "Quant desktop archive SHA-256 mismatch for $(basename "$artifact"): expected $expected_hash, got $actual_hash" >&2
      exit 1
    fi
    if [[ "$actual_bytes" != "$expected_bytes" ]]; then
      echo "Quant desktop archive byte mismatch for $(basename "$artifact"): expected $expected_bytes, got $actual_bytes" >&2
      exit 1
    fi
  done
  if command -v codesign >/dev/null 2>&1; then
    codesign --verify --deep --strict "$desktop_output/macos/YNX Quant Lab.app"
  fi
  "$python_bin" apps/quant-lab/scripts/scan-desktop-archive.py "$mac_archive" "$windows_archive" >/dev/null
  if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" && "${YNX_VERIFY_DESKTOP_COLD_START:-1}" == "1" ]]; then
    desktop_evidence=$(mktemp)
    trap 'rm -f "$desktop_evidence"' EXIT
    "$python_bin" apps/quant-lab/scripts/verify-desktop-candidate.py \
      "$mac_archive" \
      --expected-commit "$release_source" \
      --expected-sha256 "$(jq -r '.artifacts[0].sha256' apps/quant-lab/product-release.json)" \
      --expected-bytes "$(jq -r '.artifacts[0].bytes' apps/quant-lab/product-release.json)" \
      --output "$desktop_evidence"
    jq -e '.installedLocal == true and .coldStartVerified == true and .productionSigned == false and .deployedPublic == false' "$desktop_evidence" >/dev/null
  fi
fi

if [[ "${YNX_REQUIRE_DOCKER_RUNTIME:-0}" == "1" ]]; then
  YNX_QUANT_SOURCE_COMMIT="$release_source" apps/quant-lab/scripts/verify-container.sh
elif [[ "${YNX_REQUIRE_DOCKER_BUILD:-0}" == "1" ]]; then
  docker build -f apps/quant-lab/Dockerfile \
    --build-arg SOURCE_COMMIT="$release_source" \
    -t ynx-quant:testnet-local .
fi

echo "Quant release gates passed; central Wallet/Exchange, tenancy, public runtime, hosted legacy desktop artifacts, production signing, and live-funds boundaries are recorded separately"
