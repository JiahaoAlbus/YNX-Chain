#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/chain ./internal/consensus ./internal/bftgateway ./internal/resourcegateway ./cmd/ynx-resourced
go test ./internal/chain -run 'TestResourceDelegationRentalIncomeAndPersistence|TestResourceQuoteRejectsComponentAndTotalOverflow' -count=1
go test ./internal/consensus -run 'TestApplicationPersistsResourceDelegationRentalAndSupply|TestResourceRentalRejectsMissingProviderStaleQuoteAndPolicy|TestResourceActionEnvelopeUsesOnlySharedFeeAndBandwidth|TestResourceSponsor' -count=1
go test ./internal/bftgateway -run 'TestGatewayCommitsAndQueriesSignedResourceWorkflow|TestGatewayCommitsDirectSignedResourceSponsorWorkflow' -count=1
go test ./internal/resourcegateway -run 'TestBFTResourceGatewaySignsSerializesAndReplaysDelegations|TestBFTResourceGatewayRequiresSecureMatchingSigner|TestResourceSponsorRoutes' -count=1
grep -Fq 'resource_delegation_create' internal/consensus/action_transaction.go
grep -Fq 'resource_rental_create' internal/consensus/action_transaction.go
grep -Fq 'resource_pool_create' internal/consensus/action_transaction.go
grep -Fq 'resource_sponsorship_consume' internal/consensus/action_transaction.go
grep -Fq '/resource/idempotency/' internal/consensus/application.go
grep -Fq '/resource/sponsor-idempotency/' internal/consensus/application.go
grep -Fq 'POST /resource-market/delegations' internal/bftgateway/gateway.go
grep -Fq 'POST /resource-market/rent' internal/bftgateway/gateway.go
grep -Fq 'POST /resource-market/pools' internal/bftgateway/gateway.go
grep -Fq 'POST /resource-market/sponsorships' internal/bftgateway/gateway.go
grep -Fq 'YNX_RESOURCE_GATEWAY_UPSTREAM_MODE=' .env.resource.example
grep -Fq 'YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY_FILE=' .env.deploy.example

echo "bft-resource-action-check passed: delegation/rental plus direct owner/beneficiary-signed sponsor pools, deterministic AppHash, restart/tamper safety, resource-only accounting, exact replay, Gateway commit evidence, and client-signed Resource Gateway relay are verified"
