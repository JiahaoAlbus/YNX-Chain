#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
pid=""
cleanup() {
  [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
  [[ -n "$pid" ]] && wait "$pid" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

go test -race ./internal/stablecoinissuer ./cmd/ynx-stablecoind
go build -trimpath -o "$tmp/ynx-stablecoind" ./cmd/ynx-stablecoind

api_key="stablecoin-issuer-check-key"
state="$tmp/state/stablecoin.json"
url="http://127.0.0.1:16434"
log="$tmp/stablecoin.log"
service_env=(
  YNX_STABLECOIN_API_KEY="$api_key"
  YNX_STABLECOIN_STATE_PATH="$state"
)
env "${service_env[@]}" "$tmp/ynx-stablecoind" --check-config >/dev/null

start_service() {
  env "${service_env[@]}" YNX_STABLECOIN_HTTP_ADDR=127.0.0.1:16434 "$tmp/ynx-stablecoind" >"$log" 2>&1 &
  pid=$!
  for _ in {1..80}; do
    curl -fsS "$url/health" >/dev/null 2>&1 && return
    sleep 0.1
  done
  echo "ynx-stablecoind did not become healthy" >&2
  sed -n '1,120p' "$log" >&2
  exit 1
}

auth=(-H "X-YNX-Stablecoin-Key: $api_key")
json=(-H 'content-type: application/json')
start_service

health="$(curl -fsS "$url/health")"
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!d.ok||d.service!=="ynx-stablecoind"||d.nativeSymbol!=="YNXT"||d.issuerSupportEstablished!==false||d.externalExecutionEnabled!==false||d.nativeYnxtIssuerActionsAllowed!==false||d.truthfulStatus!=="local-control-plane-only-no-issuer-support-no-execution")throw new Error(`bad stablecoin health ${JSON.stringify(d)}`)'

status="$(curl -sS -o "$tmp/unauthorized.json" -w '%{http_code}' "$url/stablecoin/issuers")"
[[ "$status" == 401 ]]

issuer_body='{"idempotencyKey":"issuer-check-submit-001","legalName":"Check Issuer Limited","jurisdiction":"sgp","registryReference":"registry-check-001","contactDomain":"issuer-check.test","evidenceHashes":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}'
issuer_created="$(curl -fsS -X POST "$url/stablecoin/issuers" "${auth[@]}" "${json[@]}" -d "$issuer_body")"
issuer_id="$(printf '%s' "$issuer_created" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.replayed||d.record?.status!=="pending_review"||d.record?.supportStatus!=="candidate_not_supported")throw new Error(`bad issuer ${JSON.stringify(d)}`);process.stdout.write(d.record.id)')"
status="$(curl -sS -o "$tmp/issuer-replay.json" -w '%{http_code}' -X POST "$url/stablecoin/issuers" "${auth[@]}" "${json[@]}" -d "$issuer_body")"
[[ "$status" == 200 ]]
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));if(!d.replayed)process.exit(1)' "$tmp/issuer-replay.json"
changed_issuer="${issuer_body/Check Issuer Limited/Changed Issuer Limited}"
status="$(curl -sS -o "$tmp/issuer-conflict.json" -w '%{http_code}' -X POST "$url/stablecoin/issuers" "${auth[@]}" "${json[@]}" -d "$changed_issuer")"
[[ "$status" == 409 ]]

issuer_review='{"idempotencyKey":"issuer-check-review-001","decision":"approve","reviewer":"governance-reviewer-check","governanceRequestId":"gov_stablecoin_check_001","decisionEvidenceHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reason":"issuer evidence reviewed under bounded policy"}'
curl -fsS -X POST "$url/stablecoin/issuers/$issuer_id/review" "${auth[@]}" "${json[@]}" -d "$issuer_review" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.record?.status!=="approved"||!d.record?.decision)process.exit(1)'

native_body="{\"idempotencyKey\":\"native-check-reject-001\",\"issuerId\":\"$issuer_id\",\"symbol\":\"YNXT\",\"name\":\"Native YNXT\",\"assetClass\":\"gas-asset\",\"canonicality\":\"canonical\",\"originChain\":\"ynx_6423-1\",\"contractReference\":\"native\",\"decimals\":18,\"supplyCeiling\":\"1000\",\"reportedSupply\":\"1\",\"mintPolicy\":\"must never be accepted\",\"burnPolicy\":\"must never be accepted\",\"evidenceHashes\":[\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"]}"
status="$(curl -sS -o "$tmp/native-rejected.json" -w '%{http_code}' -X POST "$url/stablecoin/assets" "${auth[@]}" "${json[@]}" -d "$native_body")"
[[ "$status" == 400 ]]

