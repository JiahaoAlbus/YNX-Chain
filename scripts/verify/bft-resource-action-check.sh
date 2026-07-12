#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/chain ./internal/consensus ./internal/bftgateway ./internal/resourcegateway ./cmd/ynx-resourced
go test ./internal/chain -run 'TestResourceDelegationRentalIncomeAndPersistence|TestResourceQuoteRejectsComponentAndTotalOverflow' -count=1
go test ./internal/consensus -run 'TestApplicationPersistsResourceDelegationRentalAndSupply|TestResourceRentalRejectsMissingProviderStaleQuoteAndPolicy|TestResourceActionEnvelopeUsesOnlySharedFeeAndBandwidth' -count=1
go test ./internal/bftgateway -run TestGatewayCommitsAndQueriesSignedResourceWorkflow -count=1
go test ./internal/resourcegateway -run 'TestBFTResourceGatewaySignsSerializesAndReplaysDelegations|TestBFTResourceGatewayRequiresSecureMatchingSigner' -count=1
grep -Fq 'resource_delegation_create' internal/consensus/action_transaction.go
grep -Fq 'resource_rental_create' internal/consensus/action_transaction.go
grep -Fq '/resource/idempotency/' internal/consensus/application.go
grep -Fq 'POST /resource-market/delegations' internal/bftgateway/gateway.go
grep -Fq 'POST /resource-market/rent' internal/bftgateway/gateway.go
grep -Fq 'YNX_RESOURCE_GATEWAY_UPSTREAM_MODE=' .env.resource.example
grep -Fq 'YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY_FILE=' .env.deploy.example

echo "bft-resource-action-check passed: policy-bound quotes, signed delegation/rental, liquid-plus-staked supply conservation, provider/protocol settlement, persistent income, idempotent replay, concurrent nonce safety, and Gateway committed evidence are verified"
