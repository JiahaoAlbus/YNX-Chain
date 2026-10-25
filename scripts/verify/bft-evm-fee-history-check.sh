#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

go test ./internal/bftgateway -run 'TestEVMFeeHistory|TestGatewayRoutesCommittedFeeHistory|TestFeeHistoryFixtureUsesCanonicalHeights' -count=1
go test ./internal/mutationfreeze -run 'TestRuntimeMutationFreezePreservesReadsAndRestoresWrites' -count=1

grep -Fq 'func (g *Gateway) evmFeeHistory' internal/bftgateway/evm.go
grep -Fq '"/consensus_params"' internal/bftgateway/evm.go
grep -Fq 'committed consensus block max_gas is not positive' internal/bftgateway/evm.go
grep -Fq 'reward percentile history is unavailable' internal/bftgateway/evm.go
grep -Fq 'case "eth_feeHistory"' internal/bftgateway/gateway.go
grep -Fq '"eth_feeHistory": {}' internal/mutationfreeze/middleware.go

echo "bft-evm-fee-history-check passed: eth_feeHistory reads retained committed blocks, block_results gas and positive CometBFT consensus max_gas, returns only zero base-fee history plus evidence-derived gasUsedRatio, accepts omitted or empty reward percentiles, and fails closed on pending/pruned blocks, non-positive max_gas, gas overflow, malformed params or fabricated reward requests"
