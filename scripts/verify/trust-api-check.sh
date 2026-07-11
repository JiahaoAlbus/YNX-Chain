#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
upstream_key="local-trust-gateway-upstream-key"
export YNX_TRUST_GATEWAY_UPSTREAM_KEY="$upstream_key"
ynx_start_local_testnet
trust_pid=""
cleanup() {
  [[ -n "$trust_pid" ]] && ynx_kill_tree "$trust_pid"
  ynx_stop_local_testnet
}
trap cleanup EXIT

trust_url="http://127.0.0.1:6431"
api_key="local-trust-api-key"
audit_log="$YNX_VERIFY_WORK/trust-gateway-audit.jsonl"

YNX_TRUST_GATEWAY_CHAIN_URL="$YNX_REST_URL" \
YNX_TRUST_GATEWAY_HTTP_ADDR=127.0.0.1:6431 \
YNX_TRUST_API_KEY="$api_key" \
YNX_TRUST_GATEWAY_UPSTREAM_KEY="$upstream_key" \
YNX_TRUST_GATEWAY_AUDIT_LOG="$audit_log" \
YNX_TRUST_GATEWAY_RATE_LIMIT_WINDOW=1m \
YNX_TRUST_GATEWAY_RATE_LIMIT_MAX=40 \
  go run ./cmd/ynx-trustd >"$YNX_VERIFY_WORK/trust-gateway.log" 2>&1 &
trust_pid=$!

for _ in {1..80}; do
  curl -fsS "$trust_url/health" >/dev/null 2>&1 && break
  sleep 0.25
done
health="$(curl -fsS "$trust_url/health")" || { echo "Trust Gateway did not become healthy"; sed -n '1,160p' "$YNX_VERIFY_WORK/trust-gateway.log"; exit 1; }
printf '%s' "$health" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.ok || d.service !== "ynx-trustd" || d.chainId !== 6423 || d.nativeSymbol !== "YNXT" || !d.upstreamOk || d.bodyLimitBytes !== 1048576 || d.exportLimitBytes !== 2097152 || d.truthfulStatus !== "authenticated-chain-backed-trust-and-chain-law-gateway") throw new Error(`bad Trust Gateway health: ${JSON.stringify(d)}`);'

status="$(curl -s -o "$YNX_VERIFY_WORK/trust-direct-bypass.json" -w '%{http_code}' "$YNX_REST_URL/governance/request-validity-rules")"
[[ "$status" == "401" ]] || { echo "expected direct chain Trust/Governance bypass to return 401, got $status"; cat "$YNX_VERIFY_WORK/trust-direct-bypass.json"; exit 1; }
status="$(curl -s -o "$YNX_VERIFY_WORK/trust-unauthorized.json" -w '%{http_code}' "$trust_url/governance/request-validity-rules")"
[[ "$status" == "401" ]] || { echo "expected unauthorized Trust request to return 401, got $status"; exit 1; }

auth=(-H "X-YNX-Trust-Key: $api_key")
faucet_tx="$(curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_trust_check_subject","amount":100}')"
faucet_tx_hash="$(printf '%s' "$faucet_tx" | ynx_json_field '["hash"]')"
trace="$(curl -fsS "$trust_url/trust/trace/ynx_trust_check_subject" "${auth[@]}")"
printf '%s' "$trace" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.address !== "ynx_trust_check_subject" || !Array.isArray(d.lots) || d.lots.length < 1 || !d.summary.includes("pro-rata")) throw new Error(`bad Trust trace: ${JSON.stringify(d)}`);'

label="$(curl -fsS -X POST "$trust_url/trust/labels" "${auth[@]}" -H 'content-type: application/json' -d '{"subject":"ynx_trust_check_subject","label":"reviewed-risk","labelType":"risk","riskWeightBps":125,"confidenceBps":8100,"source":"trust-api-check","evidenceHash":"sha256:trust-api-check","expiryHours":24,"reviewRequired":true}')"
printf '%s' "$label" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.labelId || d.assetEffect !== "none_advisory_only" || !d.appealAvailable) throw new Error(`bad Trust label: ${JSON.stringify(d)}`);'

transaction_label="$(curl -fsS -X POST "$trust_url/trust/labels" "${auth[@]}" -H 'content-type: application/json' -d "{\"subject\":\"$faucet_tx_hash\",\"subjectType\":\"transaction\",\"label\":\"transaction-reviewed-risk\",\"riskWeightBps\":75,\"confidenceBps\":8200,\"source\":\"trust-api-check\",\"evidenceHash\":\"sha256:trust-api-check-transaction\"}")"
printf '%s' "$transaction_label" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.labelId || d.subjectType !== "transaction" || !/^0x[0-9a-f]{64}$/i.test(d.subject) || d.address !== "" || d.assetEffect !== "none_advisory_only") throw new Error(`bad transaction Trust label: ${JSON.stringify(d)}`);'

