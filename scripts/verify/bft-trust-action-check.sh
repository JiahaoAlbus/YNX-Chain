#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/consensus ./internal/bftgateway ./internal/trustgateway ./cmd/ynx-trustd
go test ./internal/consensus -run 'TestApplicationPersistsGovernanceAppealAndTransparencyWorkflow|TestApplicationPersistsLabelEvidenceAndTrackingWorkflow|TestTrustPayloadRejectsOverlongEvidenceAndAppealWithoutTarget' -count=1
go test ./internal/bftgateway -run TestGatewayCommitsAndQueriesSignedTrustWorkflow -count=1
go test ./internal/trustgateway -run 'TestGatewayRequiresDedicatedKeys|TestBFTTrustSerializesNonceBindsActorAndFailsClosed|TestBFTTrustRejectsInconsistentCommittedResponse|TestBFTTrustInjectsSignerForLabelEvidenceAndTracking' -count=1
grep -Fq 'governance_request_create' internal/consensus/action_transaction.go
grep -Fq 'native-ynxt-no-direct-freeze' internal/chain/devnet.go
grep -Fq 'POST /governance/requests' internal/bftgateway/gateway.go
grep -Fq 'POST /trust/appeals' internal/bftgateway/gateway.go
grep -Fq 'POST /trust/labels' internal/bftgateway/gateway.go
grep -Fq 'POST /trust/evidence' internal/bftgateway/gateway.go
grep -Fq 'POST /trust/tracking-reviews' internal/bftgateway/gateway.go
grep -Fq 'YNX_TRUST_GATEWAY_UPSTREAM_MODE=' .env.trust.example
grep -Fq 'YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY_FILE=' .env.deploy.example

echo "bft-trust-action-check passed: canonical governance, label, evidence, tracking, and appeal signing; request validity; native YNXT protection; deterministic ABCI persistence; correction; PDF export; transparency; concurrent nonce safety; and Gateway evidence checks are verified"
