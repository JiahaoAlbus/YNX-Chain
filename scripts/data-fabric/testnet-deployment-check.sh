#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
fixture_pid=""
cleanup() {
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

commit="$(git rev-parse --short=12 HEAD)"
fabric_release="ynx-data-fabric-${commit}"
ready="$tmp/ready.json"
node scripts/data-fabric/fixtures/testnet-deployment-fixture.mjs "$ready" "$commit" &
fixture_pid=$!
for _attempt in $(seq 1 50); do
  [[ -s "$ready" ]] && break
  sleep 0.1
done
[[ -s "$ready" ]] || { echo "deployment fixture did not start" >&2; exit 1; }
fabric_origin="$(jq -er '.fabricOrigin' "$ready")"
bft_origin="$(jq -er '.bftOrigin' "$ready")"

operator_env="$tmp/operator.env"
printf '%s\n' \
  "YNX_PAY_DATA_FABRIC_SOURCE_URL=$bft_origin" \
  "YNX_PAY_DATA_FABRIC_URL=$fabric_origin" \
  "YNX_PAY_DATA_FABRIC_EVENT_KEY_ID=key.pay.testnet.0001" \
  "YNX_PAY_DATA_FABRIC_EVENT_KEY_FILE=$tmp/pay-event.key" >"$operator_env"
chmod 0600 "$operator_env"

bridge="$tmp/bridge"
printf '%s\n' '#!/usr/bin/env bash' \
  'printf '\''{"time":"2026-07-27T00:00:00Z","level":"INFO","msg":"Pay Data Fabric integration cycle","sourceEvents":1,"mappedSourceEvents":1,"unmappedSourceEvents":0,"canonicalEvents":1,"committed":0,"alreadyCommitted":1}\n'\''' >"$bridge"
chmod 0700 "$bridge"

result="$(scripts/data-fabric/verify-testnet-deployment.sh "$fabric_origin" "$bft_origin" "$commit" "$fabric_release" "$operator_env" "$bridge")"
jq -e --arg commit "$commit" '.status == "verified" and .commit == $commit and .canonicalEvents == 1 and .alreadyCommitted == 1 and .inboxEffects == 2 and .journalEntries == 2' <<<"$result" >/dev/null

if scripts/data-fabric/verify-testnet-deployment.sh "$fabric_origin" "$bft_origin" 000000000000 ynx-data-fabric-000000000000 "$operator_env" "$bridge" >/dev/null 2>&1; then
  echo "deployment verifier accepted mismatched runtime identity" >&2
  exit 1
fi

printf '%s\n' '#!/usr/bin/env bash' \
  'printf '\''{"time":"2026-07-27T00:00:00Z","level":"INFO","msg":"Pay Data Fabric integration cycle","sourceEvents":0,"mappedSourceEvents":0,"unmappedSourceEvents":0,"canonicalEvents":0,"committed":0,"alreadyCommitted":0}\n'\''' >"$bridge"
if scripts/data-fabric/verify-testnet-deployment.sh "$fabric_origin" "$bft_origin" "$commit" "$fabric_release" "$operator_env" "$bridge" >/dev/null 2>&1; then
  echo "deployment verifier accepted zero producer receipts" >&2
  exit 1
fi

for identity_mode in legacy-chain legacy-symbol; do
  legacy_ready="$tmp/${identity_mode}.json"
  node scripts/data-fabric/fixtures/testnet-deployment-fixture.mjs "$legacy_ready" "$commit" "$identity_mode" &
  legacy_pid=$!
  for _attempt in $(seq 1 50); do
    [[ -s "$legacy_ready" ]] && break
    sleep 0.1
  done
  [[ -s "$legacy_ready" ]] || { echo "${identity_mode} fixture did not start" >&2; exit 1; }
  legacy_bft_origin="$(jq -er '.bftOrigin' "$legacy_ready")"
  if scripts/data-fabric/verify-testnet-deployment.sh "$fabric_origin" "$legacy_bft_origin" "$commit" "$fabric_release" "$operator_env" "$bridge" >/dev/null 2>&1; then
    kill "$legacy_pid" 2>/dev/null || true
    wait "$legacy_pid" 2>/dev/null || true
    echo "deployment verifier accepted ${identity_mode} identity" >&2
    exit 1
  fi
  kill "$legacy_pid" 2>/dev/null || true
  wait "$legacy_pid" 2>/dev/null || true
done