evidence="$(curl -fsS -X POST "$trust_url/trust/evidence" "${auth[@]}" -H 'content-type: application/json' -d '{"subject":"ynx_trust_check_subject"}')"
evidence_id="$(printf '%s' "$evidence" | ynx_json_field '["id"]')"
printf '%s' "$evidence" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.jsonHash || d.riskSummary?.assetEffect !== "none_advisory_only" || d.riskSummary?.conclusion?.includes("CRIMINAL")) throw new Error(`bad evidence: ${JSON.stringify(d)}`);'
curl -fsS "$trust_url/trust/evidence/$evidence_id.pdf" "${auth[@]}" >"$YNX_VERIFY_WORK/trust-evidence.pdf"
grep -a -q '^%PDF' "$YNX_VERIFY_WORK/trust-evidence.pdf"
[[ "$(wc -c <"$YNX_VERIFY_WORK/trust-evidence.pdf" | tr -d ' ')" -le 2097152 ]]

illegal="$(curl -fsS -X POST "$trust_url/governance/requests" "${auth[@]}" -H 'content-type: application/json' -d '{"requester":"trust-check-agency","subject":"ynx_trust_check_subject","action":"freeze native YNXT without evidence","assetType":"YNXT","scope":"ynx_trust_check_subject","description":"directly freeze user native YNXT"}')"
printf '%s' "$illegal" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.classification !== "ILLEGAL_OR_ABUSIVE" || d.status !== "rejected" || !d.nativeYnxtProtected || !d.ruleIds?.includes("native-ynxt-no-direct-freeze")) throw new Error(`bad illegal request rejection: ${JSON.stringify(d)}`);'

review="$(curl -fsS -X POST "$trust_url/governance/requests" "${auth[@]}" -H 'content-type: application/json' -d '{"requester":"trust-check-merchant","subject":"ynx_trust_check_subject","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review scoped transfer evidence","evidence":["case:trust-check","tx:0xtrust"]}')"
request_id="$(printf '%s' "$review" | ynx_json_field '["id"]')"
printf '%s' "$review" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.classification !== "REQUIRES_GOVERNANCE_REVIEW" || !d.ruleIds?.length) throw new Error(`bad request validity result: ${JSON.stringify(d)}`);'
curl -fsS "$trust_url/governance/requests/$request_id" "${auth[@]}" >/dev/null

appeal="$(curl -fsS -X POST "$trust_url/trust/appeals" "${auth[@]}" -H 'content-type: application/json' -d "{\"requestId\":\"$request_id\",\"subject\":\"ynx_trust_check_subject\",\"appellant\":\"ynx_trust_check_subject\",\"reason\":\"false positive correction\",\"evidence\":[\"owner proof\"]}")"
appeal_id="$(printf '%s' "$appeal" | ynx_json_field '["id"]')"
resolved="$(curl -fsS -X POST "$trust_url/trust/appeals/$appeal_id/resolve" "${auth[@]}" -H 'content-type: application/json' -d '{"reviewer":"trust-check-reviewer","decision":"LABEL_REDUCED","resolutionReason":"evidence reduced confidence"}')"
printf '%s' "$resolved" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.status !== "LABEL_REDUCED" || d.decision !== "LABEL_REDUCED" || !d.transparencyEntryId) throw new Error(`bad appeal resolution: ${JSON.stringify(d)}`);'

tracking="$(curl -fsS -X POST "$trust_url/trust/tracking-reviews" "${auth[@]}" -H 'content-type: application/json' -d '{"requester":"trust-check-merchant","subject":"ynx_trust_check_subject","purpose":"single transfer screening","queryType":"trace","scope":"single transfer","description":"minimum necessary review","evidence":["case:trust-check","tx:0xtrust"],"minimumNecessary":true,"confidenceBps":7600,"expiryHours":24}')"
printf '%s' "$tracking" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!d.id || d.classification === "OVERBROAD" || !d.ruleIds?.length) throw new Error(`bad tracking review: ${JSON.stringify(d)}`);'
overbroad="$(curl -fsS -X POST "$trust_url/trust/tracking-reviews" "${auth[@]}" -H 'content-type: application/json' -d '{"requester":"trust-check-merchant","subject":"all users","purpose":"continuous surveillance","queryType":"trace","scope":"all accounts all history forever","description":"bulk profile everyone","evidence":["bulk-case:test"],"minimumNecessary":false,"confidenceBps":1000,"expiryHours":8760}')"
printf '%s' "$overbroad" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.status !== "rejected" || !["OVERBROAD","REJECTED","INSUFFICIENT_EVIDENCE"].includes(d.classification)) throw new Error(`overbroad tracking not rejected: ${JSON.stringify(d)}`);'

transparency="$(curl -fsS "$trust_url/governance/transparency" "${auth[@]}")"
printf '%s' "$transparency" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if (d.entryCount < 4 || d.rejectedCount < 1 || d.appealCount < 1) throw new Error(`bad transparency report: ${JSON.stringify(d)}`);'

metrics="$(curl -fsS "$trust_url/metrics")"
grep -Fq "ynx_trust_gateway_requests_total" <<<"$metrics"
grep -Fq 'native_symbol="YNXT"' <<<"$metrics"
test -s "$audit_log"
grep -Fq '"outcome":"unauthorized"' "$audit_log"
grep -Fq '"outcome":"accepted"' "$audit_log"
grep -Fq '"outcome":"proxied"' "$audit_log"
! grep -Fq "$api_key" "$audit_log"
! grep -Fq "$upstream_key" "$audit_log"
! grep -Fq "false positive correction" "$audit_log"
! grep -Fq "owner proof" "$audit_log"

echo "trust-api-check passed: standalone auth, bypass protection, lineage, address/transaction advisory labels, bounded evidence, Chain Law, appeal, tracking, transparency, metrics, and redacted audit"
