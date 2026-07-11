#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
upstream_key="local-resource-gateway-upstream-key"
export YNX_RESOURCE_GATEWAY_UPSTREAM_KEY="$upstream_key"
ynx_start_local_testnet
resource_pid=""
cleanup() {
  [[ -n "$resource_pid" ]] && ynx_kill_tree "$resource_pid"
  ynx_stop_local_testnet
}
trap cleanup EXIT

resource_url="http://127.0.0.1:6432"
api_key="local-resource-api-key"
audit_log="$YNX_VERIFY_WORK/resource-gateway-audit.jsonl"

YNX_RESOURCE_GATEWAY_CHAIN_URL="$YNX_REST_URL" \
YNX_RESOURCE_GATEWAY_HTTP_ADDR=127.0.0.1:6432 \
YNX_RESOURCE_API_KEY="$api_key" \
YNX_RESOURCE_GATEWAY_UPSTREAM_KEY="$upstream_key" \
YNX_RESOURCE_GATEWAY_AUDIT_LOG="$audit_log" \
YNX_RESOURCE_GATEWAY_RATE_LIMIT_WINDOW=1m \
YNX_RESOURCE_GATEWAY_RATE_LIMIT_MAX=40 \
  go run ./cmd/ynx-resourced >"$YNX_VERIFY_WORK/resource-gateway.log" 2>&1 &
resource_pid=$!

for _ in {1..80}; do
  curl -fsS "$resource_url/health" >/dev/null 2>&1 && break
  sleep 0.25
done
health="$(curl -fsS "$resource_url/health")" || { echo "Resource Gateway did not become healthy"; sed -n '1,160p' "$YNX_VERIFY_WORK/resource-gateway.log"; exit 1; }
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.ok || d.service !== "ynx-resourced" || d.chainId !== 6423 || d.nativeSymbol !== "YNXT" || !d.upstreamOk || d.bodyLimitBytes !== 1048576 || d.responseLimitBytes !== 2097152 || d.truthfulStatus !== "authenticated-chain-backed-resource-market-gateway") throw new Error(`bad Resource Gateway health: ${JSON.stringify(d)}`);'

status="$(curl -s -o "$YNX_VERIFY_WORK/resource-direct-bypass.json" -w '%{http_code}' "$YNX_REST_URL/resource-market/policy")"
[[ "$status" == "401" ]] || { echo "expected direct chain Resource Market bypass to return 401, got $status"; cat "$YNX_VERIFY_WORK/resource-direct-bypass.json"; exit 1; }
status="$(curl -s -o "$YNX_VERIFY_WORK/resource-unauthorized.json" -w '%{http_code}' "$resource_url/resource-market/policy")"
[[ "$status" == "401" ]] || { echo "expected unauthorized Resource request to return 401, got $status"; exit 1; }

auth=(-H "X-YNX-Resource-Key: $api_key")
policy="$(curl -fsS "$resource_url/resource-market/policy" "${auth[@]}")"
printf '%s' "$policy" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.id || !d.version || !d.policyHash || d.currency !== "YNXT" || d.providerShareBps + d.protocolFeeBps !== 10000) throw new Error(`bad Resource policy: ${JSON.stringify(d)}`);'
policy_hash="$(printf '%s' "$policy" | ynx_json_field '["policyHash"]')"

quote="$(curl -fsS "$resource_url/resource-market/quote?address=ynx_resource_api_renter&bandwidth=100&compute=5&aiCredits=2&trustCredits=1" "${auth[@]}")"
printf '%s' "$quote" | POLICY_HASH="$policy_hash" node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.policyHash !== process.env.POLICY_HASH || d.priceYnxt !== 7 || !Array.isArray(d.pricingBreakdown) || d.pricingBreakdown.reduce((n,x)=>n+x.amount,0) !== 7) throw new Error(`bad Resource quote: ${JSON.stringify(d)}`);'

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_resource_api_provider","amount":1000}' >/dev/null
curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_resource_api_renter","amount":1000}' >/dev/null
delegation="$(curl -fsS -X POST "$resource_url/resource-market/delegations" "${auth[@]}" -H 'content-type: application/json' -d '{"provider":"ynx_resource_api_provider","beneficiary":"ynx_resource_api_provider","amount":500}')"
printf '%s' "$delegation" | POLICY_HASH="$policy_hash" node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.delegation?.status !== "active" || d.delegation?.policyHash !== process.env.POLICY_HASH || !d.transaction?.hash) throw new Error(`bad Resource delegation: ${JSON.stringify(d)}`);'

rental="$(curl -fsS -X POST "$resource_url/resource-market/rent" "${auth[@]}" -H 'content-type: application/json' -d '{"address":"ynx_resource_api_renter","provider":"ynx_resource_api_provider","bandwidth":100,"compute":5,"aiCredits":2,"trustCredits":1}')"
printf '%s' "$rental" | POLICY_HASH="$policy_hash" node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const r=d.rental; if (!r || r.policyHash !== process.env.POLICY_HASH || r.priceYnxt !== 7 || r.providerIncomeYnxt !== 5 || r.protocolFeeYnxt !== 2) throw new Error(`bad Resource rental: ${JSON.stringify(d)}`);'

income="$(curl -fsS "$resource_url/resource-market/income/ynx_resource_api_provider" "${auth[@]}")"
printf '%s' "$income" | POLICY_HASH="$policy_hash" node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(d.income) || d.income.length !== 1 || d.income[0].policyHash !== process.env.POLICY_HASH || d.income[0].currency !== "YNXT") throw new Error(`bad Resource income: ${JSON.stringify(d)}`);'

analytics="$(curl -fsS "$resource_url/resource-market/analytics" "${auth[@]}")"
printf '%s' "$analytics" | POLICY_HASH="$policy_hash" node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.policyHash !== process.env.POLICY_HASH || d.activeDelegationCount < 1 || d.resourceRentalCount < 1 || d.providerIncomeYnxt !== 5 || d.protocolFeeYnxt !== 2) throw new Error(`bad Resource analytics: ${JSON.stringify(d)}`);'

metrics="$(curl -fsS "$resource_url/metrics")"
grep -Fq "ynx_resource_gateway_requests_total" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"
test -s "$audit_log"
grep -Fq '"outcome":"unauthorized"' "$audit_log"
grep -Fq '"outcome":"accepted"' "$audit_log"
grep -Fq '"outcome":"proxied"' "$audit_log"
! grep -Fq "$api_key" "$audit_log"
! grep -Fq "$upstream_key" "$audit_log"
! grep -Fq '"amount":500' "$audit_log"
! grep -Fq '"bandwidth":100' "$audit_log"

echo "resource-api-check passed: standalone auth, bypass protection, policy, quote, delegation, rental split, income, analytics, metrics, and redacted audit"
