#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

policy=$(curl -fsS "$YNX_REST_URL/resource-market/policy")
printf '%s' "$policy" | node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
const required = ["id", "version", "governanceStatus", "currency", "policyHash"];
for (const key of required) {
  if (!data[key]) {
    console.error(`missing resource policy ${key}: ${JSON.stringify(data)}`);
    process.exit(1);
  }
}
if (data.currency !== "YNXT" || data.providerShareBps + data.protocolFeeBps !== 10000 || data.minimumQuoteYnxt <= 0 || data.quoteTtlSeconds <= 0) {
  console.error(`invalid resource policy economics: ${JSON.stringify(data)}`);
  process.exit(1);
}
'
policy_hash=$(printf '%s' "$policy" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).policyHash')
policy_version=$(printf '%s' "$policy" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')

quote=$(curl -fsS "$YNX_REST_URL/resource-market/quote?address=ynx_resource_check_renter&bandwidth=100&compute=5&aiCredits=2&trustCredits=1")
printf '%s' "$quote" | POLICY_HASH="$policy_hash" POLICY_VERSION="$policy_version" node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (data.policyHash !== process.env.POLICY_HASH || data.policyVersion !== process.env.POLICY_VERSION || data.priceYnxt !== 7) {
  console.error(`unexpected policy-bound quote: ${JSON.stringify(data)}`);
  process.exit(1);
}
if (!Array.isArray(data.pricingBreakdown) || data.pricingBreakdown.length !== 4 || data.pricingBreakdown.reduce((sum, item) => sum + item.amount, 0) !== data.priceYnxt) {
  console.error(`missing quote pricing breakdown: ${JSON.stringify(data)}`);
  process.exit(1);
}
'

curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_resource_check_provider","amount":1000}' >/dev/null
curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_resource_check_renter","amount":1000}' >/dev/null

delegation=$(curl -fsS -X POST "$YNX_REST_URL/resource-market/delegations" -H 'content-type: application/json' -d '{"provider":"ynx_resource_check_provider","beneficiary":"ynx_resource_check_provider","amount":500}')
printf '%s' "$delegation" | POLICY_HASH="$policy_hash" node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
const delegation = data.delegation;
if (!delegation || delegation.status !== "active" || delegation.policyHash !== process.env.POLICY_HASH || delegation.bandwidth !== 50 || delegation.compute !== 5) {
  console.error(`unexpected resource delegation policy evidence: ${JSON.stringify(data)}`);
  process.exit(1);
}
'

rental=$(curl -fsS -X POST "$YNX_REST_URL/resource-market/rent" -H 'content-type: application/json' -d '{"address":"ynx_resource_check_renter","provider":"ynx_resource_check_provider","bandwidth":100,"compute":5,"aiCredits":2,"trustCredits":1}')
printf '%s' "$rental" | POLICY_HASH="$policy_hash" node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
const rental = data.rental;
if (!rental || rental.policyHash !== process.env.POLICY_HASH || rental.priceYnxt !== 7 || rental.providerIncomeYnxt !== 5 || rental.protocolFeeYnxt !== 2) {
  console.error(`unexpected resource rental policy split: ${JSON.stringify(data)}`);
  process.exit(1);
}
'

income=$(curl -fsS "$YNX_REST_URL/resource-market/income/ynx_resource_check_provider")
printf '%s' "$income" | POLICY_HASH="$policy_hash" node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (!Array.isArray(data.income) || data.income.length !== 1 || data.income[0].policyHash !== process.env.POLICY_HASH || data.income[0].currency !== "YNXT") {
  console.error(`unexpected resource income policy evidence: ${JSON.stringify(data)}`);
  process.exit(1);
}
'

analytics=$(curl -fsS "$YNX_REST_URL/resource-market/analytics")
printf '%s' "$analytics" | POLICY_HASH="$policy_hash" node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (data.policyHash !== process.env.POLICY_HASH || !data.policy || data.policy.policyHash !== process.env.POLICY_HASH || data.activeDelegationCount < 1 || data.resourceRentalCount < 1) {
  console.error(`unexpected resource analytics policy evidence: ${JSON.stringify(data)}`);
  process.exit(1);
}
'

echo "resource-market-check passed: policy, quote breakdown, delegation, rental split, income, and analytics are policy-bound"
