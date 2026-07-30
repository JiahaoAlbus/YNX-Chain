#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/bridgegateway -run 'TestBridge(DataExportRetentionAndIdentityRedaction|V2StateMigratesToDataLifecycleSchema|V6LifecycleMigratesWithoutInventingDestinationAvailability)$'
node <<'NODE'
const fs = require("node:fs");
const required = [
  ["internal/bridgegateway/server.go", "GET /bridge/data-exports/{account}"],
  ["internal/bridgegateway/server.go", "POST /bridge/data-deletion-requests/{id}/execute"],
  [".env.deploy.example", "YNX_BRIDGE_RETENTION_PERIOD=61320h"],
  ["docs/bridge/DATA_LIFECYCLE.md", "## Service cessation and user exit"],
  ["docs/bridge/DATA_LIFECYCLE.md", "pseudonymized, not anonymous"],
];
for (const [file, needle] of required) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) throw new Error(`${file} is missing ${needle}`);
}
const forbidden = /delete.*source.event|delete.*audit|anonymous data/i;
for (const file of ["docs/bridge/DATA_LIFECYCLE.md", "internal/bridgegateway/service.go", "internal/bridgegateway/store.go", "internal/bridgegateway/types.go"]) {
  const text = fs.readFileSync(file, "utf8");
  if (forbidden.test(text)) throw new Error(`${file} contains a forbidden data-lifecycle claim`);
}
NODE

echo "bridge-data-lifecycle-check passed: v2-v6-to-v7 migration, exact reconciliation replay, lifecycle and exposure evidence, export, active safety hold, retention, idempotent identity redaction, restart, tamper rejection, and cessation runbook"
