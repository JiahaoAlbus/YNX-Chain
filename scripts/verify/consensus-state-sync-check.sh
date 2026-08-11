#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

for method in ListSnapshots OfferSnapshot LoadSnapshotChunk ApplySnapshotChunk; do
  grep -Fq "func (a *Application) ${method}" internal/consensus/snapshot.go || {
    echo "ABCI state sync method ${method} is missing" >&2
    exit 1
  }
done

grep -Fq 'stateSyncSnapshotMaxBytes         = 64 << 20' internal/consensus/snapshot.go || {
  echo "state sync snapshot size bound is missing or changed" >&2
  exit 1
}
grep -Fq 'state.Validate(a.migration)' internal/consensus/snapshot.go || {
  echo "state sync restore does not validate committed state" >&2
  exit 1
}
grep -Fq 'saveCommittedState(a.statePath, state, a.migration)' internal/consensus/snapshot.go || {
  echo "state sync restore does not use durable committed-state persistence" >&2
  exit 1
}

go test ./internal/consensus -run 'StateSyncSnapshot|ServesStateSync|StateSyncPersistence' -count=1
go test -race ./internal/consensus -run 'StateSyncSnapshot|ServesStateSync|StateSyncPersistence' -count=1

echo "consensus-state-sync-check passed: ABCI snapshot export/import, trusted AppHash binding, strict v12 validation with exact v11 migration, socket round-trip, durable restart, tamper rejection, bounded payload and persistence-failure atomicity"
