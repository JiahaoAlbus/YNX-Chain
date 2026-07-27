#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

bash -n scripts/deploy/deploy-read-availability.sh scripts/deploy/remote/install-read-availability.sh
go test -race ./internal/chain ./internal/api ./internal/indexer ./cmd/ynx-chaind ./cmd/ynx-indexerd
go vet ./internal/chain ./internal/api ./internal/indexer ./cmd/ynx-chaind ./cmd/ynx-indexerd

for required in \
  'blockReadView' \
  'statusReadView' \
  'TryRLock' \
  'TestBlockReadViewDoesNotWaitForStatePersistenceLock'
do
  grep -Fq "$required" internal/chain/devnet.go internal/chain/devnet_test.go ||
    { echo "chain read availability missing gate: $required"; exit 1; }
done

for required in \
  'syncCheckpointBlocks = 4096' \
  'applyIndexedBlock' \
  'persist verified index progress' \
  'TestIndexerCheckpointsLargeCatchupInBatches'
do
  grep -Fq "$required" internal/indexer/indexer.go internal/indexer/indexer_test.go ||
    { echo "indexer catch-up batching missing gate: $required"; exit 1; }
done

for required in \
  '/var/backups/ynx-chain/$release-$role' \
  'previous binaries restored' \
  'http://127.0.0.1:6420/blocks/$probe_height' \
  'ynx-indexerd did not persist forward catch-up progress'
do
  grep -Fq "$required" scripts/deploy/remote/install-read-availability.sh ||
    { echo "scoped read availability rollback or health gate missing: $required"; exit 1; }
done

for required in \
  'sequence=singapore,silicon-valley,seoul,primary' \
  'SILICON_VALLEY_PRIVATE_HOST:-10.77.42.3' \
  'SEOUL_PRIVATE_HOST:-10.77.42.4' \
  'ProxyCommand=ssh'
do
  grep -Fq "$required" scripts/deploy/deploy-read-availability.sh ||
    { echo "four-node private fallback deployment missing gate: $required"; exit 1; }
done

DEPLOY_DRY_RUN=1 bash scripts/deploy/deploy-read-availability.sh
echo "read-availability-check passed: chain reads are lock-independent, indexer catch-up is batched, and four-node scoped rollback deployment is ready"
