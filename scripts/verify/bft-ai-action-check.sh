#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/consensus ./internal/bftgateway ./internal/aigateway ./cmd/ynx-ai-gatewayd
go test ./internal/consensus -run 'TestSignedApplicationAction|TestApplicationPersistsBoundAIWorkflow' -count=1
go test ./internal/bftgateway -run TestGatewayCommitsAndQueriesSignedAIWorkflow -count=1
go test ./internal/aigateway -run TestBFTGatewaySerializesSignerNonceAndRejectsResponseMismatch -count=1
grep -Fq 'YNX_APPLICATION_ACTION_V1' internal/consensus/action_transaction.go
grep -Fq 'YNX_AI_GATEWAY_UPSTREAM_MODE=' .env.ai.example
grep -Fq 'YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY_FILE=' .env.deploy.example

echo "bft-ai-action-check passed: canonical signing, deterministic ABCI AI state, restart persistence, permission binding, concurrent nonce safety, and Gateway mismatch rejection are verified"
