#!/usr/bin/env bash
set -euo pipefail

go test -race ./internal/chain -run '^TestResourceSponsor' -count=1
go test -race ./internal/api -run '^TestResourceSponsorHTTP' -count=1
go test -race ./internal/resourcegateway -run '^TestResourceSponsorRoutes' -count=1
go test -race ./internal/consensus -run '^TestResourceSponsor' -count=1
go test -race ./internal/bftgateway -run '^TestGatewayCommitsDirectSignedResourceSponsorWorkflow' -count=1
go test ./internal/explorer -run '^Test(FeeDetailUsesRealSponsor|ExplorerServesRPC)' -count=1

grep -Fq 'POST /resource-market/pools' internal/api/server.go
grep -Fq 'POST /resource-market/sponsorships' internal/resourcegateway/server.go
grep -Fq 'SponsorPoolID' internal/explorer/explorer.go
grep -Fq 'resourceSponsorSnapshotIntegrity' internal/chain/resource_sponsor.go
grep -Fq 'ActionResourceSponsor' internal/consensus/action_transaction.go
grep -Fq 'proxyBFTSignedSponsorMutation' internal/resourcegateway/gateway.go

echo "resource-sponsor-check passed: authoritative and deterministic BFT sponsor pools, direct owner/beneficiary signatures, atomic bounded consumption, restart/tamper protection, authenticated relay, and Explorer source evidence"
