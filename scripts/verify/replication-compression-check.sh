#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/api -run 'TestReplicationSnapshot(Authentication|Gzip)' -count=1
go test ./cmd/ynx-chaind -run 'TestFetchReplicationSnapshot' -count=1
go test ./internal/chain -run 'TestReplicationBatch(Converges|CatchesUp|Rejects)' -count=1
grep -Fq 'gzip.NewWriterLevel' internal/api/server.go
grep -Fq 'MaxReplicationBatchBlocks = 4096' internal/chain/replication.go
grep -Fq 'query.Set("afterHeight"' cmd/ynx-chaind/replication.go
grep -Fq 'YNX_REPLICATION_REQUEST_TIMEOUT' cmd/ynx-chaind/replication.go
grep -Fq 'YNX_REPLICATION_REQUEST_TIMEOUT=4m' scripts/deploy/deploy-testnet.sh
grep -Fq 'YNX_PEER_SYNC_REQUEST_TIMEOUT' cmd/ynx-chaind/peer_sync.go
grep -Fq 'YNX_PEER_SYNC_REQUEST_TIMEOUT=10s' scripts/deploy/deploy-testnet.sh

echo "replication-compression-check passed: authenticated snapshots use bounded incremental batches, preserve HMAC and state integrity, support gzip, reject tampering, and constrain decompressed size and request timeout"
