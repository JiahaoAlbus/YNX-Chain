#!/usr/bin/env bash
set -euo pipefail

endpoint="${YNX_EVM_CORS_ENDPOINT:-https://evm.ynxweb4.com/}"
approved_origins=(
  "https://ynxweb4.com"
  "https://www.ynxweb4.com"
  "https://wallet.ynxweb4.com"
)

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

probe_preflight() {
  local origin="$1"
  local prefix="$2"
  curl --fail-with-body --silent --show-error --max-time 15 \
    --dump-header "$work_dir/$prefix.headers" \
    --output "$work_dir/$prefix.body" \
    --request OPTIONS \
    --header "Origin: $origin" \
    --header 'Access-Control-Request-Method: POST' \
    --header 'Access-Control-Request-Headers: Content-Type' \
    --write-out '%{http_code}' \
    "$endpoint"
}

for index in "${!approved_origins[@]}"; do
  origin="${approved_origins[$index]}"
  code="$(probe_preflight "$origin" "approved-$index")"
  [[ "$code" == "204" ]] || fail "approved preflight returned $code for $origin"
  grep -Fqi "access-control-allow-origin: $origin" "$work_dir/approved-$index.headers" || fail "approved origin was not echoed"
  grep -Fqi 'access-control-allow-methods: POST, OPTIONS' "$work_dir/approved-$index.headers" || fail "approved methods differ"
  grep -Fqi 'access-control-allow-headers: Content-Type' "$work_dir/approved-$index.headers" || fail "approved headers differ"
  ! grep -Fqi 'access-control-allow-credentials:' "$work_dir/approved-$index.headers" || fail "credentials must not be enabled"
done

hostile_code="$(curl --silent --show-error --max-time 15 \
  --output "$work_dir/hostile.body" \
  --request OPTIONS \
  --header 'Origin: https://hostile.invalid' \
  --header 'Access-Control-Request-Method: POST' \
  --header 'Access-Control-Request-Headers: Content-Type' \
  --write-out '%{http_code}' \
  "$endpoint")"
[[ "$hostile_code" == "403" ]] || fail "hostile preflight returned $hostile_code"

rpc_code="$(curl --fail-with-body --silent --show-error --max-time 15 \
  --dump-header "$work_dir/rpc.headers" \
  --output "$work_dir/rpc.body" \
  --request POST \
  --header 'Origin: https://www.ynxweb4.com' \
  --header 'Content-Type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  --write-out '%{http_code}' \
  "$endpoint")"
[[ "$rpc_code" == "200" ]] || fail "eth_chainId returned $rpc_code"
grep -Fq '"result":"0x1917"' "$work_dir/rpc.body" || fail "eth_chainId did not return 0x1917"
grep -Fqi 'access-control-allow-origin: https://www.ynxweb4.com' "$work_dir/rpc.headers" || fail "RPC response lacks approved CORS origin"

printf 'PASS endpoint=%s approved_origins=%d hostile_status=%s chain_id=0x1917 credentials=false\n' \
  "$endpoint" "${#approved_origins[@]}" "$hostile_code"