asset_body="{\"idempotencyKey\":\"asset-check-submit-001\",\"issuerId\":\"$issuer_id\",\"symbol\":\"XUSD\",\"name\":\"Check Test Dollar\",\"assetClass\":\"fiat-backed-stablecoin\",\"canonicality\":\"canonical\",\"originChain\":\"external-testnet\",\"contractReference\":\"0x1111111111111111111111111111111111111111\",\"decimals\":6,\"supplyCeiling\":\"1000\",\"reportedSupply\":\"100\",\"mintPolicy\":\"issuer and governance evidence are required\",\"burnPolicy\":\"redemption and supply evidence are required\",\"legalReviewStatus\":\"pending_external_review\",\"evidenceHashes\":[\"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\"]}"
asset_created="$(curl -fsS -X POST "$url/stablecoin/assets" "${auth[@]}" "${json[@]}" -d "$asset_body")"
asset_id="$(printf '%s' "$asset_created" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.record?.status!=="pending_review"||d.record?.executionEnabled!==false||d.record?.nativeYnxt!==false)process.exit(1);process.stdout.write(d.record.id)')"
asset_review='{"idempotencyKey":"asset-check-review-001","decision":"approve","reviewer":"governance-reviewer-check","governanceRequestId":"gov_stablecoin_asset_check_001","decisionEvidenceHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","reason":"asset controls reviewed under bounded policy"}'
curl -fsS -X POST "$url/stablecoin/assets/$asset_id/review" "${auth[@]}" "${json[@]}" -d "$asset_review" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.record?.status!=="approved"||d.record?.executionEnabled!==false)process.exit(1)'

intent_body="{\"idempotencyKey\":\"mint-check-intent-001\",\"issuerId\":\"$issuer_id\",\"operation\":\"mint\",\"amount\":\"400\",\"account\":\"0x2222222222222222222222222222222222222222\",\"externalReference\":\"issuer-case-check-001\",\"evidenceHash\":\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"}"
intent_created="$(curl -fsS -X POST "$url/stablecoin/assets/$asset_id/intents" "${auth[@]}" "${json[@]}" -d "$intent_body")"
intent_id="$(printf '%s' "$intent_created" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.record?.status!=="recorded_not_executed"||d.record?.executionEnabled!==false)process.exit(1);process.stdout.write(d.record.id)')"
status="$(curl -sS -o "$tmp/intent-replay.json" -w '%{http_code}' -X POST "$url/stablecoin/assets/$asset_id/intents" "${auth[@]}" "${json[@]}" -d "$intent_body")"
[[ "$status" == 200 ]]
changed_intent="${intent_body/\"400\"/\"401\"}"
status="$(curl -sS -o "$tmp/intent-conflict.json" -w '%{http_code}' -X POST "$url/stablecoin/assets/$asset_id/intents" "${auth[@]}" "${json[@]}" -d "$changed_intent")"
[[ "$status" == 409 ]]
over_intent="${intent_body/mint-check-intent-001/mint-check-intent-002}"
over_intent="${over_intent/\"400\"/\"501\"}"
status="$(curl -sS -o "$tmp/intent-over.json" -w '%{http_code}' -X POST "$url/stablecoin/assets/$asset_id/intents" "${auth[@]}" "${json[@]}" -d "$over_intent")"
[[ "$status" == 400 ]]

transparency="$(curl -fsS "$url/stablecoin/transparency" "${auth[@]}")"
printf '%s' "$transparency" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.issuerApplications!==1||d.issuerApprovals!==1||d.assetApplications!==1||d.assetApprovals!==1||d.mintIntents!==1||d.executedMintBurnActions!==0||d.nativeProtocolActions!==0||d.externalExecutionEnabled!==false||d.issuerSupportEstablished!==false)throw new Error(`bad transparency ${JSON.stringify(d)}`)'

kill "$pid"
wait "$pid" 2>/dev/null || true
pid=""
start_service
curl -fsS "$url/stablecoin/intents/$intent_id" "${auth[@]}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.status!=="recorded_not_executed"||d.executionEnabled!==false)process.exit(1)'
curl -fsS "$url/stablecoin/assets/$asset_id" "${auth[@]}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.reservedMintIntentAmount!=="400"||d.executionEnabled!==false||d.nativeYnxt!==false)process.exit(1)'
issuer_revoke='{"idempotencyKey":"issuer-check-revoke-001","reviewer":"governance-reviewer-check","governanceRequestId":"gov_stablecoin_issuer_revoke_001","decisionEvidenceHash":"abababababababababababababababababababababababababababababababab","reason":"issuer authorization revoked under bounded governance policy"}'
curl -fsS -X POST "$url/stablecoin/issuers/$issuer_id/revoke" "${auth[@]}" "${json[@]}" -d "$issuer_revoke" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.record?.status!=="revoked"||!d.record?.revocation)process.exit(1)'
blocked_intent="${intent_body/mint-check-intent-001/mint-check-after-issuer-revoke-001}"
status="$(curl -sS -o "$tmp/issuer-revoked-intent.json" -w '%{http_code}' -X POST "$url/stablecoin/assets/$asset_id/intents" "${auth[@]}" "${json[@]}" -d "$blocked_intent")"
[[ "$status" == 409 ]]
curl -fsS "$url/stablecoin/transparency" "${auth[@]}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.issuerRevocations!==1||d.executedMintBurnActions!==0||d.nativeProtocolActions!==0)process.exit(1)'
metrics="$(curl -fsS "$url/metrics")"
grep -Fq "ynx_stablecoin_external_execution_enabled" <<<"$metrics"
grep -Fq "ynx_stablecoin_native_ynxt_issuer_actions_allowed" <<<"$metrics"
[[ "$(stat -f %Lp "$state" 2>/dev/null || stat -c %a "$state")" == 600 ]]
! grep -Fq "$api_key" "$state" "$log"

echo "stablecoin-issuer-check passed: governance-bound issuer/asset approval and revocation, native YNXT rejection, bounded non-executing intents, exact replay/conflict, transparency, restart persistence, truthful metrics, and mode-0600 state"
