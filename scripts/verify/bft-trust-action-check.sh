#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/consensus ./internal/bftgateway ./internal/trustgateway ./cmd/ynx-trustd
go test ./internal/consensus -run 'TestApplicationPersistsGovernanceAppealAndTransparencyWorkflow|TestTrustPayloadRejectsOverlongEvidenceAndLabelOnlyAppeal' -count=1
go test ./internal/bftgateway -run TestGatewayCommitsAndQueriesSignedTrustWorkflow -count=1
go test ./internal/trustgateway -run 'TestGatewayRequiresDedicatedKeys|TestBFTTrustSerializesNonceBindsActorAndFailsClosed|TestBFTTrustRejectsInconsistentCommittedResponse' -count=1
grep -Fq 'governance_request_create' internal/consensus/action_transaction.go
grep -Fq 'native-ynxt-no-direct-freeze' internal/chain/devnet.go
grep -Fq 'POST /governance/requests' internal/bftgateway/gateway.go
grep -Fq 'POST /trust/appeals' internal/bftgateway/gateway.go
grep -Fq 'YNX_TRUST_GATEWAY_UPSTREAM_MODE=' .env.trust.example
grep -Fq 'YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY_FILE=' .env.deploy.example

echo "bft-trust-action-check passed: canonical governance and appeal signing, request validity, native YNXT protection, deterministic ABCI persistence, false-positive correction, transparency audit, concurrent nonce safety, and Gateway evidence checks are verified"
