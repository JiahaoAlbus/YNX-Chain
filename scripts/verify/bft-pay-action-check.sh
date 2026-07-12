#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/consensus ./internal/bftgateway ./internal/paygateway ./cmd/ynx-payd
go test ./internal/consensus -run 'TestApplicationPersistsBoundPayWorkflowAndIdempotency|TestPayPayloadRejectsChangedRequestHashAndUnsupportedCurrency' -count=1
go test ./internal/bftgateway -run TestGatewayCommitsAndQueriesSignedPayWorkflow -count=1
go test ./internal/paygateway -run 'TestGatewayRequiresDedicatedSecrets|TestBFTPaySerializesNonceAndReturnsZeroFeeIdempotentReplay|TestBFTPayRejectsInconsistentCommittedResponse' -count=1
grep -Fq 'pay_intent_create' internal/consensus/action_transaction.go
grep -Fq '/pay/idempotency/' internal/bftgateway/pay.go
grep -Fq 'YNX_PAY_GATEWAY_UPSTREAM_MODE=' .env.pay.example
grep -Fq 'YNX_PAY_GATEWAY_SIGNER_PRIVATE_KEY_FILE=' .env.deploy.example

echo "bft-pay-action-check passed: canonical Pay signing, deterministic ABCI state, merchant ownership, idempotency, refund bounds, process-local webhook HMAC, concurrent nonce safety, and Gateway commit evidence are verified"
