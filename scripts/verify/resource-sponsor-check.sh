#!/usr/bin/env bash
set -euo pipefail

go test -race ./internal/chain -run '^TestResourceSponsor' -count=1
go test -race ./internal/api -run '^TestResourceSponsorHTTP' -count=1
go test -race ./internal/resourcegateway -run '^TestResourceSponsorRoutes' -count=1
go test ./internal/explorer -run '^Test(FeeDetailUsesRealSponsor|ExplorerServesRPC)' -count=1

grep -Fq 'POST /resource-market/pools' internal/api/server.go
grep -Fq 'POST /resource-market/sponsorships' internal/resourcegateway/server.go
grep -Fq 'SponsorPoolID' internal/explorer/explorer.go
grep -Fq 'resourceSponsorSnapshotIntegrity' internal/chain/resource_sponsor.go

echo "resource-sponsor-check passed: signed owner lifecycle, atomic merchant/dApp pools, bounded sponsorship, restart/tamper protection, authenticated HTTP proxying, and Explorer source evidence"
