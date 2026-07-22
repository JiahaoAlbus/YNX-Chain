#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/bridgegateway -run 'TestBridge(DataExportRetentionAndIdentityRedaction|V2StateMigratesToDataLifecycleSchema)$'
rg -Fq 'GET /bridge/data-exports/{account}' internal/bridgegateway/server.go
rg -Fq 'POST /bridge/data-deletion-requests/{id}/execute' internal/bridgegateway/server.go
rg -Fq 'YNX_BRIDGE_RETENTION_PERIOD=61320h' .env.deploy.example
rg -Fq '## Service cessation and user exit' docs/bridge/DATA_LIFECYCLE.md
rg -Fq 'pseudonymized, not anonymous' docs/bridge/DATA_LIFECYCLE.md
! rg -n -i 'delete.*source.event|delete.*audit|anonymous data' docs/bridge/DATA_LIFECYCLE.md internal/bridgegateway

echo "bridge-data-lifecycle-check passed: v2-to-v3 migration, export, active safety hold, retention, idempotent identity redaction, restart, tamper rejection, and cessation runbook"
