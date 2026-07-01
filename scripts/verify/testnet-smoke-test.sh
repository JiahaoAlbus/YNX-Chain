#!/usr/bin/env bash
set -euo pipefail

work=.ynx-smoke
rm -rf "$work"
mkdir -p "$work"
YNX_NETWORK=testnet YNX_HTTP_ADDR=127.0.0.1:6420 YNX_DATA_DIR="$work/state" go run ./cmd/ynx-chaind >"$work/server.log" 2>&1 &
pid=$!
trap 'kill "$pid" >/dev/null 2>&1 || true' EXIT
for i in {1..40}; do
  curl -fsS http://127.0.0.1:6420/health >/dev/null 2>&1 && break
  sleep 0.25
done
echo "RPC health result:" && curl -fsS http://127.0.0.1:6420/health
echo "EVM RPC chainId result:" && curl -fsS -X POST http://127.0.0.1:6420/evm -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
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
echo "AI streaming test result:" && curl -fsS 'http://127.0.0.1:6420/ai/stream?session=a&q=status' | tail -n 2
curl -fsS 'http://127.0.0.1:6420/ai/stream?session=b&q=status' >"$work/ai-b.txt"
grep -q 'session b' "$work/ai-b.txt"
echo "concurrent AI session test result: session scoped"
echo "Trust trace test result:" && curl -fsS http://127.0.0.1:6420/trust/trace/ynx_smoke_bob
echo "Trust label result:" && curl -fsS -X POST http://127.0.0.1:6420/trust/labels -H 'content-type: application/json' -d '{"subject":"ynx_smoke_bob","label":"smoke-reviewed","riskWeightBps":125,"source":"smoke-test"}'
evidence=$(curl -fsS -X POST http://127.0.0.1:6420/trust/evidence -H 'content-type: application/json' -d '{"subject":"ynx_smoke_bob"}')
evidence_id=$(printf '%s' "$evidence" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
echo "Trust evidence result: $evidence"
curl -fsS "http://127.0.0.1:6420/trust/evidence/$evidence_id" >/dev/null
curl -fsS "http://127.0.0.1:6420/trust/evidence/$evidence_id.pdf" >"$work/evidence.pdf"
test -s "$work/evidence.pdf"
pay_intent=$(curl -fsS -X POST http://127.0.0.1:6420/pay/intents -H 'content-type: application/json' -d '{"merchant":"merchant_smoke","amount":25}')
intent_id=$(printf '%s' "$pay_intent" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).id')
echo "Pay API result: $pay_intent"
echo "Invoice result:" && curl -fsS -X POST http://127.0.0.1:6420/pay/invoices -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"dueInHours\":12}"
echo "Webhook signature result:" && curl -fsS -X POST http://127.0.0.1:6420/pay/webhook-signatures -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"eventType\":\"payment_intent.created\",\"signingKey\":\"smoke-signing-key\"}"
echo "Refund record result:" && curl -fsS -X POST http://127.0.0.1:6420/pay/refunds -H 'content-type: application/json' -d "{\"intentId\":\"$intent_id\",\"amount\":5,\"reason\":\"smoke\"}"
echo "Resource API test result:" && curl -fsS http://127.0.0.1:6420/resources/ynx_smoke_alice
echo "Resource quote result:" && curl -fsS 'http://127.0.0.1:6420/resource-market/quote?address=ynx_smoke_alice&bandwidth=100&compute=5&aiCredits=2&trustCredits=1'
echo "Resource rental result:" && curl -fsS -X POST http://127.0.0.1:6420/resource-market/rent -H 'content-type: application/json' -d '{"address":"ynx_smoke_alice","bandwidth":100,"compute":5,"aiCredits":2,"trustCredits":1}'
source='pragma solidity ^0.8.24; contract Smoke { function ping() public pure returns (uint256) { return 1; } }'
deploy=$(node -e 'const source=process.argv[1]; process.stdout.write(JSON.stringify({deployer:"ynx_smoke_alice",name:"Smoke",source}))' "$source" | curl -fsS -X POST http://127.0.0.1:6420/ide/deploy -H 'content-type: application/json' -d @-)
contract_address=$(printf '%s' "$deploy" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).contract.address')
echo "IDE deployment result: $deploy"
echo "Contract verification result:" && node -e 'const address=process.argv[1], source=process.argv[2]; process.stdout.write(JSON.stringify({address,source}))' "$contract_address" "$source" | curl -fsS -X POST http://127.0.0.1:6420/ide/verify -H 'content-type: application/json' -d @-
curl -fsS "http://127.0.0.1:6420/contracts/$contract_address" >/dev/null
echo "website status API result: local website repo not deployed in this workspace; use /status contract for website integration"
find docs/grants -type f | sort >"$work/grants.txt"
find docs/ecosystem -type f | sort >"$work/ecosystem.txt"
find docs/exchange-listing -type f | sort >"$work/exchange.txt"
find docs/mainnet-readiness -type f | sort >"$work/mainnet.txt"
echo "grant package file list:" && cat "$work/grants.txt"
echo "ecosystem package file list:" && cat "$work/ecosystem.txt"
echo "exchange readiness file list:" && cat "$work/exchange.txt"
echo "mainnet readiness file list:" && cat "$work/mainnet.txt"
