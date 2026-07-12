#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/chain ./internal/consensus ./internal/bftgateway
go test ./internal/consensus -run 'TestApplicationPersistsBoundedIDEDeployCallReceiptAndLogs|TestBoundedIDEStateIsDeterministicAcrossFourApplicationsAndDuplicateNonce' -count=1
go test ./internal/bftgateway -run TestGatewayCommitsBoundedIDEAndReturnsEVMLogs -count=1
grep -Fq 'ide_contract_deploy' internal/consensus/action_transaction.go
grep -Fq 'ide_contract_call' internal/consensus/action_transaction.go
grep -Fq 'ValidateBoundedPinnedContract' internal/chain/bounded_contract.go
grep -Fq '/ide/contracts/' internal/consensus/application.go
grep -Fq '/ide/verifier/' internal/consensus/application.go
grep -Fq '/evm/receipts/' internal/consensus/application.go
grep -Fq 'POST /ide/deploy' internal/bftgateway/gateway.go
grep -Fq 'POST /ide/execute' internal/bftgateway/gateway.go

echo "bft-ide-contract-check passed: pinned bounded deploy/call, AppHash persistence, restart/tamper rejection, unsupported execution rejection, duplicate nonce isolation, four-application determinism, receipts, logs, bloom, and Gateway evidence are verified locally"
