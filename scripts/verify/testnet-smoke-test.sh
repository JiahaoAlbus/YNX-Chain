#!/usr/bin/env bash
set -euo pipefail

work=.ynx-smoke
rm -rf "$work"
mkdir -p "$work"
pid=""
kill_tree() {
  local target="${1:-}"
  if [[ -z "$target" ]]; then
    return 0
  fi
  pkill -TERM -P "$target" >/dev/null 2>&1 || true
  kill "$target" >/dev/null 2>&1 || true
  wait "$target" >/dev/null 2>&1 || true
}
if ! curl -fsS http://127.0.0.1:6420/health >/dev/null 2>&1; then
  YNX_NETWORK=testnet YNX_HTTP_ADDR=127.0.0.1:6420 YNX_DATA_DIR="$work/state" go run ./cmd/ynx-chaind >"$work/server.log" 2>&1 &
  pid=$!
  for i in {1..40}; do
    curl -fsS http://127.0.0.1:6420/health >/dev/null 2>&1 && break
    sleep 0.25
  done
fi
trap 'kill_tree "$pid"' EXIT
curl -fsS http://127.0.0.1:6420/health >/dev/null || { echo "local testnet did not become healthy"; sed -n '1,120p' "$work/server.log" 2>/dev/null || true; exit 1; }
echo "RPC health result:" && curl -fsS http://127.0.0.1:6420/health
curl -fsS http://127.0.0.1:6420/node/identity | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.peerSyncFreshness || typeof data.expectedValidatorCount !== "number" || typeof data.peerSyncTargetCount !== "number") { console.error(`missing node identity endpoint: ${JSON.stringify(data)}`); process.exit(1); }'
echo "EVM RPC chainId result:" && curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
curl -fsS http://127.0.0.1:6420/metrics >"$work/metrics.txt"
grep -q 'ynx_chain_height{network="testnet",chain_id="6423",native_symbol="YNXT"}' "$work/metrics.txt"
echo "monitoring metrics result: /metrics exposes YNX Testnet Prometheus metrics"
h1=$(curl -fsS http://127.0.0.1:6420/status | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).height')
sleep 3
h2=$(curl -fsS http://127.0.0.1:6420/status | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).height')
echo "current height: $h2"
[[ "$h2" -gt "$h1" ]] || { echo "block height did not increase"; exit 1; }
faucet=$(curl -fsS -X POST http://127.0.0.1:6420/faucet -H 'content-type: application/json' -d '{"address":"ynx_smoke_alice","amount":1000}')
echo "faucet result: $faucet"
transfer=$(curl -fsS -X POST http://127.0.0.1:6420/transfer -H 'content-type: application/json' -d '{"from":"ynx_smoke_alice","to":"ynx_smoke_bob","amount":125}')
txhash=$(printf '%s' "$transfer" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).hash')
echo "transfer tx hash: $txhash"
sleep 2
echo "explorer tx URL: http://127.0.0.1:6420/txs/$txhash"
curl -fsS "http://127.0.0.1:6420/txs/$txhash" >/dev/null
evm_receipt=$(curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$txhash\"]}")
evm_log_topic=$(printf '%s' "$evm_receipt" | node -pe 'const data=JSON.parse(fs.readFileSync(0,"utf8")); const logs=data.result.logs; if (!Array.isArray(logs) || logs.length < 1 || !logs[0].topics?.[0]) { throw new Error(`missing receipt logs: ${JSON.stringify(data)}`); } logs[0].topics[0]')
evm_logs=$(curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"eth_getLogs\",\"params\":[{\"fromBlock\":\"0x1\",\"toBlock\":\"latest\",\"topics\":[\"$evm_log_topic\"]}]}")
printf '%s' "$evm_logs" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.result) || data.result.length < 1 || !data.result.some((log)=>log.transactionHash)) { console.error(`missing filtered EVM logs: ${JSON.stringify(data)}`); process.exit(1); }'
echo "EVM receipt/log result: $evm_logs"
echo "AI streaming test result:" && curl -fsS 'http://127.0.0.1:6420/ai/stream?session=a&q=status' | tail -n 2
curl -fsS 'http://127.0.0.1:6420/ai/stream?session=b&q=status' >"$work/ai-b.txt"
grep -q 'session b' "$work/ai-b.txt"
echo "concurrent AI session test result: session scoped"
ai_action=$(curl -fsS -X POST http://127.0.0.1:6420/ai/actions -H 'content-type: application/json' -d '{"sessionId":"smoke-ai-session","requester":"smoke-merchant","scope":"value_movement","actionType":"transfer","description":"Move value for merchant settlement"}')
ai_action_id=$(printf '%s' "$ai_action" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
printf '%s' "$ai_action" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.sensitive || !data.requiresApproval || data.executable || !data.auditHash) { console.error(`AI action gate failed: ${JSON.stringify(data)}`); process.exit(1); }'
ai_permission=$(curl -fsS -X POST http://127.0.0.1:6420/ai/permissions -H 'content-type: application/json' -d '{"sessionId":"smoke-ai-session","requester":"smoke-merchant","scope":"value_movement","purpose":"approve scoped merchant settlement action","expiryHours":2}')
ai_permission_id=$(printf '%s' "$ai_permission" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
printf '%s' "$ai_permission" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.status !== "active" || !data.auditHash) { console.error(`AI permission audit failed: ${JSON.stringify(data)}`); process.exit(1); }'
ai_approved=$(curl -fsS -X POST "http://127.0.0.1:6420/ai/actions/$ai_action_id/approve" -H 'content-type: application/json' -d "{\"approver\":\"smoke-reviewer\",\"permissionId\":\"$ai_permission_id\"}")
printf '%s' "$ai_approved" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.status !== "approved" || data.executable !== true || data.permissionId === "") { console.error(`AI approval failed: ${JSON.stringify(data)}`); process.exit(1); }'
curl -fsS "http://127.0.0.1:6420/ai/actions?sessionId=smoke-ai-session" >/dev/null
echo "AI permission audit result: $ai_approved"
echo "Trust trace test result:" && curl -fsS http://127.0.0.1:6420/trust/trace/ynx_smoke_bob
echo "Trust label result:"
trust_label=$(curl -fsS -X POST http://127.0.0.1:6420/trust/labels -H 'content-type: application/json' -d '{"subject":"ynx_smoke_bob","label":"smoke-reviewed","labelType":"risk","riskWeightBps":125,"confidenceBps":8100,"source":"smoke-test","evidenceHash":"sha256:smoke-test-label","expiryHours":24,"reviewRequired":true}')
printf '%s\n' "$trust_label"
printf '%s' "$trust_label" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.labelId || data.assetEffect !== "none_advisory_only" || data.appealAvailable !== true || data.evidenceHash !== "sha256:smoke-test-label") { console.error(`unexpected Trust label metadata: ${JSON.stringify(data)}`); process.exit(1); }'
evidence=$(curl -fsS -X POST http://127.0.0.1:6420/trust/evidence -H 'content-type: application/json' -d '{"subject":"ynx_smoke_bob"}')
evidence_id=$(printf '%s' "$evidence" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
printf '%s' "$evidence" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const summary=data.riskSummary; if (!summary || summary.assetEffect !== "none_advisory_only" || summary.appealPath !== "/trust/appeals" || summary.activeLabelCount < 1 || summary.effectiveRiskWeightBps <= 0 || !summary.reviewerNotes?.some((note)=>note.includes("advisory"))) { console.error(`unexpected Trust evidence risk summary: ${JSON.stringify(summary)}`); process.exit(1); }'
echo "Trust evidence result: $evidence"
curl -fsS "http://127.0.0.1:6420/trust/evidence/$evidence_id" >/dev/null
curl -fsS "http://127.0.0.1:6420/trust/evidence/$evidence_id.pdf" >"$work/evidence.pdf"
test -s "$work/evidence.pdf"
illegal_request=$(curl -fsS -X POST http://127.0.0.1:6420/governance/requests -H 'content-type: application/json' -d '{"requester":"smoke-agency","subject":"ynx_smoke_bob","action":"freeze native YNXT without evidence","assetType":"YNXT","scope":"ynx_smoke_bob","description":"directly freeze user native YNXT"}')
illegal_class=$(printf '%s' "$illegal_request" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).classification')
[[ "$illegal_class" == "ILLEGAL_OR_ABUSIVE" ]] || { echo "anti-illegal request classification mismatch: $illegal_class"; exit 1; }
echo "Anti-illegal request result: $illegal_request"
review_request=$(curl -fsS -X POST http://127.0.0.1:6420/governance/requests -H 'content-type: application/json' -d '{"requester":"smoke-merchant","subject":"ynx_smoke_bob","action":"risk label review","assetType":"stablecoin","scope":"single transfer","description":"review scoped transfer evidence","evidence":["case:smoke","tx:0xsmoke"]}')
review_id=$(printf '%s' "$review_request" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
echo "Request validity result: $review_request"
appeal=$(curl -fsS -X POST http://127.0.0.1:6420/trust/appeals -H 'content-type: application/json' -d "{\"requestId\":\"$review_id\",\"subject\":\"ynx_smoke_bob\",\"appellant\":\"ynx_smoke_bob\",\"reason\":\"false positive correction\",\"evidence\":[\"owner proof\"]}")
appeal_status=$(printf '%s' "$appeal" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).status')
[[ "$appeal_status" == "SUBMITTED" ]] || { echo "appeal status mismatch: $appeal_status"; exit 1; }
appeal_id=$(printf '%s' "$appeal" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
echo "Trust appeal result: $appeal"
appeal_resolution=$(curl -fsS -X POST "http://127.0.0.1:6420/trust/appeals/$appeal_id/resolve" -H 'content-type: application/json' -d '{"reviewer":"smoke-reviewer","decision":"LABEL_REDUCED","resolutionReason":"smoke evidence reduced label confidence"}')
appeal_resolution_status=$(printf '%s' "$appeal_resolution" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).status')
[[ "$appeal_resolution_status" == "LABEL_REDUCED" ]] || { echo "appeal resolution mismatch: $appeal_resolution_status"; exit 1; }
echo "Trust appeal resolution result: $appeal_resolution"
tracking_review=$(curl -fsS -X POST http://127.0.0.1:6420/trust/tracking-reviews -H 'content-type: application/json' -d '{"requester":"smoke-merchant","subject":"ynx_smoke_bob","purpose":"single transaction screening","queryType":"trace","scope":"single transfer","description":"purpose limited review","evidence":["case:smoke","tx:0xsmoke"],"minimumNecessary":true,"confidenceBps":7600,"expiryHours":24}')
tracking_class=$(printf '%s' "$tracking_review" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).classification')
[[ "$tracking_class" == "VALID_UNDER_YNX_CHAIN_LAW" ]] || { echo "tracking review mismatch: $tracking_class"; exit 1; }
echo "Anti-unreasonable tracking result: $tracking_review"
transparency=$(curl -fsS http://127.0.0.1:6420/governance/transparency)
transparency_entries=$(printf '%s' "$transparency" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).entryCount')
[[ "$transparency_entries" -ge 5 ]] || { echo "transparency entries missing"; exit 1; }
echo "Transparency report result: $transparency"
pay_intent=$(curl -fsS -X POST http://127.0.0.1:6420/pay/intents -H 'content-type: application/json' -d '{"merchant":"merchant_smoke","amount":25,"idempotencyKey":"smoke-intent-key"}')
intent_id=$(printf '%s' "$pay_intent" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
pay_intent_replay=$(curl -fsS -X POST http://127.0.0.1:6420/pay/intents -H 'content-type: application/json' -d '{"merchant":"merchant_smoke","amount":99,"idempotencyKey":"smoke-intent-key"}')
printf '%s\n%s' "$pay_intent" "$pay_intent_replay" | node -e 'const [first, second]=require("fs").readFileSync(0,"utf8").trim().split(/\n/).map(JSON.parse); if (first.id !== second.id || second.amount !== 25) { console.error(`pay intent idempotency failed: ${JSON.stringify({first, second})}`); process.exit(1); }'
echo "Pay API result: $pay_intent"
invoice=$(curl -fsS -X POST http://127.0.0.1:6420/pay/invoices -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"dueInHours\":12,\"idempotencyKey\":\"smoke-invoice-key\"}")
invoice_replay=$(curl -fsS -X POST http://127.0.0.1:6420/pay/invoices -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"dueInHours\":36,\"idempotencyKey\":\"smoke-invoice-key\"}")
printf '%s\n%s' "$invoice" "$invoice_replay" | node -e 'const [first, second]=require("fs").readFileSync(0,"utf8").trim().split(/\n/).map(JSON.parse); if (first.id !== second.id) { console.error(`invoice idempotency failed: ${JSON.stringify({first, second})}`); process.exit(1); }'
echo "Invoice result: $invoice"
webhook=$(curl -fsS -X POST http://127.0.0.1:6420/pay/webhook-signatures -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"eventType\":\"payment_intent.created\",\"signingKey\":\"smoke-signing-key\",\"idempotencyKey\":\"smoke-webhook-key\"}")
webhook_id=$(printf '%s' "$webhook" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).eventId')
printf '%s' "$webhook" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.payloadHash || !data.replaySafe || data.idempotencyKey !== "smoke-webhook-key") { console.error(`webhook audit fields missing: ${JSON.stringify(data)}`); process.exit(1); }'
curl -fsS "http://127.0.0.1:6420/pay/webhook-signatures/$webhook_id" >/dev/null
echo "Webhook signature result: $webhook"
refund=$(curl -fsS -X POST http://127.0.0.1:6420/pay/refunds -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"amount\":5,\"reason\":\"smoke\",\"idempotencyKey\":\"smoke-refund-key\"}")
refund_replay=$(curl -fsS -X POST http://127.0.0.1:6420/pay/refunds -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"amount\":6,\"reason\":\"changed\",\"idempotencyKey\":\"smoke-refund-key\"}")
printf '%s\n%s' "$refund" "$refund_replay" | node -e 'const [first, second]=require("fs").readFileSync(0,"utf8").trim().split(/\n/).map(JSON.parse); if (first.id !== second.id || second.amount !== 5) { console.error(`refund idempotency failed: ${JSON.stringify({first, second})}`); process.exit(1); }'
echo "Refund record result: $refund"
pay_events=$(curl -fsS "http://127.0.0.1:6420/pay/events?intentId=$intent_id")
printf '%s' "$pay_events" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.events) || data.events.length !== 4 || data.events.some((event)=>!event.auditHash)) { console.error(`pay events audit failed: ${JSON.stringify(data)}`); process.exit(1); }'
echo "Pay event audit result: $pay_events"
echo "Resource API test result:" && curl -fsS http://127.0.0.1:6420/resources/ynx_smoke_alice
echo "Resource quote result:" && curl -fsS 'http://127.0.0.1:6420/resource-market/quote?address=ynx_smoke_alice&bandwidth=100&compute=5&aiCredits=2&trustCredits=1'
curl -fsS -X POST http://127.0.0.1:6420/faucet -H 'content-type: application/json' -d '{"address":"ynx_resource_provider","amount":1000}' >/dev/null
echo "Resource delegation result:" && curl -fsS -X POST http://127.0.0.1:6420/resource-market/delegations -H 'content-type: application/json' -d '{"provider":"ynx_resource_provider","beneficiary":"ynx_resource_provider","amount":500}'
echo "Resource rental result:" && curl -fsS -X POST http://127.0.0.1:6420/resource-market/rent -H 'content-type: application/json' -d '{"address":"ynx_smoke_alice","provider":"ynx_resource_provider","bandwidth":100,"compute":5,"aiCredits":2,"trustCredits":1}'
echo "Resource income result:" && curl -fsS http://127.0.0.1:6420/resource-market/income/ynx_resource_provider
echo "Resource analytics result:" && curl -fsS http://127.0.0.1:6420/resource-market/analytics
source='pragma solidity ^0.8.24; contract Smoke { event SmokePing(address indexed caller, uint256 value); function ping() public pure returns (uint256) { return 1; } }'
compile=$(node -e 'const source=process.argv[1]; process.stdout.write(JSON.stringify({name:"Smoke",source}))' "$source" | curl -fsS -X POST http://127.0.0.1:6420/ide/compile -H 'content-type: application/json' -d @-)
printf '%s' "$compile" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!data.ok || !data.sourceHash || !data.artifactHash || !data.compilerMode || !data.runtimeMode || !Array.isArray(data.functions) || data.functions[0]?.signature !== "ping()") { console.error(`missing IDE compile artifact metadata: ${JSON.stringify(data)}`); process.exit(1); }'
deploy=$(node -e 'const source=process.argv[1]; process.stdout.write(JSON.stringify({deployer:"ynx_smoke_alice",name:"Smoke",source}))' "$source" | curl -fsS -X POST http://127.0.0.1:6420/ide/deploy -H 'content-type: application/json' -d @-)
contract_address=$(printf '%s' "$deploy" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).contract.address')
contract_topic=$(printf '%s' "$deploy" | node -pe 'const data=JSON.parse(fs.readFileSync(0,"utf8")); const event=data.contract.events?.[0]; if (!event || event.signature !== "SmokePing(address,uint256)" || !event.topic) throw new Error(`missing contract event metadata: ${JSON.stringify(data)}`); event.topic')
contract_selector=$(printf '%s' "$deploy" | node -pe 'const data=JSON.parse(fs.readFileSync(0,"utf8")); const fn=data.contract.functions?.[0]; if (!fn || fn.signature !== "ping()" || !fn.selector) throw new Error(`missing contract function metadata: ${JSON.stringify(data)}`); fn.selector')
contract_tx=$(printf '%s' "$deploy" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).transaction.hash')
echo "IDE deployment result: $deploy"
echo "Contract verification result:" && node -e 'const address=process.argv[1], source=process.argv[2]; process.stdout.write(JSON.stringify({address,source}))' "$contract_address" "$source" | curl -fsS -X POST http://127.0.0.1:6420/ide/verify -H 'content-type: application/json' -d @-
verifier_evidence=$(curl -fsS "http://127.0.0.1:6420/ide/verifier/$contract_address")
printf '%s' "$verifier_evidence" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.localServiceStatus !== "local-verifier-evidence" || data.remotePublicProofStatus !== "not_remote_public_proof" || data.artifactKind !== "source-analyzer-artifact" || data.verified !== true) { console.error(`bad verifier evidence: ${JSON.stringify(data)}`); process.exit(1); }'
curl -fsS "http://127.0.0.1:6420/contracts/$contract_address" >/dev/null
contract_call=$(node -e 'const address=process.argv[1]; process.stdout.write(JSON.stringify({address,function:"ping"}))' "$contract_address" | curl -fsS -X POST http://127.0.0.1:6420/ide/call -H 'content-type: application/json' -d @-)
printf '%s' "$contract_call" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.returnValue !== "1" || data.encodedResult !== "0x0000000000000000000000000000000000000000000000000000000000000001") { console.error(`bad IDE call result: ${JSON.stringify(data)}`); process.exit(1); }'
eth_call=$(curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":30,\"method\":\"eth_call\",\"params\":[{\"to\":\"$contract_address\",\"data\":\"$contract_selector\"},\"latest\"]}")
printf '%s' "$eth_call" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (data.result !== "0x0000000000000000000000000000000000000000000000000000000000000001") { console.error(`bad eth_call result: ${JSON.stringify(data)}`); process.exit(1); }'
sleep 2
contract_receipt=$(curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":31,\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$contract_tx\"]}")
printf '%s' "$contract_receipt" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.result?.logs) || data.result.logs.length < 3) { console.error(`missing contract receipt logs: ${JSON.stringify(data)}`); process.exit(1); }'
contract_logs=$(curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":32,\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"$contract_address\",\"topics\":[\"$contract_topic\"]}]}")
printf '%s' "$contract_logs" | node -e 'const address=process.argv[1]; const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!Array.isArray(data.result) || data.result.length !== 1 || data.result[0].address.toLowerCase() !== address.toLowerCase()) { console.error(`missing contract event log: ${JSON.stringify(data)}`); process.exit(1); }' "$contract_address"
echo "Contract event log result: $contract_logs"
echo "Indexer sync result:" && go run ./cmd/ynx-indexerd -rpc http://127.0.0.1:6420 -db "$work/indexer-db.json" -once
YNX_INDEXER_RPC_URL=http://127.0.0.1:6420 YNX_INDEXER_DB_PATH="$work/indexer-db.json" YNX_INDEXER_HTTP_ADDR=127.0.0.1:6436 go run ./cmd/ynx-indexerd >"$work/indexer-smoke.log" 2>&1 &
indexer_smoke_pid=$!
for i in {1..40}; do
  curl -fsS http://127.0.0.1:6436/health >/dev/null 2>&1 && break
  sleep 0.25
done
YNX_EXPLORER_RPC_URL=http://127.0.0.1:6420 YNX_EXPLORER_INDEXER_URL=http://127.0.0.1:6436 YNX_EXPLORER_HTTP_ADDR=127.0.0.1:6437 go run ./cmd/ynx-explorerd >"$work/explorer-smoke.log" 2>&1 &
explorer_smoke_pid=$!
for i in {1..40}; do
  curl -fsS http://127.0.0.1:6437/health >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS http://127.0.0.1:6437/health >/dev/null || { echo "Explorer smoke service did not become healthy"; sed -n '1,120p' "$work/explorer-smoke.log"; exit 1; }
echo "Explorer API result:" && curl -fsS http://127.0.0.1:6437/api/summary
kill_tree "$explorer_smoke_pid"
kill_tree "$indexer_smoke_pid"
FAUCET_PRIVATE_KEY=local-smoke-faucet-key YNX_FAUCET_RPC_URL=http://127.0.0.1:6420 YNX_FAUCET_HTTP_ADDR=127.0.0.1:6428 YNX_FAUCET_REQUEST_LOG="$work/faucet-requests.jsonl" YNX_FAUCET_DEFAULT_AMOUNT=88 YNX_FAUCET_MAX_AMOUNT=100 YNX_FAUCET_RATE_LIMIT_MAX=1 go run ./cmd/ynx-faucetd >"$work/faucet-smoke.log" 2>&1 &
faucet_smoke_pid=$!
for i in {1..40}; do
  curl -fsS http://127.0.0.1:6428/health >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS http://127.0.0.1:6428/health >/dev/null || { echo "Faucet smoke service did not become healthy"; sed -n '1,120p' "$work/faucet-smoke.log"; exit 1; }
echo "Faucet daemon result:" && curl -fsS -X POST http://127.0.0.1:6428/request -H 'content-type: application/json' -d '{"address":"ynx_smoke_faucet_daemon"}'
grep -Fq '"status":"sent"' "$work/faucet-requests.jsonl"
kill_tree "$faucet_smoke_pid"
echo "website status API result: local website repo not deployed in this workspace; use /status contract for website integration"
find docs/grants -type f | sort >"$work/grants.txt"
find docs/ecosystem -type f | sort >"$work/ecosystem.txt"
find docs/exchange-listing -type f | sort >"$work/exchange.txt"
find docs/mainnet-readiness -type f | sort >"$work/mainnet.txt"
echo "grant package file list:" && cat "$work/grants.txt"
echo "ecosystem package file list:" && cat "$work/ecosystem.txt"
echo "exchange readiness file list:" && cat "$work/exchange.txt"
echo "mainnet readiness file list:" && cat "$work/mainnet.txt"
