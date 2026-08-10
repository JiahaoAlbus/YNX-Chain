#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
work="$(mktemp -d "${TMPDIR:-/tmp}/ynx-data-fabric-service-stop.XXXXXX")"
trap 'rm -rf "$work"' EXIT

source_commit="$(jq -er '.sourceCommit | select(test("^[0-9a-f]{40}$"))' release/data-fabric/product-release.json)"
source_release="$(jq -er '.release' release/data-fabric/product-release.json)"
receipt="$work/graceful-stop-receipt.json"

YNX_DATA_FABRIC_SMOKE_SOURCE_COMMIT="$source_commit" \
YNX_DATA_FABRIC_SMOKE_SOURCE_RELEASE="$source_release" \
YNX_DATA_FABRIC_SMOKE_RECEIPT_OUTPUT="$receipt" \
  bash scripts/data-fabric/local-smoke.sh >/dev/null

jq -e \
  --arg commit "$source_commit" \
  --arg release "$source_release" \
  '.commit == $commit
   and .release == $release
   and .checks.daemonHealth == true
   and .checks.fileIntegrityAudit == true
   and .checks.backupRestore == true' \
  "$receipt" >/dev/null

go test ./internal/datafabric \
  -run '^TestSubjectExportAndPseudonymousErasureRetention$' \
  -count=1 >/dev/null
go test ./internal/datafabricbackup \
  -run '^TestBackupVerifyRestoreAndTamperFailure$' \
  -count=1 >/dev/null

printf '{"status":"verified","sourceCommit":"%s","release":"%s","checks":["graceful-sigterm","post-stop-integrity","backup-restore","subject-export","pseudonymous-erasure-retention"]}\n' \
  "$source_commit" "$source_release"
