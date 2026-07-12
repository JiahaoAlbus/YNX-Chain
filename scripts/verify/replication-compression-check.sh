#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/api -run 'TestReplicationSnapshot(Authentication|Gzip)' -count=1
go test ./cmd/ynx-chaind -run 'TestFetchReplicationSnapshot' -count=1
grep -Fq 'gzip.NewWriterLevel' internal/api/server.go
grep -Fq 'YNX_REPLICATION_REQUEST_TIMEOUT' cmd/ynx-chaind/replication.go
grep -Fq 'YNX_REPLICATION_REQUEST_TIMEOUT=45s' scripts/deploy/deploy-testnet.sh

echo "replication-compression-check passed: authenticated snapshots support gzip with an uncompressed-payload HMAC, followers verify after transparent decompression, decompressed size remains bounded, and request timeout is constrained"
